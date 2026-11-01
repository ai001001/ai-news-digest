import { EXCLUDE_CATEGORY_PATTERNS, EXCLUDE_TITLE_PATTERNS } from './config.js';
import type { Article, FeedSource, FetchResult } from './types.js';

/**
 * 判断文章是否为推广稿（活动宣传、赞助内容等）。
 * Check whether an article is promotional (event marketing, sponsored content, etc.).
 * @param article - 文章 / Article
 * @returns 是否为推广稿 / Whether it is promotional
 */
export function isPromotional(article: Article): boolean {
  return (
    article.categories.some((c) => EXCLUDE_CATEGORY_PATTERNS.some((re) => re.test(c))) ||
    EXCLUDE_TITLE_PATTERNS.some((re) => re.test(article.title))
  );
}

/**
 * 过滤时间窗口、排除推广稿、按热度截取、去重并按时间倒序排序。
 * Filter by time window, drop promotional posts, trim by popularity, dedupe, and sort newest first.
 * @param results - 各源抓取结果 / Per-feed fetch results
 * @param feeds - 源配置（用于读取 topByPoints）/ Feed configs (for topByPoints)
 * @param hours - 时间窗口（小时）/ Time window in hours
 * @param now - 当前时间，便于测试 / Current time, injectable for tests
 * @returns 处理后的文章 / Processed articles
 */
export function processArticles(
  results: FetchResult[],
  feeds: FeedSource[],
  hours: number,
  now: Date = new Date(),
): Article[] {
  const since = now.getTime() - hours * 60 * 60 * 1000;

  const perSource = results.flatMap(({ source, articles }) => {
    const recent = articles.filter((a) => {
      const t = a.pubDate.getTime();
      return t >= since && t <= now.getTime() && !isPromotional(a);
    });

    // 配置了 topByPoints 的源（HN）先按热度取前 N
    // For sources with topByPoints (HN), keep the top N by points first
    const top = feeds.find((f) => f.name === source)?.topByPoints;
    if (top === undefined) return recent;
    return [...recent].sort((a, b) => (b.points ?? 0) - (a.points ?? 0)).slice(0, top);
  });

  // 按链接去重，保留先出现的（原站优先于 HN 转载）
  // Dedupe by link, keeping the first occurrence (original sites before HN reposts)
  const seen = new Set<string>();
  const unique = perSource.filter((a) => {
    const key = normalizeUrl(a.link);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
}

/**
 * 常见的追踪参数，去重时忽略。
 * Common tracking parameters, ignored when deduping.
 */
const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|guccounter|guce_\w+)$/i;

/**
 * 规范化 URL 用于去重：忽略协议、www、锚点、末尾斜杠和追踪参数，保留其余查询参数
 * （例如 HN 的 item?id=，否则所有 Ask HN 帖子会被视为同一篇）。
 * Normalize a URL for deduping: ignore protocol, www, hash, trailing slash and tracking params,
 * while keeping other query params (e.g. HN's item?id=, otherwise all Ask HN posts would collide).
 * @param url - 原始链接 / Raw URL
 * @returns 规范化后的键 / Normalized key
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return `${host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}
