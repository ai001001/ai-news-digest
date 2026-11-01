import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPromotional, normalizeUrl, processArticles } from './processor.js';
import type { Article } from './types.js';

const NOW = new Date('2026-11-01T00:00:00Z');

/**
 * 构造测试文章。
 * Build a test article.
 * @param overrides - 覆盖字段 / Fields to override
 * @returns 文章 / Article
 */
function makeArticle(overrides: Partial<Article>): Article {
  return {
    title: 'OpenAI reportedly lowers funding target for new round',
    link: 'https://techcrunch.com/2026/10/31/openai-funding/',
    pubDate: new Date('2026-10-31T12:00:00Z'),
    source: 'TechCrunch',
    categories: ['AI', 'Fundraising'],
    description: '',
    summary: '',
    ...overrides,
  };
}

test('普通新闻不被视为推广稿 / regular news is not promotional', () => {
  assert.equal(isPromotional(makeArticle({})), false);
  assert.equal(isPromotional(makeArticle({ title: 'Ollie, a privacy-focused AI assistant, is shutting down' })), false);
  assert.equal(isPromotional(makeArticle({ title: 'The biggest names in AI are backing a new way to opt out of scraping', categories: [] })), false);
});

test('按分类识别活动推广稿 / detects event promos by category', () => {
  const promo = makeArticle({
    title: 'Skip the small talk: Make game-changing connections at TechCrunch Founder Summit with Braindate',
    categories: ['TC', 'Startups', 'TechCrunch Founder Summit 2026'],
  });
  assert.equal(isPromotional(promo), true);
  assert.equal(isPromotional(makeArticle({ categories: ['TechCrunch Disrupt 2026'] })), true);
  assert.equal(isPromotional(makeArticle({ categories: ['StrictlyVC'] })), true);
});

test('按标题识别推广稿（无分类的源）/ detects promos by title for feeds without categories', () => {
  for (const title of [
    '4 days left: How TechCrunch Founder Summit helps you make more useful connections to scale',
    '1 day left to grab your pass',
    'Your last chance to save on passes',
    'Early-bird pricing ends tonight',
    'Save up to $400 before Friday',
    'Sponsored: The future of AI infrastructure',
  ]) {
    assert.equal(isPromotional(makeArticle({ title, categories: [] })), true, title);
  }
});

test('processArticles 排除推广稿 / processArticles drops promotional posts', () => {
  const news = makeArticle({});
  const promo = makeArticle({
    title: '4 days left: How TechCrunch Founder Summit helps you make more useful connections to scale',
    link: 'https://techcrunch.com/2026/10/31/4-days-left/',
    categories: ['TechCrunch Founder Summit 2026'],
  });
  const result = processArticles([{ source: 'TechCrunch', articles: [news, promo] }], [], 24, NOW);
  assert.deepEqual(result.map((a) => a.title), [news.title]);
});

test('normalizeUrl 忽略协议、www、锚点、末尾斜杠和追踪参数 / normalizeUrl ignores protocol, www, hash, trailing slash and tracking params', () => {
  const base = normalizeUrl('https://techcrunch.com/2026/10/31/openai-funding/');
  for (const url of [
    'http://www.techcrunch.com/2026/10/31/openai-funding',
    'https://TechCrunch.com/2026/10/31/openai-funding/#comments',
    'https://techcrunch.com/2026/10/31/openai-funding/?utm_source=hn&utm_medium=rss',
  ]) {
    assert.equal(normalizeUrl(url), base, url);
  }
});

test('normalizeUrl 保留有意义的查询参数 / normalizeUrl keeps meaningful query params', () => {
  assert.notEqual(
    normalizeUrl('https://news.ycombinator.com/item?id=1'),
    normalizeUrl('https://news.ycombinator.com/item?id=2'),
  );
  assert.equal(normalizeUrl('https://a.com/x?b=2&a=1'), normalizeUrl('https://a.com/x?a=1&b=2'));
});

test('processArticles 跨源按 URL 去重，保留先出现的 / processArticles dedupes across sources by URL, keeping the first', () => {
  const tc = makeArticle({});
  const hn = makeArticle({ source: 'Hacker News', link: 'https://techcrunch.com/2026/10/31/openai-funding?utm_source=hn', points: 50 });
  const result = processArticles(
    [
      { source: 'TechCrunch', articles: [tc] },
      { source: 'Hacker News', articles: [hn] },
    ],
    [],
    24,
    NOW,
  );
  assert.deepEqual(result.map((a) => a.source), ['TechCrunch']);
});
