import OpenAI from 'openai';
import {
  ARTICLE_CONTEXT_MIN_LENGTH,
  DEEPSEEK_BASE_URL,
  SUMMARY_CONCURRENCY,
  SUMMARY_INPUT_MAX_LENGTH,
  SUMMARY_MAX_LENGTH,
  SUMMARY_MIN_LENGTH,
  SUMMARY_MODEL,
} from './config.js';
import { fetchArticleText, truncate } from './fetcher.js';
import { computeHeat } from './processor.js';
import type { Article } from './types.js';

const SYSTEM_PROMPT = `你是一名资深科技新闻编辑，负责为 AI 新闻日报撰写摘要并评估热度。
根据给定的文章标题和正文，完成两件事：
1. summary：用简体中文写一段 ${SUMMARY_MIN_LENGTH}-${SUMMARY_MAX_LENGTH} 字的摘要（含标点和英文字母，最好在 70-90 字，绝不超过 ${SUMMARY_MAX_LENGTH} 字）。
   只写 2-3 个短句，挑最重要的信息，宁可少写一个细节也不要超长。
   要具体、精确：写清主体（公司、人物或机构）、发生了什么、关键细节（金额、数字、产品或模型名称、时间），以及影响或意义。
   不要空话套话，不要以"本文""文章""该新闻"开头。
2. heat：给出 1-100 的整数热度分，衡量这条新闻在 AI 行业的关注度和影响力。参考标准：
   90-100 行业重大事件（头部公司重磅发布、巨额融资或收购、重大监管或诉讼）；
   70-89 知名公司的重要动态；40-69 一般行业新闻；1-39 小众项目、个人作品或观点类内容。
只根据给定内容写作，不要编造其中没有的事实；正文为空时只根据标题概括。
只输出 JSON，格式为：{"summary": "摘要", "heat": 数字}`;

/**
 * AI 返回的摘要与热度。
 * Summary and heat returned by the AI.
 */
interface SummaryResult {
  /** 摘要 / Summary */
  summary: string;
  /** AI 热度评分 1-100，无法解析时为 undefined / AI heat rating 1-100, undefined if unparseable */
  heat?: number;
}

/**
 * 统计字符数（按码点，中文一个字算 1）。
 * Count characters by code point (one Chinese character counts as 1).
 * @param text - 文本 / Text
 * @returns 字符数 / Character count
 */
function charCount(text: string): number {
  return Array.from(text).length;
}

/**
 * 解析模型输出的 JSON；格式不对时把整段文字当作摘要。
 * Parse the model's JSON output; if malformed, treat the whole text as the summary.
 * @param content - 模型输出 / Model output
 * @returns 摘要与热度 / Summary and heat
 */
export function parseSummaryResult(content: string): SummaryResult {
  try {
    // 兼容模型用 ```json 代码块包裹的情况 / Tolerate output wrapped in a ```json fence
    const json = content.replace(/^```(?:json)?\s*|\s*```$/g, '');
    const data = JSON.parse(json) as { summary?: unknown; heat?: unknown };
    const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
    const heat = Number(data.heat);
    return { summary, heat: Number.isFinite(heat) ? Math.min(100, Math.max(1, Math.round(heat))) : undefined };
  } catch {
    return { summary: content.trim() };
  }
}

/**
 * 让摘要不超过上限：优先在句末标点处截断（保证不少于下限），实在不行才加省略号。
 * Fit a summary within the limit: cut at the last sentence end when that keeps it above the minimum, otherwise truncate with an ellipsis.
 * @param text - 摘要 / Summary
 * @returns 不超过上限的摘要 / Summary within the limit
 */
export function fitSummary(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= SUMMARY_MAX_LENGTH) return text;
  const head = chars.slice(0, SUMMARY_MAX_LENGTH);
  for (const marks of ['。！？', '；', '，']) {
    for (let i = head.length - 1; i + 1 >= SUMMARY_MIN_LENGTH; i--) {
      if (marks.includes(head[i])) return `${head.slice(0, i).join('')}。`;
    }
  }
  return truncate(text, SUMMARY_MAX_LENGTH);
}

/**
 * 准备送给 AI 的正文：RSS 简介太短时抓取原文网页补充。
 * Build the body text sent to the AI: fetch the article page when the RSS description is too short.
 * @param article - 文章 / Article
 * @returns 正文 / Body text
 */
async function buildContext(article: Article): Promise<string> {
  let text = article.description;
  if (charCount(text) < ARTICLE_CONTEXT_MIN_LENGTH) {
    const page = await fetchArticleText(article.link);
    if (page) text = `${text} ${page}`.trim();
  }
  return truncate(text, SUMMARY_INPUT_MAX_LENGTH);
}

/**
 * 调用 DeepSeek 为单篇文章生成 50-100 字摘要与热度评分；长度不符时要求重写一次。
 * Ask DeepSeek for a 50-100 character summary and a heat rating; asks for one rewrite if the length is off.
 * @param client - OpenAI 兼容客户端 / OpenAI-compatible client
 * @param article - 文章 / Article
 * @returns 摘要与热度；无输出时返回 null / Summary and heat, or null on empty output
 */
async function summarizeOne(client: OpenAI, article: Article): Promise<SummaryResult | null> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `<title>${article.title}</title>\n<content>${await buildContext(article)}</content>` },
  ];

  /**
   * 发起一次补全请求。
   * Send one completion request.
   * @returns 模型输出 / Model output
   */
  const complete = async (): Promise<string> => {
    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & { thinking: { type: 'disabled' } } = {
      model: SUMMARY_MODEL,
      max_tokens: 1024,
      // 摘要不需要推理，关闭思考模式更快更省（DeepSeek 扩展参数）
      // Summaries need no reasoning; disabling thinking is faster and cheaper (DeepSeek extension)
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      messages,
    };
    const completion = await client.chat.completions.create(params);
    return completion.choices[0]?.message.content?.trim() ?? '';
  };

  let content = await complete();
  let result = parseSummaryResult(content);
  const len = charCount(result.summary);
  // 长度不符或缺少热度时，指出问题让模型重写一次
  // If the length is off or heat is missing, point out the problem and ask for one rewrite
  const problems: string[] = [];
  if (len > SUMMARY_MAX_LENGTH) {
    problems.push(`summary 现在是 ${len} 字，超过 ${SUMMARY_MAX_LENGTH} 字上限，请删掉次要细节，压缩到 80 字左右`);
  } else if (len < SUMMARY_MIN_LENGTH) {
    problems.push(`summary 现在只有 ${len} 字，少于 ${SUMMARY_MIN_LENGTH} 字，请补充正文中的关键细节，扩写到 70 字左右`);
  }
  if (result.heat === undefined) problems.push('缺少 heat 字段，请给出 1-100 的整数热度分');
  if (result.summary && problems.length > 0) {
    messages.push({ role: 'assistant', content }, { role: 'user', content: `${problems.join('；')}。仍只输出 JSON。` });
    content = await complete();
    const retry = parseSummaryResult(content);
    if (retry.summary) result = { summary: retry.summary, heat: retry.heat ?? result.heat };
  }

  if (!result.summary) return null;
  // 重写后仍超长时按句截断，保证页面上不超过上限
  // Cut at a sentence end if still too long after the rewrite, so the page never exceeds the limit
  return { ...result, summary: fitSummary(result.summary) };
}

/**
 * 用 DeepSeek 为所有文章生成摘要和热度，原地替换 summary 与 heat。
 * 单篇失败时保留截取的摘要，不影响其他文章。
 * Generate summaries and heat scores for all articles with DeepSeek, replacing `summary` and `heat` in place.
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
        const result = await summarizeOne(client, article);
        if (result) {
          article.summary = result.summary;
          article.heat = computeHeat(result.heat, article.points);
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
