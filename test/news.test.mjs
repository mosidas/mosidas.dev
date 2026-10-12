import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fetchNews } from '../scripts/fetch-news.mjs';

const realFetch = globalThis.fetch;
/** @type {{ url: string, init: RequestInit | undefined }[]} */
let calls;
/** @type {(url: string) => Response} */
let respond;

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(String(url));
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const item = (id, publishedAt, body = '') => ({ id, title: `タイトル ${id}`, body, publishedAt });
const api = (contents, images = {}) => (url) =>
  url.includes('.microcms.io/api/')
    ? Response.json({ contents })
    : new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': images[url] ?? 'image/png' } });

test('一覧を publishedAt の新しい順に返す', async () => {
  respond = api([item('a', '2026-01-01T00:00:00.000Z'), item('b', '2026-03-01T00:00:00.000Z'), item('c', '2026-02-01T00:00:00.000Z')]);
  const { news } = await fetchNews('example', 'key');
  assert.deepEqual(news.map((n) => n.id), ['b', 'c', 'a']);
});

test('API キーをヘッダーで送り、URL に含めない', async () => {
  respond = api([]);
  await fetchNews('example', 'secret-key');
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].url.includes('secret-key'));
  assert.equal(new Headers(calls[0].init?.headers).get('x-microcms-api-key'), 'secret-key');
  assert.equal(calls[0].init?.redirect, 'error');
});

test('本文から script・onerror・style・javascript: の href・iframe を除く', async () => {
  const body =
    '<p style="color:red" onerror="alert(1)">本文</p><script>alert(2)</script>' +
    '<a href="javascript:alert(3)">x</a><iframe src="https://evil.example/"></iframe><h2>見出し</h2>';
  respond = api([item('a', '2026-01-01T00:00:00.000Z', body)]);
  const { news } = await fetchNews('example', 'key');
  const html = news[0].body;
  for (const bad of ['script', 'onerror', 'style', 'javascript:', 'iframe', 'alert']) {
    assert.ok(!html.includes(bad), `${bad} が残る: ${html}`);
  }
  assert.ok(html.includes('<h4>見出し</h4>'));
});

test('images.microcms-assets.io の画像を取得し、src をサイト内のパスへ書き換える', async () => {
  const src = 'https://images.microcms-assets.io/assets/x/y.png';
  respond = api([item('a', '2026-01-01T00:00:00.000Z', `<img src="${src}" alt="図" onerror="x">`)]);
  const { news, images } = await fetchNews('example', 'key');
  const name = news[0].body.match(/src="\/news\/images\/([0-9a-f]{16}\.png)"/)?.[1];
  assert.ok(name, news[0].body);
  assert.deepEqual(images.get(name), new Uint8Array([1, 2, 3]));
  assert.equal(calls.find((c) => c.url === src)?.init?.redirect, 'error');
});

test('他ホスト・http・svg の画像は取得せず除く', async () => {
  const srcs = [
    'https://169.254.169.254/x.png',
    'http://images.microcms-assets.io/x.png',
    'https://images.microcms-assets.io/x.svg',
  ];
  respond = api([item('a', '2026-01-01T00:00:00.000Z', srcs.map((s) => `<img src="${s}">`).join(''))]);
  const { news, images } = await fetchNews('example', 'key');
  assert.ok(!news[0].body.includes('<img'), news[0].body);
  assert.equal(images.size, 0);
  assert.equal(calls.length, 1);
});

test('画像の Content-Type が text/html なら失敗する', async () => {
  const src = 'https://images.microcms-assets.io/x.png';
  respond = api([item('a', '2026-01-01T00:00:00.000Z', `<img src="${src}">`)], { [src]: 'text/html' });
  await assert.rejects(fetchNews('example', 'key'), { type: 'image_rejected', target: 'image', url: src });
});

test('画像が 10 MB を超えたら失敗する', async () => {
  const src = 'https://images.microcms-assets.io/x.png';
  respond = (url) =>
    url.includes('.microcms.io/api/')
      ? Response.json({ contents: [item('a', '2026-01-01T00:00:00.000Z', `<img src="${src}">`)] })
      : new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } });
  await assert.rejects(fetchNews('example', 'key'), { type: 'image_rejected', target: 'image', url: src });
});

test('画像が 404 なら失敗し、失敗箇所に画像と URL を載せる', async () => {
  const src = 'https://images.microcms-assets.io/x.png';
  respond = (url) =>
    url.includes('.microcms.io/api/')
      ? Response.json({ contents: [item('a', '2026-01-01T00:00:00.000Z', `<img src="${src}">`)] })
      : new Response('', { status: 404 });
  await assert.rejects(fetchNews('example', 'key'), { type: 'http_status_404', target: 'image', url: src });
});

test('画像の取得がタイムアウトしたら、例外の種類を保ったまま失敗箇所と URL を載せる', async () => {
  const src = 'https://images.microcms-assets.io/x.png';
  respond = (url) => {
    if (url.includes('.microcms.io/api/')) {
      return Response.json({ contents: [item('a', '2026-01-01T00:00:00.000Z', `<img src="${src}">`)] });
    }
    throw new DOMException('timeout', 'TimeoutError');
  };
  await assert.rejects(fetchNews('example', 'key'), { name: 'TimeoutError', target: 'image', url: src });
});

test('応答の形が不正なら失敗する', async () => {
  respond = () => Response.json({});
  await assert.rejects(fetchNews('example', 'key'), { type: 'invalid_response' });
  respond = api([item('a', 'not-a-date')]);
  await assert.rejects(fetchNews('example', 'key'), { type: 'invalid_response' });
});

test('API が 503 なら失敗する', async () => {
  respond = () => new Response('', { status: 503 });
  await assert.rejects(fetchNews('example', 'key'), { type: 'http_status_503', transient: true, target: 'api', url: undefined });
});

const run = (extra) => {
  const env = { ...process.env, ...extra };
  for (const k of ['MICROCMS_SERVICE_DOMAIN', 'MICROCMS_API_KEY', 'WORKERS_CI']) if (!(k in extra)) delete env[k];
  const r = spawnSync(process.execPath, ['scripts/fetch-news.mjs'], {
    cwd: new URL('..', import.meta.url),
    env,
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout + r.stderr };
};
const snapshot = () => readFile(new URL('../src/data/news.json', import.meta.url), 'utf8');

test('認証情報が無ければ warn を出して取得を省く', async () => {
  const before = await snapshot();
  const { status, out } = run({});
  assert.equal(status, 0);
  assert.equal(JSON.parse(out.trim()).level, 'warn');
  assert.equal(await snapshot(), before);
});

test('Workers Builds で認証情報が無ければ失敗する', () => {
  const { status, out } = run({ WORKERS_CI: '1' });
  assert.equal(status, 1);
  assert.equal(JSON.parse(out.trim())['error.type'], 'missing_credentials');
});

test('サービスドメインが不正なら失敗し、API キーを出力しない', () => {
  const { status, out } = run({ MICROCMS_SERVICE_DOMAIN: 'evil.example/x?', MICROCMS_API_KEY: 'test-secret-key' });
  assert.equal(status, 1);
  assert.equal(JSON.parse(out.trim())['error.type'], 'invalid_service_domain');
  assert.ok(!out.includes('test-secret-key'));
});
