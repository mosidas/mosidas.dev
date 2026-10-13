import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { projects } from '../src/data/projects.ts';
import { beaconToken } from '../src/analytics.ts';
import news from '../src/data/news.json' with { type: 'json' };
import zenn from '../src/data/zenn.json' with { type: 'json' };

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
// token の有無でビルド結果が変わる beacon を除き、それ以外の script の有無を判定する
const BEACON = /<script defer src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js" data-cf-beacon="[^"]*"><\/script>/g;
const stripBeacon = (page) => page.replace(BEACON, '');

// Astro は html-escaper と同じ 5 文字を置換して描画する
const escapeHtml = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

test('制作物の名前が決めた 6 件と順序まで一致する', () => {
  assert.deepEqual(
    projects.map((p) => p.name),
    ['launchpad-lite', 'nullops', 'dev-skills', 'recognizer', 'lazy-finder', 'rename'],
  );
});

test('name が英小文字とハイフンだけで、date が実在する YYYY-MM-DD で、short が空でない', () => {
  for (const { name, date, short } of projects) {
    assert.match(name, /^[a-z]+(-[a-z]+)*$/);
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    // Date.parse は 2026-02-30 を繰り上げて受け付けるため、往復して一致を見る
    assert.equal(new Date(date).toISOString().slice(0, 10), date, `実在しない日付: ${name} の ${date}`);
    assert.ok(short.trim().length > 0, `short が空: ${name}`);
  }
});

test('制作物が date の新しい順に並ぶ', () => {
  for (let i = 1; i < projects.length; i++) {
    assert.ok(projects[i - 1].date >= projects[i].date, `順序が違う: ${projects[i].name}`);
  }
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
    assert.ok(html.includes(`>${escapeHtml(title)}</h3>`), `題名がない: ${title}`);
    assert.ok(html.includes(`datetime="${publishedAt}"`), `日付がない: ${publishedAt}`);
  }
});

test('zenn.json が 10 件以内で、日付の降順に並び、url がすべて Zenn を指す', () => {
  assert.ok(zenn.length <= 10);
  for (let i = 1; i < zenn.length; i++) {
    assert.ok(Date.parse(zenn[i - 1].date) >= Date.parse(zenn[i].date), `降順でない: ${zenn[i].url}`);
  }
  for (const { url } of zenn) assert.ok(url.startsWith('https://zenn.dev/'), `Zenn でない: ${url}`);
});

test('dist/index.html が記事の見出しと各記事のリンク・題名・日付を zenn.json の順で含む', () => {
  assert.match(html, /<h2[^>]*id="articles-heading"[^>]*>記事<\/h2>/);
  if (zenn.length === 0) {
    assert.ok(html.includes('記事はまだない。'));
  }
  let last = -1;
  for (const { title, url, date } of zenn) {
    const link = `href="${escapeHtml(url)}"`;
    assert.ok(html.includes(link), `リンクがない: ${url}`);
    assert.ok(html.includes(`>${escapeHtml(title)}</a></h3>`), `題名がない: ${title}`);
    assert.ok(html.includes(`datetime="${date}"`), `日付がない: ${date}`);
    const index = html.indexOf(link);
    assert.ok(index > last, `順序が違う: ${url}`);
    last = index;
  }
});

test('dist/index.html が script とインラインの style を含まない', () => {
  assert.ok(!stripBeacon(html).includes('<script'));
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
  const scripts = stripBeacon(contact).match(/<script[^>]*>/g) ?? [];
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
    "font-src 'self';",
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
  assert.ok(!stripBeacon(privacy).includes('<script'));
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

test('全ページが beacon を token の設定時に 1 本、未設定時に 0 本含む', async () => {
  const expected = process.env.PUBLIC_WEB_ANALYTICS_TOKEN ? 1 : 0;
  const pages = (await readdir(new URL('../dist/', import.meta.url), { recursive: true })).filter((f) => f.endsWith('index.html'));
  assert.ok(pages.length >= 8, `ページが足りない: ${pages.length}`);
  for (const page of pages) {
    const count = (await readDist(page)).match(BEACON)?.length ?? 0;
    assert.equal(count, expected, `beacon の本数が違う: ${page}`);
  }
});


const DIST = new URL('../dist/', import.meta.url);
const allPages = async () => (await readdir(DIST, { recursive: true })).filter((f) => f.endsWith('index.html'));

test('すべてのページのナビが 4 件のリンクを持ち、現在ページだけに aria-current を付ける', async () => {
  const sections = { '': '/', contact: '/contact/', works: '/works/', articles: '/articles/' };
  for (const path of await allPages()) {
    const page = await readDist(path);
    const nav = page.match(/<nav[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? '';
    const hrefs = [...nav.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, ['/', '/works/', '/articles/', '/contact/'], `ナビが違う: ${path}`);
    const top = path.includes('/') ? path.split('/')[0] : '';
    const expected = sections[top];
    const current = page.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];
    assert.equal(current.length, expected ? 1 : 0, `aria-current の数が違う: ${path}`);
    if (expected) assert.ok(current[0].includes(`href="${expected}"`), `aria-current の位置が違う: ${path}`);
  }
});

test('すべてのページが GitHub・Zenn・プライバシーポリシーへリンクする', async () => {
  for (const path of await allPages()) {
    const page = await readDist(path);
    for (const href of ['https://github.com/mosidas', 'https://zenn.dev/mosida', '/privacy/']) {
      assert.ok(page.includes(`href="${href}"`), `リンクがない: ${path} の ${href}`);
    }
  }
});

test('すべてのページが外部フォント・インラインの script・style を含まない', async () => {
  for (const path of await allPages()) {
    const page = await readDist(path);
    for (const word of ['fonts.googleapis.com', 'gstatic.com', '<style', ' style="']) {
      assert.ok(!page.includes(word), `含む: ${path} の ${word}`);
    }
    for (const script of page.match(/<script[^>]*>/g) ?? []) {
      assert.ok(script.includes('src="https://'), `インラインの script: ${path}`);
    }
  }
});

test('フォントを自前で配信し、CSS がそれを参照する', async () => {
  for (const file of ['mplus1code-latin.woff2', 'mplus1code-latin-ext.woff2', 'OFL.txt']) {
    await access(new URL(`fonts/${file}`, DIST));
  }
  const cssFiles = (await readdir(new URL('_astro/', DIST))).filter((f) => f.endsWith('.css'));
  const css = (await Promise.all(cssFiles.map((f) => readDist(`_astro/${f}`)))).join('');
  assert.ok(css.includes('/fonts/mplus1code-latin.woff2'));
  assert.ok(css.includes('/fonts/mplus1code-latin-ext.woff2'));
});

test('dist/works/index.html が 6 件の詳細へのリンクを projects の順で持ち、日付と短い説明を表示する', async () => {
  const page = await readDist('works/index.html');
  let last = -1;
  for (const { name, date, short } of projects) {
    const link = `href="/works/${name}/"`;
    assert.ok(page.includes(link), `リンクがない: ${name}`);
    assert.ok(page.includes(`datetime="${date}">${date}</time>`), `日付がない: ${name}`);
    assert.ok(page.includes(`>${escapeHtml(short)}</span>`), `短い説明がない: ${name}`);
    const index = page.indexOf(link);
    assert.ok(index > last, `順序が違う: ${name}`);
    last = index;
  }
});

test('各 dist/works/<name>/index.html が h1・GitHub へのリンク・前後の制作物へのリンク・使用技術・番号を持ち、img を含まない', async () => {
  const n = projects.length;
  for (const [i, { name, url, stack }] of projects.entries()) {
    const page = await readDist(`works/${name}/index.html`);
    assert.match(page, new RegExp(`<h1[^>]*>${name}</h1>`), `h1 がない: ${name}`);
    assert.ok(page.includes(`href="${url}"`), `GitHub へのリンクがない: ${name}`);
    for (const [label, other] of [['前', projects[(i - 1 + n) % n]], ['次', projects[(i + 1) % n]]]) {
      assert.ok(
        page.includes(`href="/works/${other.name}/" aria-label="${label}の制作物: ${other.name}"`),
        `${label}のリンクがない: ${name} から ${other.name}`,
      );
    }
    assert.ok(page.includes(`${String(i + 1).padStart(2, '0')} / 06`), `番号がない: ${name}`);
    assert.ok(stack.length > 0, `使用技術がない: ${name}`);
    for (const tech of stack) {
      const escaped = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(page, new RegExp(`<li[^>]*>${escaped}</li>`), `使用技術がない: ${name} の ${tech}`);
    }
    assert.ok(!page.includes('<img'), `img がある: ${name}`);
  }
});

test('dist/articles/index.html が各記事のリンク・題名・日付を zenn.json の順で含む', async () => {
  const page = await readDist('articles/index.html');
  if (zenn.length === 0) {
    assert.ok(page.includes('記事はまだない。'));
  }
  const ymd = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' });
  let last = -1;
  for (const { title, url, date } of zenn) {
    const link = `href="${escapeHtml(url)}"`;
    assert.ok(page.includes(link), `リンクがない: ${url}`);
    assert.ok(page.includes(`>${escapeHtml(title)}</span>`), `題名がない: ${title}`);
    assert.ok(page.includes(`datetime="${date}"`), `日付がない: ${date}`);
    assert.ok(page.includes(`>${ymd.format(new Date(date))}</time>`), `表示の日付がない: ${date}`);
    const index = page.indexOf(link);
    assert.ok(index > last, `順序が違う: ${url}`);
    last = index;
  }
});
