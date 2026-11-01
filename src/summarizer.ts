import OpenAI from 'openai';
import { DEEPSEEK_BASE_URL, SUMMARY_CONCURRENCY, SUMMARY_INPUT_MAX_LENGTH, SUMMARY_MODEL } from './config.js';
import { truncate } from './fetcher.js';
import type { Article } from './types.js';

const SYSTEM_PROMPT = `你是一名科技新闻编辑，负责为 AI 新闻日报撰写摘要。
根据给定的文章标题和简介，用一句简体中文概括这篇文章的核心内容（不超过 60 个汉字）。
如果简介为空，就只根据标题概括，不要编造标题和简介里没有的事实。
只输出这一句话本身，不要加引号、前缀或任何解释。`;

/**
 * 调用 DeepSeek 为单篇文章生成一句话总结。
 * Ask DeepSeek for a one-sentence summary of a single article.
 * @param client - OpenAI 兼容客户端 / OpenAI-compatible client
 * @param article - 文章 / Article
 * @returns 总结文本；无输出时返回 null / Summary text, or null on empty output
 */
async function summarizeOne(client: OpenAI, article: Article): Promise<string | null> {
  const description = truncate(article.description, SUMMARY_INPUT_MAX_LENGTH);
  const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & { thinking: { type: 'disabled' } } = {
    model: SUMMARY_MODEL,
    max_tokens: 1024,
    // 一句话摘要不需要推理，关闭思考模式更快更省（DeepSeek 扩展参数）
    // A one-line summary needs no reasoning; disabling thinking is faster and cheaper (DeepSeek extension)
    thinking: { type: 'disabled' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `<title>${article.title}</title>\n<description>${description}</description>` },
    ],
  };
  const completion = await client.chat.completions.create(params);
  return completion.choices[0]?.message.content?.trim() || null;
}

/**
 * 用 DeepSeek 为所有文章生成一句话总结，原地替换 summary。
 * 单篇失败时保留截取的摘要，不影响其他文章。
 * Generate one-sentence summaries for all articles with DeepSeek, replacing `summary` in place.
 * A failed article keeps its truncated summary without affecting the others.
 * @param articles - 文章列表 / Articles
 * @param apiKey - DeepSeek API key
 * @returns 成功生成的数量与失败信息 / Number of successes and failure messages
 */
export async function summarizeAll(articles: Article[], apiKey: string): Promise<{ ok: number; errors: string[] }> {
  const client = new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL });
  const errors: string[] = [];
  let ok = 0;
  let next = 0;

  // 简单的并发池：每个 worker 依次领取下一篇文章
  // Simple concurrency pool: each worker picks up the next article in turn
  const worker = async (): Promise<void> => {
    while (next < articles.length) {
      const article = articles[next++];
      try {
        const summary = await summarizeOne(client, article);
        if (summary) {
          article.summary = summary;
          ok++;
        } else {
          errors.push(`${article.title}: 模型未返回摘要 / no summary returned`);
        }
      } catch (err) {
        const msg = err instanceof OpenAI.APIError ? `API ${err.status ?? ''} ${err.message}`.trim() : String(err);
        errors.push(`${article.title}: ${msg}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(SUMMARY_CONCURRENCY, articles.length) }, worker));
  return { ok, errors };
}
