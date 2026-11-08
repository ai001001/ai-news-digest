import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropSeen, keepTop, mergeDay } from './history.js';
import type { Article, DigestHistory } from './types.js';

/**
 * 构造测试文章。
 * Build a test article.
 * @param link - 链接 / Link
 * @param iso - 发布时间 / Publish time
 * @returns 文章 / Article
 */
function makeArticle(link: string, iso: string): Article {
  return { title: link, link, pubDate: new Date(iso), source: 'TechCrunch', categories: [], description: '', summary: '' };
}

test('dropSeen 去掉往日已收录的文章 / dropSeen drops articles seen on earlier days', () => {
  const history: DigestHistory = { days: [] };
  mergeDay(history, [makeArticle('https://a.com/1', '2026-10-31T01:00:00Z')], [], 24, new Date('2026-10-31T04:00:00Z'));
  const fresh = dropSeen(
    [makeArticle('https://www.a.com/1/', '2026-10-31T01:00:00Z'), makeArticle('https://a.com/2', '2026-11-01T01:00:00Z')],
    history,
  );
  assert.deepEqual(fresh.map((a) => a.link), ['https://a.com/2']);
});

test('mergeDay 按天追加，不覆盖已有日期 / mergeDay appends per day without overwriting existing days', () => {
  const history: DigestHistory = { days: [] };
  // 2026-10-31 04:00 UTC = 上海 12:00，2026-11-01 04:00 UTC = 上海次日 12:00
  // 04:00 UTC is 12:00 in Shanghai on the same calendar day
  mergeDay(history, [makeArticle('https://a.com/1', '2026-10-31T01:00:00Z')], [], 24, new Date('2026-10-31T04:00:00Z'));
  mergeDay(history, [makeArticle('https://a.com/2', '2026-11-01T01:00:00Z')], [], 24, new Date('2026-11-01T04:00:00Z'));
  // 同一天再次运行：追加到当天 / Second run on the same day appends to it
  mergeDay(
    history,
    [makeArticle('https://a.com/3', '2026-11-01T03:00:00Z')],
    [{ source: 'The Verge', articles: [], error: 'HTTP 503' }],
    24,
    new Date('2026-11-01T05:00:00Z'),
  );

  assert.deepEqual(history.days.map((d) => d.date), ['2026-11-01', '2026-10-31']);
  assert.deepEqual(history.days[0].articles.map((a) => a.link), ['https://a.com/3', 'https://a.com/2']);
  assert.deepEqual(history.days[0].failed, [{ source: 'The Verge', error: 'HTTP 503' }]);
  assert.deepEqual(history.days[1].articles.map((a) => a.link), ['https://a.com/1']);
});

test('keepTop 每天只保留热度前 N 篇，被移除的文章不再收录 / keepTop keeps the top N per day and never re-collects dropped ones', () => {
  const history: DigestHistory = { days: [] };
  const articles = [10, 90, 50].map((heat, i) => ({ ...makeArticle(`https://a.com/${i}`, '2026-11-01T01:00:00Z'), heat }));
  mergeDay(history, articles, [], 24, new Date('2026-11-01T04:00:00Z'));
  keepTop(history, 2);

  assert.deepEqual(history.days[0].articles.map((a) => a.link), ['https://a.com/1', 'https://a.com/2']);
  assert.deepEqual(history.dropped, ['a.com/0']);
  assert.deepEqual(dropSeen([makeArticle('https://a.com/0', '2026-11-02T01:00:00Z')], history), []);
});
