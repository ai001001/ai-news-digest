import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAlgoliaHits } from './fetcher.js';

const feed = { name: 'Hacker News', url: 'https://hnrss.org/newest?q=AI', topByPoints: 3 };

test('parseAlgoliaHits 映射字段并为 Ask HN 生成讨论页链接 / maps fields and links Ask HN to the discussion page', () => {
  const json = JSON.stringify({
    hits: [
      { objectID: '1', title: 'Story', url: 'https://example.com/a', created_at: '2026-11-14T10:00:00Z', points: 42, num_comments: 7 },
      { objectID: '2', title: 'Ask HN: AI?', url: null, story_text: '<p>Hello &amp; bye</p>', created_at: '2026-11-14T11:00:00Z', points: null, num_comments: null },
      { objectID: '3', title: null, created_at: '2026-11-14T11:00:00Z' },
    ],
  });
  const articles = parseAlgoliaHits(json, feed);
  assert.equal(articles.length, 2);
  assert.equal(articles[0].link, 'https://example.com/a');
  assert.equal(articles[0].points, 42);
  assert.equal(articles[0].comments, 7);
  assert.equal(articles[1].link, 'https://news.ycombinator.com/item?id=2');
  assert.equal(articles[1].description, 'Hello & bye');
  assert.equal(articles[1].points, 0);
});

test('parseAlgoliaHits 在缺少 hits 时抛错 / throws when hits is missing', () => {
  assert.throws(() => parseAlgoliaHits('{}', feed));
});
