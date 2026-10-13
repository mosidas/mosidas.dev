import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { projects } from '../src/data/projects.ts';
import { beaconToken } from '../src/analytics.ts';
import news from '../src/data/news.json' with { type: 'json' };

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');

test('制作物の名前が決めた 6 件と順序まで一致する', () => {
  assert.deepEqual(
    projects.map((p) => p.name),
    ['launchpad-lite', 'dev-skills', 'recognizer', 'lazy-finder', 'nullops', 'rename'],
  );
});

test('すべての url が mosidas の GitHub リポジトリを指す', () => {
  for (const { url } of projects) {
    assert.match(url, /^https:\/\/github\.com\/mosidas\/[A-Za-z0-9._-]+$/);
  }
});

test('dist/index.html が各制作物の名前とリンクを含む', () => {
  for (const { name, url } of projects) {
    assert.ok(html.includes(name), `名前がない: ${name}`);
    assert.ok(html.includes(`href="${url}"`), `リンクがない: ${url}`);
  }
});

test('各制作物が 1 つ以上の使用技術を持ち、dist/index.html に表示される', () => {
  for (const { name, stack } of projects) {
    assert.ok(stack.length > 0, `使用技術がない: ${name}`);
    for (const tech of stack) {
      const escaped = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(html, new RegExp(`<li[^>]*>${escaped}</li>`), `使用技術がない: ${name} の ${tech}`);
    }
  }
});

test('dist/index.html がお知らせの見出しと各お知らせの題名・日付を含む', () => {
  assert.match(html, /<h2[^>]*id="news-heading"[^>]*>お知らせ<\/h2>/);
  if (news.length === 0) {
    assert.ok(html.includes('お知らせはまだない。'));
  }
  for (const { title, publishedAt } of news) {
    // Astro は html-escaper と同じ 5 文字を置換して描画する
    const escaped = title
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
    assert.ok(html.includes(`>${escaped}</h3>`), `題名がない: ${title}`);
    assert.ok(html.includes(`datetime="${publishedAt}"`), `日付がない: ${publishedAt}`);
  }
});

test('dist/index.html が script とインラインの style を含まない', () => {
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<style'));
});

const readDist = (path) => readFile(new URL(`../dist/${path}`, import.meta.url), 'utf8');
const contact = await readDist('contact/index.html');
const RESULTS = ['sent', 'invalid', 'rejected', 'limited', 'failed'];

test('dist/index.html が問い合わせのページへのリンクを含む', () => {
  assert.ok(html.includes('href="/contact/"'));
});

test('問い合わせのページが送信先と 3 項目と Turnstile を持つ', () => {
  assert.match(contact, /<form[^>]*method="post"/);
  assert.match(contact, /<form[^>]*action="\/api\/contact"/);
  for (const name of ['name', 'email', 'message']) {
    assert.match(contact, new RegExp(`<(input|textarea)[^>]*name="${name}"[^>]*required`), `項目がない: ${name}`);
    assert.match(contact, new RegExp(`<label[^>]*for="${name}"`), `ラベルがない: ${name}`);
  }
  assert.match(contact, /data-sitekey="[^"]+"/);
});

test('問い合わせのページの script は Turnstile の 1 本だけで、インラインの style を含まない', () => {
  const scripts = contact.match(/<script[^>]*>/g) ?? [];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js"/);
  assert.ok(!contact.includes('<style'));
});

test('結果ページが 5 つあり、noindex が付き、Worker が置き換える印を含む', async () => {
  const pages = Object.fromEntries(await Promise.all(RESULTS.map(async (r) => [r, await readDist(`contact/${r}/index.html`)])));
  for (const [name, page] of Object.entries(pages)) {
    assert.ok(page.includes('<meta name="robots" content="noindex">'), `noindex がない: ${name}`);
    assert.ok(page.includes('href="/contact/"'), `戻るリンクがない: ${name}`);
  }
  assert.ok(pages.invalid.includes('%MISSING%'));
  assert.ok(pages.failed.includes('%REQUEST_ID%'));
});

test('Worker が参照する結果ページがすべてビルド成果物にある', async () => {
  const worker = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8');
  // 成功時は '/contact/sent/' の直書き、失敗時は RESULT_PAGES の値を '/contact/' + name + '/' で組み立てる
  const literal = [...worker.matchAll(/\/contact\/([a-z]+)\//g)].map((m) => m[1]);
  const table = worker.match(/const RESULT_PAGES = \{([^}]*)\}/)?.[1] ?? '';
  const mapped = [...table.matchAll(/:\s*'([a-z]+)'/g)].map((m) => m[1]);
  const names = new Set([...literal, ...mapped]);
  assert.deepEqual([...names].sort(), [...RESULTS].sort());
  for (const name of names) await access(new URL(`../dist/contact/${name}/index.html`, import.meta.url));
});

test('CSP が Turnstile と Web Analytics の読み込みと送信先だけを許す', async () => {
  const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  const csp = headers.match(/Content-Security-Policy: (.*)/)?.[1] ?? '';
  for (const directive of [
    "default-src 'none'",
    'script-src https://challenges.cloudflare.com https://static.cloudflareinsights.com;',
    'connect-src https://cloudflareinsights.com;',
    'frame-src https://challenges.cloudflare.com;',
    "form-action 'self'",
  ]) {
    assert.ok(csp.includes(directive), `CSP にない: ${directive}`);
  }
  assert.ok(!csp.includes("'unsafe-inline'"));
});

const privacy = await readDist('privacy/index.html');

test('プライバシーポリシーのページが Turnstile と Web Analytics の利用を説明する', () => {
  assert.match(privacy, /<h1[^>]*>プライバシーポリシー<\/h1>/);
  for (const word of ['Turnstile', 'Web Analytics', 'Cookie']) {
    assert.ok(privacy.includes(word), `記述がない: ${word}`);
  }
});

test('トップと問い合わせのページがフッターからプライバシーポリシーへリンクする', () => {
  assert.ok(html.includes('href="/privacy/"'));
  assert.ok(contact.includes('href="/privacy/"'));
});

test('プライバシーポリシーのページが script とインラインの style を含まない', () => {
  assert.ok(!privacy.includes('<script'));
  assert.ok(!privacy.includes('<style'));
});

test('beaconToken が正しい形式の token を返す', () => {
  assert.equal(beaconToken('0123456789abcdef0123456789abcdef', true), '0123456789abcdef0123456789abcdef');
});

test('beaconToken が CI の外で token が未設定なら undefined を返す', () => {
  assert.equal(beaconToken(undefined, false), undefined);
});

test('beaconToken が CI で token が未設定なら失敗する', () => {
  assert.throws(() => beaconToken(undefined, true), /PUBLIC_WEB_ANALYTICS_TOKEN が未設定/);
});

test('beaconToken が形式外の token を CI の内外で拒む', () => {
  for (const ci of [true, false]) {
    assert.throws(() => beaconToken('abc"}<script>', ci), (e) => e.message === 'PUBLIC_WEB_ANALYTICS_TOKEN の形式が不正');
  }
});
