import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CRON_TIMEZONE, FEEDS } from './config.js';
import { formatDateTime } from './time.js';
import type { DigestDay, DigestHistory, StoredArticle } from './types.js';

/** 日报页面文件名 / Digest page filename */
export const PAGE_FILE = 'ai-news-digest.html';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 转义 HTML 特殊字符。
 * Escape HTML special characters.
 * @param text - 原文本 / Raw text
 * @returns 转义后的文本 / Escaped text
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 只允许 http(s) 链接，防止 javascript: 等协议注入。
 * Allow only http(s) links to prevent javascript: and similar injections.
 * @param url - 原始链接 / Raw URL
 * @returns 安全链接，不合法时返回 "#" / Safe URL, or "#" if invalid
 */
function safeHref(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '#';
  } catch {
    return '#';
  }
}

/**
 * 渲染单篇文章。
 * Render a single article.
 * @param a - 文章 / Article
 * @returns HTML 片段 / HTML fragment
 */
function renderArticle(a: StoredArticle): string {
  const heat =
    a.points !== undefined ? `<span class="heat">🔥 ${a.points} points · ${a.comments ?? 0} 评论</span>` : '';
  const summary = a.summary ? `<p class="summary">${escapeHtml(a.summary)}</p>` : '';
  return `<li class="item">
          <a class="title" href="${escapeHtml(safeHref(a.link))}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title)}</a>
          <div class="meta"><span class="src">${escapeHtml(a.source)}</span><time datetime="${escapeHtml(a.pubDate)}">${formatDateTime(new Date(a.pubDate))}</time>${heat}</div>
          ${summary}
        </li>`;
}

/**
 * 渲染某一天的日报区块。
 * Render the section for a single day.
 * @param day - 当天日报 / Day digest
 * @param open - 是否默认展开 / Whether expanded by default
 * @returns HTML 片段 / HTML fragment
 */
function renderDay(day: DigestDay, open: boolean): string {
  const counts = new Map<string, number>();
  for (const a of day.articles) counts.set(a.source, (counts.get(a.source) ?? 0) + 1);
  const breakdown = [...counts].map(([s, n]) => `${escapeHtml(s)} ${n}`).join(' · ');

  // 日期本身就是日历日，用 UTC 解析避免时区偏移
  // The date is a calendar day; parse as UTC to avoid timezone shifts
  const weekday = WEEKDAYS[new Date(`${day.date}T00:00:00Z`).getUTCDay()];
  const failed = day.failed.length
    ? `<p class="warn">⚠️ 抓取失败：${day.failed.map((f) => `${escapeHtml(f.source)}（${escapeHtml(f.error)}）`).join('，')}</p>`
    : '';
  const body = day.articles.length
    ? `<ol class="list">\n        ${day.articles.map(renderArticle).join('\n        ')}\n      </ol>`
    : '<p class="empty">该时间段内没有新文章。</p>';

  return `<details class="day" id="d-${day.date}"${open ? ' open' : ''}>
      <summary>
        <span class="date">${day.date}<small>${weekday}</small></span>
        <span class="count">${day.articles.length} 篇</span>
      </summary>
      <div class="stats">📊 ${breakdown || '无'} ｜ 🕒 最近 ${day.hours} 小时 ｜ 更新于 ${formatDateTime(new Date(day.generatedAt))}</div>
      ${failed}
      ${body}
    </details>`;
}

/**
 * 生成包含全部日期的 HTML 日报页面，最新一天在最上方并默认展开。
 * Render the HTML digest page with every day, newest first and expanded by default.
 * @param history - 历史记录 / History
 * @param now - 生成时间 / Generation time
 * @returns HTML 文本 / HTML text
 */
export function renderHtml(history: DigestHistory, now: Date): string {
  const total = history.days.reduce((n, d) => n + d.articles.length, 0);
  const nav = history.days.map((d) => `<a href="#d-${d.date}">${d.date.slice(5)}</a>`).join('');
  const days = history.days.map((d, i) => renderDay(d, i === 0)).join('\n    ');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI 新闻日报</title>
  <meta name="description" content="每日 AI 新闻聚合：${FEEDS.map((f) => escapeHtml(f.name)).join('、')}">
  <style>
    :root {
      --bg: #f7f7f5; --card: #ffffff; --text: #1d1d1f; --muted: #6e6e73; --line: #e5e5e2;
      --accent: #3b5bdb; --accent-soft: #edf2ff; --warn: #c2410c;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111113; --card: #1c1c1f; --text: #ececf1; --muted: #9a9aa3; --line: #2c2c31;
        --accent: #8ca2ff; --accent-soft: #23283d; --warn: #fb923c;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--bg); color: var(--text);
      font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .wrap { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
    header h1 { margin: 0 0 4px; font-size: 28px; letter-spacing: -0.02em; }
    header p { margin: 0; color: var(--muted); font-size: 14px; }
    nav { display: flex; flex-wrap: wrap; gap: 6px; margin: 20px 0 24px; }
    nav a {
      padding: 2px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent);
      font-size: 13px; text-decoration: none; font-variant-numeric: tabular-nums;
    }
    .day { background: var(--card); border: 1px solid var(--line); border-radius: 12px; margin-bottom: 14px; }
    .day > summary {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: 14px 18px; cursor: pointer; list-style: none;
    }
    .day > summary::-webkit-details-marker { display: none; }
    .day > summary::before { content: "▸"; color: var(--muted); margin-right: 8px; transition: transform .15s; }
    .day[open] > summary::before { transform: rotate(90deg); }
    .date { flex: 1; font-weight: 600; font-size: 18px; font-variant-numeric: tabular-nums; }
    .date small { margin-left: 8px; color: var(--muted); font-weight: 400; font-size: 14px; }
    .count { color: var(--muted); font-size: 14px; }
    .stats, .warn, .empty { margin: 0; padding: 0 18px 10px; font-size: 13px; color: var(--muted); }
    .warn { color: var(--warn); }
    .list { margin: 0; padding: 0 18px 8px; list-style: none; counter-reset: n; }
    .item { padding: 12px 0; border-top: 1px solid var(--line); counter-increment: n; }
    .title { color: var(--text); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
    .title::before { content: counter(n) ". "; color: var(--muted); font-weight: 400; }
    .title:hover { color: var(--accent); }
    .meta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 2px; font-size: 13px; color: var(--muted); }
    .src { color: var(--accent); }
    .summary { margin: 6px 0 0; font-size: 15px; }
    footer { margin-top: 32px; color: var(--muted); font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>AI 新闻日报</h1>
      <p>共 ${history.days.length} 天 · ${total} 篇 · 最后更新 ${formatDateTime(now)}（${CRON_TIMEZONE}）</p>
    </header>
    <nav>${nav}</nav>
    ${days}
    <footer>由 ai-news-digest 自动生成 · 来源：${FEEDS.map((f) => escapeHtml(f.name)).join(' / ')}</footer>
  </div>
</body>
</html>
`;
}

/**
 * 写出 HTML 页面：ai-news-digest.html，并复制一份为 index.html 供 GitHub Pages 根路径访问。
 * Write the HTML page as ai-news-digest.html, plus an index.html copy for the GitHub Pages root URL.
 * @param html - 页面内容 / Page content
 * @param outDir - 输出目录 / Output directory
 * @returns 写入的页面路径 / Written page path
 */
export async function writePage(html: string, outDir: string): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, PAGE_FILE);
  await Promise.all([
    writeFile(file, html, 'utf8'),
    writeFile(path.join(outDir, 'index.html'), html, 'utf8'),
    // 关闭 Jekyll 处理，原样发布静态文件 / Disable Jekyll so files are served as-is
    writeFile(path.join(outDir, '.nojekyll'), '', 'utf8'),
  ]);
  return file;
}
