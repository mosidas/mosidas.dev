import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { projects } from '../src/data/projects.ts';
import { beaconToken } from '../src/analytics.ts';
import news from '../src/data/news.json' with { type: 'json' };
import zenn from '../src/data/zenn.json' with { type: 'json' };

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
// token の有無でビルド結果が変わる beacon を除き、それ以外の script の有無を判定する
const BEACON = /<script defer src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js" data-cf-beacon="[^"]*"><\/script>/g;
const stripBeacon = (page) => page.replace(BEACON, '');
// 表示の日付の期待値をページと同じ式で作る。sv-SE は YYYY-MM-DD の形で返す
const ymd = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' });

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

test('dist/index.html がお知らせの見出しと各お知らせの題名・日付を含む', () => {
  assert.match(html, /<h2[^>]*id="news-heading"[^>]*>お知らせ<\/h2>/);
  if (news.length === 0) {
    assert.ok(html.includes('お知らせはまだない。'));
  }
  for (const { title, publishedAt } of news) {
    assert.ok(html.includes(`>${escapeHtml(title)}</h3>`), `題名がない: ${title}`);
    assert.ok(html.includes(`datetime="${publishedAt}"`), `日付がない: ${publishedAt}`);
    assert.ok(html.includes(`>${ymd.format(new Date(publishedAt))}</time>`), `表示の日付がない: ${publishedAt}`);
  }
});

test('日付の整形が JST の YYYY-MM-DD を返す', () => {
  // CI では news.json・zenn.json が空でループが回らないため、整形の式そのものを固定する
  assert.equal(ymd.format(new Date('2026-01-01T15:00:00.000Z')), '2026-01-02');
});

test('dist/index.html が whoami・about.txt・stack.txt・news.log の 4 ブロックと、GitHub・Zenn・/works/・/articles/・/contact/・/privacy/ へのリンクを持つ', () => {
  assert.ok(html.includes('<title>mosida</title>'));
  for (const command of ['whoami', 'cat about.txt', 'cat stack.txt', 'tail news.log']) {
    assert.ok(html.includes(`</span> ${command}</p>`), `プロンプトがない: ${command}`);
  }
  assert.match(html, /<h1[^>]*>mosida<\/h1>/);
  assert.match(html, /<p[^>]*class="about"[^>]*>名古屋でソフトウェアエンジニアをしています。<\/p>/);
  assert.match(html, /<li[^>]*>Swift \/ Go \/ C# \/ TypeScript<\/li>/);
  assert.ok(html.includes('aria-label="使用技術"'));
  for (const hobby of ['カラオケ', 'ゴルフ']) {
    assert.match(html, new RegExp(`<li[^>]*>${hobby}</li>`), `趣味がない: ${hobby}`);
  }
  assert.ok(html.includes('>読んだ本<span aria-hidden="true"'));
  assert.ok(html.includes('>LAPRAS<'));
  for (const href of [
    'https://github.com/mosidas',
    'https://zenn.dev/mosida',
    '/works/',
    '/articles/',
    '/contact/',
    '/privacy/',
    'https://bookmeter.com/users/1496591/books/read',
    'https://lapras.com/public/SI8OEWA',
  ]) {
    assert.ok(html.includes(`href="${href}"`), `リンクがない: ${href}`);
  }
});

test('dist/index.html が制作物と記事の一覧を含まない', () => {
  for (const { name, url } of projects) {
    assert.ok(!html.includes(`href="${url}"`), `制作物のリンクがある: ${url}`);
    assert.ok(!html.includes(`/works/${name}/`), `制作物の詳細へのリンクがある: ${name}`);
  }
  for (const { url } of zenn) assert.ok(!html.includes(`href="${escapeHtml(url)}"`), `記事のリンクがある: ${url}`);
  for (const word of ['works.log', 'articles.log']) assert.ok(!html.includes(word), `一覧がある: ${word}`);
});

test('zenn.json が 10 件以内で、日付の降順に並び、url がすべて Zenn を指す', () => {
  assert.ok(zenn.length <= 10);
  for (let i = 1; i < zenn.length; i++) {
    assert.ok(Date.parse(zenn[i - 1].date) >= Date.parse(zenn[i].date), `降順でない: ${zenn[i].url}`);
  }
  for (const { url } of zenn) assert.ok(url.startsWith('https://zenn.dev/'), `Zenn でない: ${url}`);
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

test('問い合わせのページが send の送信ボタンを持つ', () => {
  const button = contact.match(/<button[^>]*type="submit"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(button, '送信ボタンがない');
  assert.ok(button[1].includes('send'), `送信ボタンの文言が違う: ${button[1]}`);
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
  for (const word of ['Turnstile', 'Web Analytics']) {
    assert.ok(privacy.includes(word), `記述がない: ${word}`);
  }
  assert.ok(privacy.includes('第三者には提供しません。'));
});

// ページが読み込む /_astro/ の CSS をつなげて返す
const pageCss = async (page) =>
  (await Promise.all([...page.matchAll(/<link rel="stylesheet" href="\/(_astro\/[^"]+\.css)"/g)].map((m) => readDist(m[1])))).join('\n');

test('プライバシーポリシーの制定日が本文から余白で離れる', async () => {
  assert.match(privacy, /<p class="enacted"[^>]*>2026 年 10 月 13 日 制定<\/p>/);
  const css = await pageCss(privacy);
  const rule = css.match(/p\[(data-astro-cid-[a-z0-9]+)\]\.enacted\{margin-top:24px\}/);
  assert.ok(rule, 'margin-top の規則がない');
  // 詳細度が p:not(.prompt-line) の margin: 0 と同じため、後ろに無いと効かない
  const reset = css.indexOf(`p[${rule[1]}]:not(.prompt-line){`);
  assert.ok(reset >= 0, 'margin: 0 の規則がない');
  assert.ok(rule.index > reset, 'margin: 0 の規則より前にある');
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

test('すべてのページのサイドバーの表題が mosida/ で、/ をアクセントの色の span で表示する', async () => {
  for (const path of await allPages()) {
    const title = (await readDist(path)).match(/<p class="site-title"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';
    // 表題の文字列が mosida/ と一致すれば、~/mosida は残っていない
    assert.equal(title.replace(/<[^>]*>/g, ''), 'mosida/', `表題が違う: ${path}`);
    assert.match(title, /<span class="slash"[^>]*>\/<\/span>/, `/ の span がない: ${path}`);
  }
});

const EXTERNAL = /<a\b[^>]*href="https?:\/\/[^"]*"[^>]*>[\s\S]*?<\/a>/g;

test('サイト外へのリンクがすべて新しいタブで開き、読み上げでそれを伝える', async () => {
  let count = 0;
  for (const path of await allPages()) {
    const page = await readDist(path);
    for (const a of page.match(EXTERNAL) ?? []) {
      const open = a.slice(0, a.indexOf('>') + 1);
      assert.ok(open.includes('target="_blank"'), `target がない: ${path} の ${open}`);
      assert.ok(open.includes('rel="noopener noreferrer"'), `rel がない: ${path} の ${open}`);
      count++;
    }
    // お知らせ本文の矢印と読み上げは CSS の ::after で付けるため、文言の検査から外す(本文は div を許可していない)
    for (const a of page.replace(/<div class="news-body"[^>]*>[\s\S]*?<\/div>/g, '').match(EXTERNAL) ?? []) {
      assert.ok(a.includes('(新しいタブで開く)'), `読み上げの文言がない: ${path} の ${a}`);
    }
  }
  assert.ok(count > 0, '外部リンクが見つからない');
});

test('すべてのページが GitHub・Zenn・プライバシーポリシーへリンクする', async () => {
  for (const path of await allPages()) {
    const page = await readDist(path);
    for (const href of ['https://github.com/mosidas', 'https://zenn.dev/mosida', '/privacy/']) {
      assert.ok(page.includes(`href="${href}"`), `リンクがない: ${path} の ${href}`);
    }
  }
});

test('dist の HTML に名前としての mosidas が残っていない', async () => {
  for (const path of await allPages()) {
    const page = (await readDist(path)).replace(/mosidas\.dev|github\.com\/mosidas|mosidas-dev/g, '');
    assert.ok(!page.includes('mosidas'), `名前が残る: ${path}`);
  }
});

test('各制作物の description が句点 1 つで終わる 1 文である', () => {
  for (const { name, description } of projects) {
    assert.ok(description.endsWith('。'), `句点で終わらない: ${name}`);
    assert.equal(description.split('。').length, 2, `1 文でない: ${name}`);
  }
});

test('すべてのページで表示用のプロンプト記号が ❯ で、$ が残っていない', async () => {
  for (const path of await allPages()) {
    const page = await readDist(path);
    assert.doesNotMatch(page, /<span aria-hidden="true"[^>]*>\$/, `$ が残る: ${path}`);
    assert.ok(!page.includes('$ cat'), `$ cat が残る: ${path}`);
  }
  assert.match(html, /<span aria-hidden="true"[^>]*>❯<\/span> top/);
});

test('表示の文言が「問い合わせ」を「お問い合わせ」で統一する', async () => {
  assert.match(contact, /<h1[^>]*>お問い合わせ<\/h1>/);
  for (const path of await allPages()) {
    assert.doesNotMatch(await readDist(path), /(?<!お)問い合わせ/, `「お」の無い表記が残る: ${path}`);
  }
});

test('問い合わせの補足文とトップへ戻るリンクがどのページにも無い', async () => {
  for (const path of await allPages()) {
    const page = await readDist(path);
    for (const word of ['保存せず', 'トップページへ戻る']) {
      assert.ok(!page.includes(word), `含む: ${path} の ${word}`);
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
  const files = await readdir(new URL('fonts/', DIST));
  assert.equal(files.filter((f) => f.endsWith('.woff2')).length, 238);
  for (const file of ['fonts.css', 'OFL.txt']) assert.ok(files.includes(file), `ない: ${file}`);
  const css = await readDist('fonts/fonts.css');
  assert.equal(css.match(/@font-face/g)?.length, 238);
  const refs = [...css.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1]);
  assert.equal(refs.length, 238);
  for (const ref of refs) assert.ok(files.includes(ref), `参照先がない: ${ref}`);
  for (const family of ["font-family: 'M PLUS 1';", "font-family: 'M PLUS 1 Code';"]) {
    assert.ok(css.includes(family), `書体がない: ${family}`);
  }
});

test('等幅の箇所の ↗ をサンセリフで表示する', async () => {
  const work = await readDist(`works/${projects[0].name}/index.html`);
  for (const [name, page] of [['stack', html], ['url', work]]) {
    const rule = new RegExp(`\\.${name}\\[data-astro-cid-[a-z0-9]+\\] span\\[data-astro-cid-[a-z0-9]+\\]\\[aria-hidden=["']?true["']?\\]\\{font-family:var\\(--font-sans\\)\\}`);
    assert.match(await pageCss(page), rule, `規則がない: .${name}`);
  }
});

test('すべてのページがフォントの CSS を読み込む', async () => {
  for (const path of await allPages()) {
    assert.ok((await readDist(path)).includes('<link rel="stylesheet" href="/fonts/fonts.css"'), `読み込まない: ${path}`);
  }
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

test('各 dist/works/<name>/index.html が h1・GitHub へのリンク・前後の制作物へのリンク・使用技術を持ち、パンくずを持たない', async () => {
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
    assert.ok(!page.includes('class="crumb"') && !page.includes('← works/'), `パンくずが残る: ${name}`);
    assert.doesNotMatch(page, /\d{2} \/ \d{2}/, `件数が残る: ${name}`);
    assert.ok(stack.length > 0, `使用技術がない: ${name}`);
    for (const tech of stack) {
      const escaped = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(page, new RegExp(`<li[^>]*>${escaped}</li>`), `使用技術がない: ${name} の ${tech}`);
    }
  }
});

test('各制作物のページが dist にある 300 KB 以下の webp のスクリーンショットを alt 付きで表示する', async () => {
  for (const { name } of projects) {
    const imgs = (await readDist(`works/${name}/index.html`)).match(/<img[^>]*>/g) ?? [];
    assert.ok(imgs.length > 0, `img がない: ${name}`);
    for (const img of imgs) {
      const src = img.match(/ src="([^"]*)"/)?.[1] ?? '';
      assert.match(src, /^\/_astro\/[^/"]+\.webp$/, `webp でない: ${name} の ${src}`);
      assert.ok((await stat(new URL('.' + src, DIST))).size <= 300 * 1024, `300 KB を超える: ${name} の ${src}`);
      assert.match(img, / alt="[^"]+"/, `alt がない: ${name}`);
    }
  }
});

test('プレースホルダーの [ スクリーンショット ] がどのページにも無い', async () => {
  for (const path of await allPages()) {
    assert.ok(!(await readDist(path)).includes('[ スクリーンショット ]'), `残る: ${path}`);
  }
});

test('dist/articles/index.html が各記事のリンク・題名・日付を zenn.json の順で含む', async () => {
  const page = await readDist('articles/index.html');
  if (zenn.length === 0) {
    assert.ok(page.includes('記事はまだない。'));
  }
  let last = -1;
  for (const { title, url, date } of zenn) {
    const link = `href="${escapeHtml(url)}"`;
    assert.ok(page.includes(link), `リンクがない: ${url}`);
    assert.ok(page.includes(`>${escapeHtml(title)}<span aria-hidden="true"`), `題名がない: ${title}`);
    assert.ok(page.includes(`datetime="${date}"`), `日付がない: ${date}`);
    assert.ok(page.includes(`>${ymd.format(new Date(date))}</time>`), `表示の日付がない: ${date}`);
    const index = page.indexOf(link);
    assert.ok(index > last, `順序が違う: ${url}`);
    last = index;
  }
});
