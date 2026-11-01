import { parseArgs } from 'node:util';
import cron from 'node-cron';
import { CRON_SCHEDULE, CRON_TIMEZONE, DEFAULT_HOURS, DEFAULT_OUT_DIR, FEEDS } from './config.js';
import { fetchAll } from './fetcher.js';
import { dropSeen, loadHistory, mergeDay, saveHistory } from './history.js';
import { processArticles } from './processor.js';
import { renderHtml, writePage } from './renderer.js';
import { summarizeAll } from './summarizer.js';

const HELP = `用法 / Usage: npm start -- [options]

  --hours <n>   时间窗口（小时），默认 ${DEFAULT_HOURS} / Time window in hours
  --out <dir>   输出目录，默认 ${DEFAULT_OUT_DIR} / Output directory
  --cron        定时模式：每周日 12:00（${CRON_TIMEZONE}）自动运行，不立即执行
                Scheduled mode: run every Sunday at 12:00 (${CRON_TIMEZONE}); does not run immediately
  -h, --help    显示帮助 / Show help

环境变量 / Environment:
  DEEPSEEK_API_KEY   设置后用 DeepSeek 生成一句话摘要，否则截取 description
                     If set, DeepSeek writes one-line summaries; otherwise the description is truncated
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

  const day = mergeDay(history, articles, results, hours, now);
  await saveHistory(history, outDir);
  const file = await writePage(renderHtml(history, now), outDir);

  console.log(`✅ 已更新日报：${file}（${day.date} 新增 ${articles.length} 篇，当天共 ${day.articles.length} 篇）`);
}

/**
 * 启动定时模式：按 CRON_SCHEDULE 在 CRON_TIMEZONE 时区运行；单次失败只记录日志，不退出进程。
 * Start scheduled mode: run on CRON_SCHEDULE in CRON_TIMEZONE; a failed run is logged without exiting.
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
      } catch (err) {
        console.error('❌ 本次运行失败 / Run failed:', err instanceof Error ? err.message : err);
      }
    },
    { timezone: CRON_TIMEZONE, noOverlap: true },
  );

  const next = task.getNextRun();
  const nextText = next ? next.toLocaleString('zh-CN', { timeZone: CRON_TIMEZONE }) : '未知';
  console.log(`⏰ 定时模式已开启：每周日 12:00（${CRON_TIMEZONE}），下次运行 ${nextText}。按 Ctrl+C 退出。`);
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

  if (values.cron) {
    startCron(hours, values.out);
  } else {
    await runOnce(hours, values.out);
  }
}

main().catch((err: unknown) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
