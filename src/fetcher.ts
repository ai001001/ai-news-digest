import Parser from 'rss-parser';
import { REQUEST_TIMEOUT_MS, SUMMARY_MAX_LENGTH } from './config.js';
import type { Article, FeedSource, FetchResult } from './types.js';

const parser = new Parser();

const USER_AGENT = 'Mozilla/5.0 (compatible; ai-news-digest/1.0; +https://github.com/)';

/** 失败重试次数 / Number of retries on failure */
const MAX_RETRIES = 2;

/**
 * 去掉 HTML 标签与实体，压缩空白。
 * Strip HTML tags and entities, collapse whitespace.
 * @param html - 原始 HTML / Raw HTML
 * @returns 纯文本 / Plain text
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 截取前 N 个字符作为摘要，超出部分用省略号表示。
 * Truncate to the first N characters, appending an ellipsis if cut.
 * @param text - 纯文本 / Plain text
 * @param max - 最大字符数 / Max character count
 * @returns 摘要 / Summary
 */
export function truncate(text: string, max: number = SUMMARY_MAX_LENGTH): string {
  // 用 Array.from 按码点切分，避免截断 emoji 等代理对
  // Split by code points so surrogate pairs (e.g. emoji) are not broken
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join('').trimEnd()}…`;
}

/**
 * 解析 hnrss 的 description：提取热度、评论数和正文（Ask HN 等自带文字的帖子）。
 * Parse an hnrss description: extract points, comment count and body text (for Ask HN etc.).
 * @param html - description HTML
 * @returns 热度、评论数与正文 / Points, comments and body text
 */
function parseHnDescription(html: string): { points: number; comments: number; text: string } {
  const points = Number(/Points:\s*(\d+)/.exec(html)?.[1] ?? 0);
  const comments = Number(/#\s*Comments:\s*(\d+)/.exec(html)?.[1] ?? 0);
  const text = stripHtml(
    html.replace(/<p>\s*(Article URL|Comments URL|Points|#\s*Comments):[\s\S]*?<\/p>/gi, ''),
  );
  return { points, comments, text };
}

/**
 * 把一条 RSS item 转成标准化的 Article；缺标题、链接或时间的返回 null。
 * Convert an RSS item into a normalized Article; returns null if title, link or date is missing.
 * @param item - rss-parser 的 item / rss-parser item
 * @param feed - 源配置 / Feed config
 * @returns 文章或 null / Article or null
 */
function toArticle(item: Parser.Item & { summary?: string }, feed: FeedSource): Article | null {
  const title = item.title?.trim();
  const link = item.link?.trim();
  const rawDate = item.isoDate ?? item.pubDate;
  if (!title || !link || !rawDate) return null;

  const pubDate = new Date(rawDate);
  if (Number.isNaN(pubDate.getTime())) return null;

  // rss-parser 的分类可能是字符串或 { _: string } 对象
  // rss-parser categories may be strings or { _: string } objects
  const categories = ((item.categories ?? []) as unknown[])
    .map((c) => (typeof c === 'string' ? c : ((c as { _?: string })?._ ?? '')).trim())
    .filter(Boolean);

  const article: Article = { title, link, pubDate, source: feed.name, categories, description: '', summary: '' };

  if (feed.topByPoints !== undefined) {
    const { points, comments, text } = parseHnDescription(item.content ?? '');
    article.points = points;
    article.comments = comments;
    article.description = text;
  } else {
    const raw = item.contentSnippet || item.summary || item.content || '';
    article.description = stripHtml(raw);
  }
  article.summary = truncate(article.description);

  return article;
}

/**
 * 请求 URL 并返回文本；遇到 5xx 或网络错误时按退避重试。
 * Fetch a URL as text; retry with backoff on 5xx or network errors.
 * @param url - 请求地址 / URL to fetch
 * @param retries - 最大重试次数 / Max retry count
 * @returns 响应文本 / Response body text
 */
async function fetchWithRetry(url: string, retries: number = MAX_RETRIES): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return await res.text();
      const err = new Error(`HTTP ${res.status} ${res.statusText}`.trim());
      // 4xx 不重试 / Do not retry 4xx
      if (res.status < 500 || attempt >= retries) throw err;
    } catch (err) {
      if (attempt >= retries || (err instanceof Error && /^HTTP 4/.test(err.message))) throw err;
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
}

/**
 * 抓取并解析单个 RSS 源。
 * Fetch and parse a single RSS feed.
 * @param feed - 源配置 / Feed config
 * @returns 该源的文章列表 / Articles from the feed
 */
async function fetchFeed(feed: FeedSource): Promise<Article[]> {
  const parsed = await parser.parseString(await fetchWithRetry(feed.url));
  return parsed.items
    .map((item) => toArticle(item, feed))
    .filter((a): a is Article => a !== null);
}

/**
 * 并发抓取所有源，单个源失败不影响其他源。
 * Fetch all feeds concurrently; one failing feed does not affect the others.
 * @param feeds - 源配置列表 / Feed configs
 * @returns 每个源的抓取结果 / Per-feed fetch results
 */
export async function fetchAll(feeds: FeedSource[]): Promise<FetchResult[]> {
  const settled = await Promise.allSettled(feeds.map(fetchFeed));
  return settled.map((r, i) =>
    r.status === 'fulfilled'
      ? { source: feeds[i].name, articles: r.value }
      : { source: feeds[i].name, articles: [], error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
  );
}
