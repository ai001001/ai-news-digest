import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compareByHeat, normalizeUrl } from './processor.js';
import { formatDate } from './time.js';
import type { Article, DigestDay, DigestHistory, FetchResult, StoredArticle } from './types.js';

/** 历史数据文件名 / History data filename */
export const HISTORY_FILE = 'history.json';

/**
 * 读取历史记录；文件不存在时返回空历史。
 * Load the history; returns an empty history if the file does not exist.
 * @param outDir - 输出目录 / Output directory
 * @returns 历史记录 / History
 */
export async function loadHistory(outDir: string): Promise<DigestHistory> {
  try {
    const raw = await readFile(path.join(outDir, HISTORY_FILE), 'utf8');
    const data = JSON.parse(raw) as DigestHistory;
    return { days: Array.isArray(data.days) ? data.days : [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { days: [] };
    throw err;
  }
}

/**
 * 写入历史记录，目录不存在时自动创建。
 * Save the history, creating the directory if needed.
 * @param history - 历史记录 / History
 * @param outDir - 输出目录 / Output directory
 * @returns 写入的文件路径 / Written file path
 */
export async function saveHistory(history: DigestHistory, outDir: string): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, HISTORY_FILE);
  await writeFile(file, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * 去掉历史中已收录过的文章（按规范化 URL），避免同一篇在多天重复出现。
 * Drop articles already present in the history (by normalized URL) so the same story does not repeat across days.
 * @param articles - 本次处理后的文章 / Articles from this run
 * @param history - 历史记录 / History
 * @returns 新文章 / New articles
 */
export function dropSeen(articles: Article[], history: DigestHistory): Article[] {
  const seen = new Set(history.days.flatMap((d) => d.articles.map((a) => normalizeUrl(a.link))));
  return articles.filter((a) => !seen.has(normalizeUrl(a.link)));
}

/**
 * 把文章转成存储格式。
 * Convert an article into its stored form.
 * @param a - 文章 / Article
 * @returns 存储格式的文章 / Stored article
 */
function toStored(a: Article): StoredArticle {
  const stored: StoredArticle = { title: a.title, link: a.link, pubDate: a.pubDate.toISOString(), source: a.source, summary: a.summary };
  if (a.points !== undefined) stored.points = a.points;
  if (a.comments !== undefined) stored.comments = a.comments;
  if (a.heat !== undefined) stored.heat = a.heat;
  return stored;
}

/**
 * 把本次运行的新文章合并进当天的日报：当天已存在则追加（不覆盖已有内容），否则新建一天。
 * Merge this run's new articles into today's digest: append if the day exists (never overwriting it), otherwise add a new day.
 * @param history - 历史记录（原地修改）/ History (modified in place)
 * @param articles - 已去重的新文章 / Deduped new articles
 * @param results - 各源抓取结果（用于记录失败）/ Per-feed results (for recording failures)
 * @param hours - 时间窗口（小时）/ Time window in hours
 * @param now - 生成时间 / Generation time
 * @returns 当天的日报 / Today's digest
 */
export function mergeDay(
  history: DigestHistory,
  articles: Article[],
  results: FetchResult[],
  hours: number,
  now: Date,
): DigestDay {
  const date = formatDate(now);
  let day = history.days.find((d) => d.date === date);
  if (!day) {
    day = { date, generatedAt: '', hours, failed: [], articles: [] };
    history.days.push(day);
  }

  day.generatedAt = now.toISOString();
  day.hours = hours;
  day.failed = results.filter((r) => r.error).map((r) => ({ source: r.source, error: r.error ?? '' }));
  day.articles = [...day.articles, ...articles.map(toStored)].sort(compareByHeat);

  history.days.sort((a, b) => b.date.localeCompare(a.date));
  return day;
}

/**
 * 找出需要补全的历史文章：没有热度，或摘要短于最小长度。
 * Find stored articles that need a backfill: missing heat, or a summary shorter than the minimum.
 * @param history - 历史记录 / History
 * @param minLength - 摘要最小长度 / Minimum summary length
 * @returns 待补全的文章（引用历史中的原对象）/ Articles to backfill (references into the history)
 */
export function findStale(history: DigestHistory, minLength: number): StoredArticle[] {
  return history.days.flatMap((d) => d.articles.filter((a) => a.heat === undefined || Array.from(a.summary).length < minLength));
}

/**
 * 按热度重新排序每一天的文章。
 * Re-sort every day's articles by heat.
 * @param history - 历史记录（原地修改）/ History (modified in place)
 */
export function sortDays(history: DigestHistory): void {
  for (const d of history.days) d.articles.sort(compareByHeat);
}
