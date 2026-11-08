/**
 * RSS 源配置。
 * RSS feed source configuration.
 */
export interface FeedSource {
  /** 来源显示名称 / Display name of the source */
  name: string;
  /** RSS / Atom 地址 / RSS or Atom feed URL */
  url: string;
  /**
   * 按热度只保留前 N 条（可选，不设则全部保留）。
   * Keep only the top N items by popularity (optional; keep all if omitted).
   */
  topByPoints?: number;
}

/**
 * 标准化后的文章。
 * A normalized article.
 */
export interface Article {
  /** 标题 / Title */
  title: string;
  /** 文章链接 / Article URL */
  link: string;
  /** 发布时间 / Publish time */
  pubDate: Date;
  /** 来源名称 / Source name */
  source: string;
  /** RSS 分类标签，用于过滤推广稿 / RSS category tags, used to filter promotional posts */
  categories: string[];
  /** 清洗后的完整 description，作为 AI 摘要的输入 / Cleaned full description, used as AI summary input */
  description: string;
  /**
   * 摘要：默认截取 description 前 100 字符，启用 AI 后替换为 DeepSeek 生成的 50-100 字总结。
   * Summary: truncated description by default, replaced by a 50-100 character DeepSeek summary when AI is enabled.
   */
  summary: string;
  /** HN 热度分数（仅 HN 有）/ HN points (HN only) */
  points?: number;
  /** HN 评论数（仅 HN 有）/ HN comment count (HN only) */
  comments?: number;
  /**
   * 综合热度 0-100（AI 评分与 HN 热度加权），用于日报内排序。
   * Overall heat score 0-100 (weighted AI rating and HN points), used for ordering within a day.
   */
  heat?: number;
}

/**
 * 单个源的抓取结果。
 * Fetch result for a single source.
 */
export interface FetchResult {
  /** 来源名称 / Source name */
  source: string;
  /** 抓取到的文章 / Fetched articles */
  articles: Article[];
  /** 失败时的错误信息 / Error message on failure */
  error?: string;
}

/**
 * 存入历史记录的文章（只保留渲染所需字段，日期序列化为 ISO 字符串）。
 * An article stored in history (only fields needed for rendering; dates serialized as ISO strings).
 */
export interface StoredArticle {
  /** 标题 / Title */
  title: string;
  /** 文章链接 / Article URL */
  link: string;
  /** 发布时间（ISO 8601）/ Publish time (ISO 8601) */
  pubDate: string;
  /** 来源名称 / Source name */
  source: string;
  /** 摘要 / Summary */
  summary: string;
  /** HN 热度分数（仅 HN 有）/ HN points (HN only) */
  points?: number;
  /** HN 评论数（仅 HN 有）/ HN comment count (HN only) */
  comments?: number;
  /** 综合热度 0-100 / Overall heat score 0-100 */
  heat?: number;
}

/**
 * 某一天的日报。
 * The digest for a single day.
 */
export interface DigestDay {
  /** 日期 "YYYY-MM-DD"（DISPLAY_TIMEZONE 时区）/ Date "YYYY-MM-DD" in DISPLAY_TIMEZONE */
  date: string;
  /** 最近一次生成时间（ISO 8601）/ Last generation time (ISO 8601) */
  generatedAt: string;
  /** 时间窗口（小时）/ Time window in hours */
  hours: number;
  /** 最近一次运行中抓取失败的源 / Feeds that failed in the latest run */
  failed: { source: string; error: string }[];
  /** 当天收录的文章（按热度从高到低）/ Articles of the day, hottest first */
  articles: StoredArticle[];
}

/**
 * 全部日报历史，按日期倒序。
 * The full digest history, newest day first.
 */
export interface DigestHistory {
  /** 每天的日报 / Daily digests */
  days: DigestDay[];
  /**
   * 因未进入每日前 N 而被移除的文章链接（规范化后），用于跨天去重。
   * Normalized links of articles dropped for missing the daily top N, kept for cross-day dedupe.
   */
  dropped?: string[];
}
