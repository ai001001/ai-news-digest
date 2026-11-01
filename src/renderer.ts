import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DISPLAY_TIMEZONE, FEEDS } from './config.js';
import { compareByHeat } from './processor.js';
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
 * 热度等级，对应不同颜色。
 * Heat tier, mapped to a color.
 * @param heat - 热度 / Heat score
 * @returns CSS 类名 / CSS class name
 */
function heatTier(heat: number): string {
  if (heat >= 80) return 'hot';
  if (heat >= 60) return 'warm';
  return 'mild';
}

/**
 * 渲染单篇文章。
 * Render a single article.
 * @param a - 文章 / Article
 * @param rank - 当天热度排名（从 1 开始）/ Heat rank within the day (1-based)
 * @returns HTML 片段 / HTML fragment
 */
function renderArticle(a: StoredArticle, rank: number): string {
  const heat =
    a.heat !== undefined
      ? `<span class="heat ${heatTier(a.heat)}" title="综合热度 / Heat score"><span class="bar"><i style="width:${a.heat}%"></i></span><b>🔥 ${a.heat}</b></span>`
      : '';
  const hn = a.points !== undefined ? `<span>▲ ${a.points} points · ${a.comments ?? 0} 评论</span>` : '';
  const summary = a.summary ? `<p class="summary">${escapeHtml(a.summary)}</p>` : '';
  const search = escapeHtml(`${a.title} ${a.summary} ${a.source}`.toLowerCase());
  return `<li class="item" data-search="${search}">
          <span class="rank${rank <= 3 ? ' top' : ''}">${rank}</span>
          <div class="body">
            <a class="title" href="${escapeHtml(safeHref(a.link))}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title)}</a>
            ${summary}
            <div class="meta"><span class="src">${escapeHtml(a.source)}</span><time datetime="${escapeHtml(a.pubDate)}">${formatDateTime(new Date(a.pubDate))}</time>${hn}${heat}</div>
          </div>
        </li>`;
}

/**
 * 取日历日的星期（日期本身就是日历日，用 UTC 解析避免时区偏移）。
 * Get the weekday of a calendar date (parsed as UTC to avoid timezone shifts).
 * @param date - "YYYY-MM-DD"
 * @returns 星期 / Weekday
 */
function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/**
 * 渲染某一天的日报区块。
 * Render the section for a single day.
 * @param day - 当天日报 / Day digest
 * @param newer - 后一天（更新）的日期 / Date of the next (newer) day
 * @param older - 前一天（更早）的日期 / Date of the previous (older) day
 * @returns HTML 片段 / HTML fragment
 */
function renderDay(day: DigestDay, newer: string | undefined, older: string | undefined): string {
  const counts = new Map<string, number>();
  for (const a of day.articles) counts.set(a.source, (counts.get(a.source) ?? 0) + 1);
  const breakdown = [...counts].map(([s, n]) => `${escapeHtml(s)} ${n}`).join(' · ');

  const [y, m, d] = day.date.split('-');
  const failed = day.failed.length
    ? `<p class="warn">⚠️ 抓取失败：${day.failed.map((f) => `${escapeHtml(f.source)}（${escapeHtml(f.error)}）`).join('，')}</p>`
    : '';
  const articles = [...day.articles].sort(compareByHeat);
  const body = articles.length
    ? `<ol class="list">\n        ${articles.map((a, i) => renderArticle(a, i + 1)).join('\n        ')}\n      </ol>`
    : '<p class="empty">该时间段内没有新文章。</p>';
  const pager = `<div class="pager">${
    older ? `<a href="#d-${older}">← ${older}</a>` : '<span></span>'
  }${newer ? `<a href="#d-${newer}">${newer} →</a>` : '<span></span>'}</div>`;

  return `<section class="day" id="d-${day.date}" data-date="${day.date}">
      <header class="day-head">
        <h2>${y} 年 ${Number(m)} 月 ${Number(d)} 日<small>${weekdayOf(day.date)}</small></h2>
        <div class="stats">共 ${day.articles.length} 篇 · 按热度排序 ｜ 📊 ${breakdown || '无'} ｜ 🕒 最近 ${day.hours} 小时 · 更新于 ${formatDateTime(new Date(day.generatedAt))}</div>
        ${failed}
      </header>
      ${body}
      ${pager}
    </section>`;
}

/**
 * 渲染左侧的 年 › 月 › 日 目录树：最新的年份和月份默认展开。
 * Render the sidebar year › month › day tree, with the latest year and month expanded by default.
 * @param days - 按日期倒序的日报 / Day digests, newest first
 * @returns HTML 片段 / HTML fragment
 */
function renderTree(days: DigestDay[]): string {
  const years = new Map<string, Map<string, DigestDay[]>>();
  for (const day of days) {
    const [y, m] = day.date.split('-');
    const months = years.get(y) ?? new Map<string, DigestDay[]>();
    months.set(m, [...(months.get(m) ?? []), day]);
    years.set(y, months);
  }

  const sum = (list: DigestDay[]): number => list.reduce((n, d) => n + d.articles.length, 0);
  return [...years]
    .map(([y, months], yi) => {
      const monthHtml = [...months]
        .map(([m, list], mi) => {
          const links = list
            .map(
              (d) =>
                `<li><a href="#d-${d.date}" data-date="${d.date}"><span class="dd">${d.date.slice(8)}</span><span class="wd">${weekdayOf(d.date)}</span><span class="badge">${d.articles.length}</span></a></li>`,
            )
            .join('');
          return `<details class="month" data-key="${y}-${m}"${yi === 0 && mi === 0 ? ' open' : ''}>
            <summary><span>${Number(m)} 月</span><span class="badge">${sum(list)}</span></summary>
            <ul>${links}</ul>
          </details>`;
        })
        .join('');
      const total = sum([...months.values()].flat());
      return `<details class="year" data-key="${y}"${yi === 0 ? ' open' : ''}>
          <summary><span>${y} 年</span><span class="badge">${total}</span></summary>
          ${monthHtml}
        </details>`;
    })
    .join('\n        ');
}

/** 页面交互脚本：按日期切换、搜索、移动端目录开关 / Page script: switch days, search, mobile tree toggle */
const SCRIPT = `
(() => {
  document.body.classList.add('js');
  const days = [...document.querySelectorAll('.day')];
  const links = [...document.querySelectorAll('.tree a[data-date]')];
  const sidebar = document.querySelector('.sidebar');
  const q = document.getElementById('q');
  const hint = document.getElementById('hint');

  // 显示指定日期，并展开它所在的年、月 / Show a date and expand its year and month
  const show = (date, scroll) => {
    const target = days.find((d) => d.dataset.date === date) || days[0];
    if (!target) return;
    days.forEach((d) => d.classList.toggle('active', d === target));
    links.forEach((a) => {
      const on = a.dataset.date === target.dataset.date;
      a.classList.toggle('active', on);
      if (on) {
        let el = a.parentElement;
        while (el && el !== sidebar) {
          if (el.tagName === 'DETAILS') el.open = true;
          el = el.parentElement;
        }
      }
    });
    if (scroll) window.scrollTo({ top: 0 });
  };
  const fromHash = () => decodeURIComponent(location.hash.replace(/^#d-/, ''));
  window.addEventListener('hashchange', () => {
    if (q.value) { q.value = ''; search(); }
    show(fromHash(), true);
    sidebar.classList.remove('open');
  });

  // 搜索：在所有日期中过滤标题、摘要和来源 / Search: filter titles, summaries and sources across all days
  const search = () => {
    const term = q.value.trim().toLowerCase();
    document.body.classList.toggle('searching', !!term);
    let hits = 0;
    days.forEach((d) => {
      let n = 0;
      d.querySelectorAll('.item').forEach((it) => {
        const ok = !term || it.dataset.search.includes(term);
        it.hidden = !ok;
        if (ok) n++;
      });
      d.classList.toggle('nohit', !!term && n === 0);
      hits += n;
      const link = links.find((a) => a.dataset.date === d.dataset.date);
      if (link) link.classList.toggle('dim', !!term && n === 0);
    });
    hint.textContent = term ? '找到 ' + hits + ' 篇' : '';
  };
  q.addEventListener('input', search);
  q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { q.value = ''; search(); } });

  document.getElementById('toggle').addEventListener('click', () => sidebar.classList.toggle('open'));
  show(fromHash(), false);
})();
`;

/**
 * 生成包含全部日期的 HTML 日报页面：左侧按年月日分类导航，右侧显示所选日期，当天文章按热度排序。
 * Render the HTML digest page: a year/month/day sidebar on the left, the selected day on the right, articles sorted by heat.
 * @param history - 历史记录 / History
 * @param now - 生成时间 / Generation time
 * @returns HTML 文本 / HTML text
 */
export function renderHtml(history: DigestHistory, now: Date): string {
  const total = history.days.reduce((n, d) => n + d.articles.length, 0);
  const days = history.days
    .map((d, i) => renderDay(d, history.days[i - 1]?.date, history.days[i + 1]?.date))
    .join('\n    ');
  const sources = FEEDS.map((f) => escapeHtml(f.name));

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI 新闻日报</title>
  <meta name="description" content="每日 AI 新闻聚合：${sources.join('、')}">
  <style>
    :root {
      --bg: #f6f6f3; --card: #ffffff; --text: #1d1d1f; --muted: #6e6e73; --line: #e6e6e1;
      --accent: #3b5bdb; --accent-soft: #edf2ff; --warn: #c2410c;
      --hot: #e03131; --warm: #f08c00; --mild: #868e96;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111113; --card: #1b1b1e; --text: #ececf1; --muted: #9a9aa3; --line: #2c2c31;
        --accent: #8ca2ff; --accent-soft: #23283d; --warn: #fb923c;
        --hot: #ff6b6b; --warm: #ffa94d; --mild: #868e96;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--bg); color: var(--text);
      font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .layout { display: grid; grid-template-columns: 272px minmax(0, 1fr); max-width: 1140px; margin: 0 auto; }

    /* 左侧目录 / Sidebar */
    .sidebar {
      position: sticky; top: 0; height: 100vh; overflow-y: auto;
      padding: 28px 18px 24px; border-right: 1px solid var(--line);
    }
    .brand h1 { margin: 0; font-size: 22px; letter-spacing: -0.02em; }
    .brand p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
    #toggle { display: none; }
    .search { position: relative; margin: 18px 0 6px; }
    #q {
      width: 100%; padding: 8px 12px 8px 32px; border: 1px solid var(--line); border-radius: 10px;
      background: var(--card); color: var(--text); font: inherit; font-size: 14px; outline: none;
    }
    #q:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .search::before { content: "⌕"; position: absolute; left: 11px; top: 6px; color: var(--muted); font-size: 16px; }
    #hint { min-height: 18px; margin: 0 0 6px; font-size: 12px; color: var(--accent); }
    .tree summary {
      display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px;
      cursor: pointer; list-style: none; user-select: none;
    }
    .tree summary::-webkit-details-marker { display: none; }
    .tree summary::before { content: "▸"; color: var(--muted); font-size: 11px; transition: transform .15s; }
    .tree details[open] > summary::before { transform: rotate(90deg); }
    .tree summary:hover { background: var(--accent-soft); }
    .tree summary span:first-child { flex: 1; }
    .year > summary { font-weight: 700; font-size: 15px; }
    .month { margin-left: 12px; }
    .month > summary { font-weight: 600; font-size: 14px; }
    .tree ul { list-style: none; margin: 2px 0 6px 22px; padding: 0 0 0 10px; border-left: 1px solid var(--line); }
    .tree li a {
      display: flex; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 8px;
      color: var(--text); text-decoration: none; font-size: 14px; font-variant-numeric: tabular-nums;
    }
    .tree li a:hover { background: var(--accent-soft); }
    .tree li a.active { background: var(--accent); color: #fff; }
    .tree li a.active .wd, .tree li a.active .badge { color: #fff; background: rgba(255, 255, 255, .22); }
    .tree li a.dim { opacity: .35; }
    .dd { font-weight: 600; }
    .wd { flex: 1; color: var(--muted); font-size: 12px; }
    .badge {
      min-width: 24px; padding: 0 7px; border-radius: 999px; background: var(--accent-soft);
      color: var(--accent); font-size: 12px; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums;
    }
    .sidebar footer { margin-top: 24px; color: var(--muted); font-size: 11px; }

    /* 右侧内容 / Main content */
    main { padding: 28px 28px 64px; min-width: 0; }
    .day { margin-bottom: 40px; }
    body.js .day { display: none; }
    body.js .day.active, body.js.searching .day { display: block; }
    body.js.searching .day.nohit, body.searching .pager { display: none; }
    .day-head h2 { margin: 0; font-size: 26px; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .day-head h2 small { margin-left: 10px; color: var(--muted); font-size: 15px; font-weight: 400; }
    .stats, .warn, .empty { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
    .warn { color: var(--warn); }
    .list { margin: 18px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; }
    .item {
      display: flex; gap: 14px; padding: 16px 18px; border: 1px solid var(--line); border-radius: 14px;
      background: var(--card); transition: border-color .15s, box-shadow .15s;
    }
    .item:hover { border-color: var(--accent); box-shadow: 0 4px 16px rgba(0, 0, 0, .05); }
    .item[hidden] { display: none; }
    .rank {
      flex: none; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center;
      background: var(--accent-soft); color: var(--accent); font-weight: 700; font-size: 14px;
    }
    .rank.top { background: var(--hot); color: #fff; }
    .body { min-width: 0; flex: 1; }
    .title { color: var(--text); font-weight: 650; font-size: 17px; line-height: 1.45; text-decoration: none; overflow-wrap: anywhere; }
    .title:hover { color: var(--accent); }
    .summary { margin: 6px 0 0; font-size: 15px; line-height: 1.7; color: var(--text); opacity: .88; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin-top: 8px; font-size: 13px; color: var(--muted); }
    .src { color: var(--accent); font-weight: 600; }
    .heat { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
    .heat .bar { width: 64px; height: 5px; border-radius: 3px; background: var(--line); overflow: hidden; }
    .heat .bar i { display: block; height: 100%; border-radius: 3px; background: currentColor; }
    .heat b { font-weight: 600; font-variant-numeric: tabular-nums; }
    .heat.hot { color: var(--hot); } .heat.warm { color: var(--warm); } .heat.mild { color: var(--mild); }
    .pager { display: flex; justify-content: space-between; margin-top: 18px; font-size: 14px; }
    .pager a { color: var(--accent); text-decoration: none; padding: 6px 12px; border-radius: 8px; background: var(--accent-soft); }

    /* 窄屏：目录移到顶部，可折叠 / Narrow screens: sidebar moves to the top and collapses */
    @media (max-width: 860px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); padding: 20px 16px 12px; }
      .brand { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      #toggle {
        display: block; flex: none; padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px;
        background: var(--card); color: var(--text); font: inherit; font-size: 13px; cursor: pointer;
      }
      body.js .sidebar:not(.open) .tree, body.js .sidebar:not(.open) footer { display: none; }
      main { padding: 20px 16px 48px; }
      .item { padding: 14px; gap: 10px; }
      .heat { margin-left: 0; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <div>
          <h1>AI 新闻日报</h1>
          <p>共 ${history.days.length} 天 · ${total} 篇 · 更新于 ${formatDateTime(now)}</p>
        </div>
        <button id="toggle" type="button">📅 按日期浏览</button>
      </div>
      <div class="search"><input id="q" type="search" placeholder="搜索标题、摘要、来源…" autocomplete="off"></div>
      <p id="hint"></p>
      <nav class="tree" aria-label="按日期浏览">
        ${renderTree(history.days)}
      </nav>
      <footer>由 ai-news-digest 自动生成<br>来源：${sources.join(' / ')}<br>时区：${DISPLAY_TIMEZONE}</footer>
    </aside>
    <main>
    ${days || '<p class="empty">暂无日报。</p>'}
    </main>
  </div>
  <script>${SCRIPT}</script>
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
