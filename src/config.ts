import type { FeedSource } from './types.js';

/**
 * 要抓取的 RSS 源列表。
 * List of RSS feeds to fetch.
 *
 * Hacker News 没有官方 AI 标签，这里用 hnrss.org 按关键词 "AI" 搜索，
 * 拉取最新 100 条后按热度（points）取前 3。
 * Hacker News has no official AI tag, so we use hnrss.org keyword search for "AI",
 * fetch the latest 100 items, and keep the top 3 by points.
 */
export const FEEDS: FeedSource[] = [
  {
    name: 'TechCrunch',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
  },
  {
    name: 'The Verge',
    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
  },
  {
    name: 'Hacker News',
    url: 'https://hnrss.org/newest?q=AI&count=100',
    topByPoints: 3,
  },
];

/** 默认时间窗口（小时）/ Default time window in hours */
export const DEFAULT_HOURS = 24;

/** 默认输出目录（GitHub Pages 从这里发布）/ Default output directory (published by GitHub Pages) */
export const DEFAULT_OUT_DIR = 'docs';

/** 摘要最小长度（字符）/ Min summary length in characters */
export const SUMMARY_MIN_LENGTH = 50;

/** 摘要最大长度（字符）/ Max summary length in characters */
export const SUMMARY_MAX_LENGTH = 100;

/**
 * RSS 简介短于该长度时，抓取原文网页补充上下文，让摘要更具体。
 * When the RSS description is shorter than this, fetch the article page for extra context so summaries are more specific.
 */
export const ARTICLE_CONTEXT_MIN_LENGTH = 400;

/**
 * HN 热度在综合热度中的权重（其余为 AI 评分）。
 * Weight of HN points in the overall heat score (the rest is the AI rating).
 */
export const HN_HEAT_WEIGHT = 0.4;

/** 单个请求超时（毫秒）/ Per-request timeout in milliseconds */
export const REQUEST_TIMEOUT_MS = 10_000;

/** DeepSeek API 地址（OpenAI 兼容格式）/ DeepSeek API base URL (OpenAI-compatible) */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/** AI 摘要使用的 DeepSeek 模型 / DeepSeek model used for AI summaries */
export const SUMMARY_MODEL = 'deepseek-flash';

/** AI 摘要的最大并发请求数 / Max concurrent requests for AI summaries */
export const SUMMARY_CONCURRENCY = 5;

/** 送给 AI 的 description 最大长度（字符），防止超长正文浪费 token / Max description length sent to AI, to avoid wasting tokens */
export const SUMMARY_INPUT_MAX_LENGTH = 3000;

/**
 * 命中任一分类即视为推广稿（活动宣传、赞助内容）并排除。
 * Posts with any matching category are treated as promotional (event marketing, sponsored) and excluded.
 */
export const EXCLUDE_CATEGORY_PATTERNS: RegExp[] = [
  /^TechCrunch (Disrupt|Founder Summit|Sessions|All Stage)\b/i,
  /^TC Sessions\b/i,
  /^StrictlyVC\b/i,
  /\b(Sponsored|Partner Content)\b/i,
];

/**
 * 命中任一标题规则即视为推广稿并排除（兜底没有分类的源）。
 * Posts whose title matches any rule are treated as promotional and excluded (fallback for feeds without categories).
 */
export const EXCLUDE_TITLE_PATTERNS: RegExp[] = [
  /\b\d+ days? left\b/i,
  /\blast chance to (save|register|connect)\b/i,
  /\bearly[- ]bird\b/i,
  /\bsave (up to )?\$\d/i,
  /\bregister (now|today)\b/i,
  /^sponsored\b/i,
];

/**
 * 定时模式的 cron 表达式：每天 22:00。
 * Cron expression for scheduled mode: every day at 22:00.
 */
export const CRON_SCHEDULE = '0 22 * * *';

/**
 * 定时模式使用的时区（美国东部时间，自动处理夏令时）。
 * Timezone for scheduled mode (US Eastern Time, DST handled automatically).
 */
export const CRON_TIMEZONE = 'America/New_York';

/**
 * 页面日期分组与时间显示使用的时区（中国时间）。
 * Timezone for day grouping and time display on the page (China Standard Time).
 */
export const DISPLAY_TIMEZONE = 'Asia/Shanghai';
