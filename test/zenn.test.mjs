import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fetchZenn } from '../scripts/fetch-zenn.mjs';

const FEED = 'https://zenn.dev/mosida/feed';
const realFetch = globalThis.fetch;
/** @type {{ url: string, init: RequestInit | undefined }[]} */
let calls;
/** @type {() => Response} */
let respond;

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return respond();
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const item = (slug, pubDate, { title = `<![CDATA[記事 ${slug}]]>`, link = `https://zenn.dev/mosida/articles/${slug}` } = {}) =>
  `<item><title>${title}</title><description><![CDATA[本文]]></description><link>${link}</link>` +
  `<guid isPermaLink="true">${link}</guid><pubDate>${pubDate}</pubDate></item>`;
const rss = (...items) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title><![CDATA[フィード]]></title>` +
  `<link>https://zenn.dev/mosida</link>${items.join('')}</channel></rss>`;
const feed = (...items) => () => new Response(rss(...items), { headers: { 'content-type': 'application/xml' } });

test('記事を pubDate の新しい順に title・url・date で返す', async () => {
  respond = feed(
    item('a', 'Thu, 01 Jan 2026 00:00:00 GMT'),
    item('b', 'Sun, 01 Mar 2026 00:00:00 GMT'),
    item('c', 'Sun, 01 Feb 2026 00:00:00 GMT'),
  );
  assert.deepEqual(await fetchZenn(FEED), [
    { title: '記事 b', url: 'https://zenn.dev/mosida/articles/b', date: '2026-03-01T00:00:00.000Z' },
    { title: '記事 c', url: 'https://zenn.dev/mosida/articles/c', date: '2026-02-01T00:00:00.000Z' },
    { title: '記事 a', url: 'https://zenn.dev/mosida/articles/a', date: '2026-01-01T00:00:00.000Z' },
  ]);
});

test('最新 10 件に切り詰める', async () => {
  respond = feed(...Array.from({ length: 12 }, (_, i) => item(`a${i}`, new Date(Date.UTC(2026, 0, i + 1)).toUTCString())));
  const articles = await fetchZenn(FEED);
  assert.equal(articles.length, 10);
  assert.equal(articles[0].url, 'https://zenn.dev/mosida/articles/a11');
  assert.equal(articles[9].url, 'https://zenn.dev/mosida/articles/a2');
});

test('記事が 0 件なら空の一覧を返す', async () => {
  respond = feed();
  assert.deepEqual(await fetchZenn(FEED), []);
});

test('CDATA 内の </item> をタグとして読まない', async () => {
  respond = feed(item('a', 'Thu, 01 Jan 2026 00:00:00 GMT', { title: '<![CDATA[x</item><item>y]]>' }));
  const articles = await fetchZenn(FEED);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, 'x</item><item>y');
});

test('CDATA の外の実体参照を復元し、二重に復元しない', async () => {
  respond = feed(item('a', 'Thu, 01 Jan 2026 00:00:00 GMT', { title: 'A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39; &#x41; &amp;lt;' }));
  assert.equal((await fetchZenn(FEED))[0].title, `A & B <C> "D" 'E' A &lt;`);
});

for (const [name, link] of [
  ['http', 'http://zenn.dev/mosida/articles/a'],
  ['別ホスト', 'https://evil.example/mosida/articles/a'],
  ['別のパスの形', 'https://zenn.dev/mosida/books/a'],
  ['javascript:', 'javascript:alert(1)'],
]) {
  test(`link が ${name} なら一覧全体を失敗にする`, async () => {
    respond = feed(item('ok', 'Thu, 01 Jan 2026 00:00:00 GMT'), item('a', 'Thu, 01 Jan 2026 00:00:00 GMT', { link }));
    await assert.rejects(fetchZenn(FEED), { type: 'invalid_response', transient: false });
  });
}

test('title が空・pubDate が不正なら失敗する', async () => {
  respond = feed(item('a', 'Thu, 01 Jan 2026 00:00:00 GMT', { title: '' }));
  await assert.rejects(fetchZenn(FEED), { type: 'invalid_response' });
  respond = feed(item('a', 'not-a-date'));
  await assert.rejects(fetchZenn(FEED), { type: 'invalid_response' });
});

test('応答が RSS でない(HTML)なら失敗する', async () => {
  respond = () => new Response('<!doctype html><html><body>メンテナンス中</body></html>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(fetchZenn(FEED), { type: 'invalid_response' });
});

test('応答が 1 MB を超えたら失敗する', async () => {
  respond = () => new Response(rss() + ' '.repeat(1024 * 1024));
  await assert.rejects(fetchZenn(FEED), { type: 'response_too_large' });
});

test('503 は一時的、404 は恒久的な失敗に分類する', async () => {
  respond = () => new Response('', { status: 503 });
  await assert.rejects(fetchZenn(FEED), { type: 'http_status_503', transient: true });
  respond = () => new Response('', { status: 404 });
  await assert.rejects(fetchZenn(FEED), { type: 'http_status_404', transient: false });
});

test('リダイレクトを拒否し、タイムアウトの signal を渡す', async () => {
  respond = feed();
  await fetchZenn(FEED);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, FEED);
  assert.equal(calls[0].init?.redirect, 'error');
  assert.ok(calls[0].init?.signal instanceof AbortSignal);
});

for (const bad of ['http://zenn.dev/mosida/feed', 'zenn.dev/mosida/feed', 'javascript:alert(1)']) {
  test(`フィードの URL ${bad} を拒否し、取得しない`, async () => {
    respond = feed();
    await assert.rejects(fetchZenn(bad), { type: 'invalid_feed_url', transient: false });
    assert.equal(calls.length, 0);
  });
}

const snapshot = () => readFile(new URL('../src/data/zenn.json', import.meta.url), 'utf8');

test('取得に失敗しても zenn.json を書き換えず、error ログを 1 行出して終了コード 0 で終える', async () => {
  const before = await snapshot();
  const r = spawnSync(process.execPath, ['scripts/fetch-zenn.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, ZENN_FEED_URL: 'https://127.0.0.1:9/feed' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const lines = (r.stdout + r.stderr).trim().split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.level, 'error');
  assert.equal(entry.msg, 'Zenn の記事の取得に失敗した');
  assert.equal(entry['error.type'], 'TypeError');
  assert.equal(entry['app.error.transient'], true);
  assert.equal(await snapshot(), before);
});
