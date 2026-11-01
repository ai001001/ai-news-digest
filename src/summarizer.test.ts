import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractArticleText } from './fetcher.js';
import { fitSummary, parseSummaryResult } from './summarizer.js';

test('parseSummaryResult 解析 JSON 并限制热度范围 / parseSummaryResult parses JSON and clamps heat', () => {
  assert.deepEqual(parseSummaryResult('{"summary": " 摘要 ", "heat": 120}'), { summary: '摘要', heat: 100 });
  assert.deepEqual(parseSummaryResult('```json\n{"summary": "摘要", "heat": "72.4"}\n```'), { summary: '摘要', heat: 72 });
  assert.deepEqual(parseSummaryResult('{"summary": "摘要"}'), { summary: '摘要', heat: undefined });
});

test('parseSummaryResult 非 JSON 时整段作为摘要 / parseSummaryResult treats non-JSON output as the summary', () => {
  assert.deepEqual(parseSummaryResult(' 纯文本摘要 '), { summary: '纯文本摘要' });
});

test('extractArticleText 提取 meta 描述和正文段落 / extractArticleText pulls the meta description and paragraphs', () => {
  const html = `<html><head><meta property="og:description" content="Lead text"><script>var x = "<p>no</p>";</script></head>
    <body><p>Menu</p><p>This is a long enough paragraph about a new AI model release.</p></body></html>`;
  assert.equal(extractArticleText(html), 'Lead text This is a long enough paragraph about a new AI model release.');
});

test('fitSummary 超长时在句末截断 / fitSummary cuts overlong summaries at a sentence end', () => {
  const ok = '短'.repeat(80);
  assert.equal(fitSummary(ok), ok);
  const long = `${'甲'.repeat(60)}。${'乙'.repeat(30)}，${'丙'.repeat(30)}。`;
  assert.equal(fitSummary(long), `${'甲'.repeat(60)}。`);
  const commas = `${'甲'.repeat(60)}，${'乙'.repeat(60)}`;
  assert.equal(fitSummary(commas), `${'甲'.repeat(60)}。`);
  assert.equal(fitSummary('无'.repeat(120)), `${'无'.repeat(100)}…`);
});
