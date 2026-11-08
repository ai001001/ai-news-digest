import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import cron from 'node-cron';
import { CRON_SCHEDULE, CRON_TIMEZONE, DAILY_TOP_N, DEFAULT_HOURS, DEFAULT_OUT_DIR, FEEDS, SUMMARY_MIN_LENGTH } from './config.js';
import { fetchAll } from './fetcher.js';
import { dropSeen, findStale, keepTop, loadHistory, mergeDay, saveHistory } from './history.js';
import { computeHeat, processArticles } from './processor.js';
import { renderHtml, writePage } from './renderer.js';
import { summarizeAll } from './summarizer.js';
import type { Article } from './types.js';

const HELP = `用法 / Usage: npm start -- [options]

  --hours <n>   时间窗口（小时），默认 ${DEFAULT_HOURS} / Time window in hours
  --out <dir>   输出目录，默认 ${DEFAULT_OUT_DIR} / Output directory
  --cron        定时模式：每天 22:00（${CRON_TIMEZONE}）自动运行，成功后自动推送到 GitHub Pages，不立即执行
                Scheduled mode: run daily at 22:00 (${CRON_TIMEZONE}) and push to GitHub Pages on success; does not run immediately
  --deploy      运行成功后提交 ${DEFAULT_OUT_DIR}/ 并推送到 GitHub，触发 Pages 发布
                After a successful run, commit ${DEFAULT_OUT_DIR}/ and push to GitHub to publish via Pages
  --backfill    为历史中缺少热度或摘要过短的文章重新生成摘要与热度，然后重新渲染页面
                Regenerate summaries and heat for stored articles missing heat or with short summaries, then re-render
  -h, --help    显示帮助 / Show help

环境变量 / Environment:
  DEEPSEEK_API_KEY   设置后用 DeepSeek 生成 50-100 字摘要和热度评分，否则截取 description
                     If set, DeepSeek writes 50-100 character summaries and heat ratings; otherwise the description is truncated
                     可写在项目根目录的 .env 文件中 / Can be put in a .env file in the project root`;

/**
 * 从项目根目录的 .env 加载环境变量；文件不存在时忽略，已存在的环境变量优先。
 * Load environment variables from .env in the project root; ignored if missing, existing variables take precedence.
 */
function loadEnv(): void {
  try {
    process.loadEnvFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/**
 * 执行一次完整流程：抓取 → 处理 → 跨天去重 → 摘要 → 合并到历史 → 渲染 HTML。
 * Run the full pipeline once: fetch → process → cross-day dedupe → summarize → merge into history → render HTML.
 *
 * @param hours - 时间窗口（小时）/ Time window in hours
 * @param outDir - 输出目录 / Output directory
 */
async function runOnce(hours: number, outDir: string): Promise<void> {
  const now = new Date();
  console.log(`⏳ 正在抓取 ${FEEDS.length} 个 RSS 源…`);

  const results = await fetchAll(FEEDS);
  for (const r of results) {
    console.log(r.error ? `  ✗ ${r.source}: ${r.error}` : `  ✓ ${r.source}: ${r.articles.length} 条`);
  }

  const history = await loadHistory(outDir);
  const processed = processArticles(results, FEEDS, hours, now);
  // 先去掉往日已收录的文章，再做 AI 摘要，避免重复和浪费 token
  // Drop articles from earlier days before summarizing, avoiding repeats and wasted tokens
  const articles = dropSeen(processed, history);
  const skipped = processed.length - articles.length;
  if (skipped > 0) console.log(`🔁 跳过 ${skipped} 篇已收录过的文章`);

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (articles.length === 0) {
    console.log('ℹ️  没有新文章，跳过 AI 摘要');
  } else if (apiKey) {
    console.log(`🤖 正在用 DeepSeek 生成 ${articles.length} 篇摘要…`);
    const { ok, errors } = await summarizeAll(articles, apiKey);
    console.log(`  ✓ AI 摘要 ${ok}/${articles.length} 篇`);
    for (const e of errors) console.log(`  ✗ ${e}（保留截取摘要）`);
  } else {
    console.log('ℹ️  未设置 DEEPSEEK_API_KEY，跳过 AI 摘要，使用截取的 description');
  }
  // 没有 AI 评分的文章（未启用或失败）退回 HN 热度
  // Articles without an AI rating (disabled or failed) fall back to HN heat
  for (const a of articles) a.heat ??= computeHeat(undefined, a.points);

  const day = mergeDay(history, articles, results, hours, now);
  keepTop(history, DAILY_TOP_N);
  await saveHistory(history, outDir);
  const file = await writePage(renderHtml(history, now), outDir);

  console.log(`✅ 已更新日报：${file}（${day.date} 新增 ${articles.length} 篇，当天保留前 ${day.articles.length} 篇）`);
}

/**
 * 补全历史文章：重新抓取原文，生成 50-100 字摘要与热度，按热度重排并只保留每天前 N 篇后重新渲染页面。
 * Backfill stored articles: re-fetch the originals, generate 50-100 character summaries and heat, re-sort, keep the daily top N and re-render.
 *
 * @param outDir - 输出目录 / Output directory
 */
async function runBackfill(outDir: string): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('--backfill 需要 DEEPSEEK_API_KEY / --backfill requires DEEPSEEK_API_KEY');

  const history = await loadHistory(outDir);
  const stale = findStale(history, SUMMARY_MIN_LENGTH);
  console.log(`🔧 需要补全 ${stale.length} 篇历史文章`);

  if (stale.length > 0) {
    // 历史中没有保存 RSS 简介，description 留空，让摘要器抓取原文网页
    // The history does not keep RSS descriptions; leave description empty so the summarizer fetches the page
    const articles: Article[] = stale.map((s) => ({
      title: s.title,
      link: s.link,
      pubDate: new Date(s.pubDate),
      source: s.source,
      categories: [],
      description: '',
      summary: s.summary,
      points: s.points,
      comments: s.comments,
    }));
    const { ok, errors } = await summarizeAll(articles, apiKey);
    console.log(`  ✓ AI 摘要 ${ok}/${articles.length} 篇`);
    for (const e of errors) console.log(`  ✗ ${e}（保留原摘要）`);

    stale.forEach((s, i) => {
      s.summary = articles[i].summary;
      const heat = articles[i].heat ?? computeHeat(undefined, s.points);
      if (heat !== undefined) s.heat = heat;
    });
  }

  keepTop(history, DAILY_TOP_N);
  await saveHistory(history, outDir);
  const file = await writePage(renderHtml(history, new Date()), outDir);
  console.log(`✅ 已重新渲染：${file}`);
}

const execFileAsync = promisify(execFile);

/**
 * 提交输出目录并推送到远程仓库，由 GitHub Pages 自动发布；没有变化时不提交。
 * Commit the output directory and push to the remote so GitHub Pages republishes it; skips the commit when nothing changed.
 *
 * @param outDir - 输出目录 / Output directory
 */
async function deploy(outDir: string): Promise<void> {
  const git = (...args: string[]) => execFileAsync('git', args);
  await git('add', '--', outDir);
  try {
    await git('diff', '--cached', '--quiet', '--', outDir);
    console.log('ℹ️  日报没有变化，跳过推送');
    return;
  } catch {
    // 有暂存的改动时 git diff --quiet 以非零退出 / git diff --quiet exits non-zero when changes are staged
  }
  await git('commit', '-m', 'chore: 更新日报 / update digest', '--', outDir);
  await git('push');
  console.log('🚀 已推送到 GitHub，Pages 将自动发布');
}

/**
 * 启动定时模式：按 CRON_SCHEDULE 在 CRON_TIMEZONE 时区运行，成功后自动推送；单次失败只记录日志，不退出进程。
 * Start scheduled mode: run on CRON_SCHEDULE in CRON_TIMEZONE and push on success; a failed run is logged without exiting.
 *
 * @param hours - 时间窗口（小时）/ Time window in hours
 * @param outDir - 输出目录 / Output directory
 */
function startCron(hours: number, outDir: string): void {
  const task = cron.schedule(
    CRON_SCHEDULE,
    async () => {
      console.log(`\n🕛 定时任务触发：${new Date().toLocaleString('zh-CN', { timeZone: CRON_TIMEZONE })}`);
      try {
        await runOnce(hours, outDir);
        await deploy(outDir);
      } catch (err) {
        console.error('❌ 本次运行失败 / Run failed:', err instanceof Error ? err.message : err);
      }
    },
    { timezone: CRON_TIMEZONE, noOverlap: true },
  );

  const next = task.getNextRun();
  const nextText = next ? next.toLocaleString('zh-CN', { timeZone: CRON_TIMEZONE }) : '未知';
  console.log(`⏰ 定时模式已开启：每天 22:00（${CRON_TIMEZONE}），下次运行 ${nextText}。按 Ctrl+C 退出。`);
}

/**
 * CLI 入口：解析参数后立即运行一次，或开启定时模式。
 * CLI entry: parse arguments, then run once immediately or start scheduled mode.
 */
async function main(): Promise<void> {
  loadEnv();

  const { values } = parseArgs({
    options: {
      hours: { type: 'string', default: String(DEFAULT_HOURS) },
      out: { type: 'string', default: DEFAULT_OUT_DIR },
      cron: { type: 'boolean', default: false },
      backfill: { type: 'boolean', default: false },
      deploy: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const hours = Number(values.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`--hours 必须是正数 / --hours must be a positive number: ${values.hours}`);
  }

  if (values.backfill) {
    await runBackfill(values.out);
    if (values.deploy) await deploy(values.out);
  } else if (values.cron) {
    startCron(hours, values.out);
  } else {
    await runOnce(hours, values.out);
    if (values.deploy) await deploy(values.out);
  }
}

main().catch((err: unknown) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
