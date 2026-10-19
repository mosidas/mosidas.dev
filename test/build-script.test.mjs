import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { commitSnapshot, createIssue, redact, restoreFromSnapshot, main } from '../scripts/build.mjs';

const realFetch = globalThis.fetch;
/** @type {{ url: string, method: string, headers: Headers, body: any }[]} */
let calls;
/** @type {(method: string, path: string) => Response} */
let respond;

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({
      url: u,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return respond(init?.method ?? 'GET', u.replace('https://api.github.com/repos/mosidas/mosidas.dev', ''));
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const files = [
  { path: 'src/data/news.json', content: new TextEncoder().encode('[]\n') },
  { path: 'public/news/images/a.png', content: new Uint8Array([1, 2, 3]) },
];

const CONTENTS = 'GET /contents/src/data/zenn.json?ref=content-snapshot';

/** @param {{ ref?: number, parentTree?: string, status?: Record<string, number>, zenn?: string }} o zenn を省くとスナップショットに zenn.json が無い(404) */
const github = ({ ref = 200, parentTree = 'old-tree', status = {}, zenn } = {}) => (method, path) => {
  const key = `${method} ${path}`;
  if (status[key]) return new Response('{}', { status: status[key] });
  if (key === CONTENTS) {
    return zenn === undefined
      ? new Response('{}', { status: 404 })
      : Response.json({ encoding: 'base64', content: Buffer.from(zenn).toString('base64') });
  }
  if (key === 'GET /git/ref/heads/content-snapshot') {
    return ref === 200 ? Response.json({ object: { sha: 'parent' } }) : new Response('{}', { status: ref });
  }
  if (key === 'POST /git/blobs') return Response.json({ sha: `blob${calls.length}` }, { status: 201 });
  if (key === 'POST /git/trees') return Response.json({ sha: 'new-tree' }, { status: 201 });
  if (key === 'GET /git/commits/parent') return Response.json({ tree: { sha: parentTree } });
  if (key === 'POST /git/commits') return Response.json({ sha: 'new-commit' }, { status: 201 });
  if (key === 'PATCH /git/refs/heads/content-snapshot') return Response.json({});
  if (key === 'POST /git/refs') return Response.json({}, { status: 201 });
  if (key === 'POST /issues') return Response.json({ number: 7 }, { status: 201 });
  throw new Error(`想定外の呼び出し: ${key}`);
};
const keys = () => calls.map((c) => `${c.method} ${c.url.replace('https://api.github.com/repos/mosidas/mosidas.dev', '')}`);

test('ブランチが無ければ親なしでコミットし、POST refs で作る', async () => {
  respond = github({ ref: 404 });
  assert.deepEqual(await commitSnapshot('tok', files, { message: 'm' }), { committed: true, sha: 'new-commit' });
  const trees = calls.find((c) => c.url.endsWith('/git/trees'));
  assert.equal(trees?.body.base_tree, undefined);
  assert.deepEqual(trees?.body.tree.map((t) => t.path), files.map((f) => f.path));
  assert.equal(calls.find((c) => c.url.endsWith('/git/blobs'))?.body.encoding, 'base64');
  assert.deepEqual(calls.find((c) => c.url.endsWith('/git/commits'))?.body.parents, []);
  assert.deepEqual(calls.at(-1)?.body, { ref: 'refs/heads/content-snapshot', sha: 'new-commit' });
  assert.equal(keys().at(-1), 'POST /git/refs');
});

test('tree が親と同じならコミットしない', async () => {
  respond = github({ parentTree: 'new-tree' });
  assert.deepEqual(await commitSnapshot('tok', files, { message: 'm' }), { committed: false, sha: 'parent' });
  assert.ok(!keys().includes('POST /git/commits'));
  assert.ok(!keys().some((k) => k.includes('/git/refs')));
});

test('親があれば親付きでコミットし、force: false で ref を進める', async () => {
  respond = github();
  await commitSnapshot('tok', files, { message: 'm' });
  assert.deepEqual(calls.find((c) => c.url.endsWith('/git/commits'))?.body.parents, ['parent']);
  assert.equal(keys().at(-1), 'PATCH /git/refs/heads/content-snapshot');
  assert.deepEqual(calls.at(-1)?.body, { sha: 'new-commit', force: false });
});

test('トークンを Authorization ヘッダーで送り、URL に含めない', async () => {
  respond = github();
  await commitSnapshot('secret-token', files, { message: 'm' });
  for (const c of calls) {
    assert.ok(!c.url.includes('secret-token'));
    assert.equal(c.headers.get('authorization'), 'Bearer secret-token');
    assert.equal(c.headers.get('accept'), 'application/vnd.github+json');
    assert.ok(c.headers.get('x-github-api-version'));
  }
});

test('422 なら status を含めて失敗する', async () => {
  respond = github({ status: { 'PATCH /git/refs/heads/content-snapshot': 422 } });
  await assert.rejects(commitSnapshot('tok', files, { message: 'm' }), { status: 422, type: 'github_status_422' });
});

test('redact は各値を置き換え、空文字は無視する', () => {
  assert.equal(redact('a key b key c tok', ['key', '', undefined, 'tok']), 'a [redacted] b [redacted] c [redacted]');
});

test('Issue の title と body に stage・error.type・末尾 30 行を載せ、秘密を伏せる', async () => {
  respond = github();
  const detail = Array.from({ length: 40 }, (_, i) => `line${i} secret-token`).join('\n');
  assert.deepEqual(await createIssue('secret-token', { stage: 'fetch', errorType: 'exit_code_1', exitCode: 1, detail }), { number: 7 });
  const { title, body } = calls[0].body;
  assert.equal(title, 'ビルドに失敗した(fetch)');
  assert.ok(body.includes('stage: fetch'));
  assert.ok(body.includes('error.type: exit_code_1'));
  assert.ok(body.includes('終了コード: 1'));
  assert.ok(body.includes('line39 [redacted]'));
  assert.ok(body.includes('line10 '));
  assert.ok(!body.includes('line9 '));
  assert.ok(!body.includes('secret-token'));
});

test('Issue の stderr は 4000 字までに切り詰める', async () => {
  respond = github();
  await createIssue('tok', { stage: 'build', errorType: 'e', exitCode: 1, detail: 'x'.repeat(10_000) });
  assert.equal(calls[0].body.body.match(/x{100,}/)[0].length, 4000);
});

const okRun = () => {
  /** @type {string[][]} */
  const ran = [];
  return { ran, run: (args) => (ran.push(args), { status: 0, signal: null, stderr: '', error: undefined }) };
};

test('WORKERS_CI が無ければ GitHub を呼ばずに fetch と build を実行する', async () => {
  respond = github();
  const { ran, run } = okRun();
  assert.equal(await main({ SNAPSHOT_GITHUB_TOKEN: 'tok', WORKERS_CI_BRANCH: 'main' }, run), 0);
  assert.equal(calls.length, 0);
  assert.equal(ran.length, 3);
  assert.ok(ran[1][0].endsWith('fetch-zenn.mjs'));
  assert.ok(ran[2].at(-1) === 'build');
});

test('main 以外のブランチのプレビューでは GitHub を呼ばない', async () => {
  respond = github();
  const { run } = okRun();
  assert.equal(await main({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'feat/x', SNAPSHOT_GITHUB_TOKEN: 'tok' }, run), 0);
  assert.equal(calls.length, 0);
});

test('子プロセスの env から SNAPSHOT_GITHUB_TOKEN を除く', async () => {
  /** @type {NodeJS.ProcessEnv[]} */
  const envs = [];
  await main({ SNAPSHOT_GITHUB_TOKEN: 'tok', MICROCMS_API_KEY: 'k' }, (_args, env) => (envs.push(env), { status: 0, signal: null, stderr: '', error: undefined }));
  assert.equal(envs.length, 3);
  for (const env of envs) {
    assert.equal(env.SNAPSHOT_GITHUB_TOKEN, undefined);
    assert.equal(env.MICROCMS_API_KEY, 'k');
  }
});

test('本番でトークンが無ければ astro build を実行せず失敗する', async () => {
  respond = github();
  const { ran, run } = okRun();
  assert.equal(await main({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' }, run), 1);
  assert.equal(ran.length, 1);
  assert.equal(calls.length, 0);
});

test('本番で fetch が失敗したら build を実行せず、Issue を作って失敗する', async () => {
  respond = github();
  /** @type {string[][]} */
  const ran = [];
  const run = (args) => (ran.push(args), { status: 1, signal: null, stderr: 'boom tok\n', error: undefined });
  assert.equal(await main({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main', SNAPSHOT_GITHUB_TOKEN: 'tok' }, run), 1);
  assert.equal(ran.length, 1);
  assert.deepEqual(keys(), ['POST /issues']);
  assert.equal(calls[0].body.title, 'ビルドに失敗した(fetch)');
  assert.ok(calls[0].body.body.includes('boom [redacted]'));
});

test('Issue の作成に失敗しても終了コード 1 で終わる', async () => {
  respond = github({ status: { 'POST /issues': 403 } });
  const run = () => ({ status: 2, signal: null, stderr: '', error: undefined });
  assert.equal(await main({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main', SNAPSHOT_GITHUB_TOKEN: 'tok' }, run), 1);
});

const PROD = { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main', SNAPSHOT_GITHUB_TOKEN: 'tok' };

/**
 * 一時ディレクトリを root にして restore を試す。checkout の zenn.json は、並列に走る build.test.mjs が import するので書き換えない。
 * @param {(root: URL, file: string) => Promise<void>} fn
 */
const inTmp = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'zenn-'));
  try {
    await mkdir(join(dir, 'src/data'), { recursive: true });
    await fn(pathToFileURL(dir + '/'), join(dir, 'src/data/zenn.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test('restore はスナップショットの zenn.json を root に書く', () =>
  inTmp(async (root, file) => {
    const zenn = '[{"title":"t","url":"https://zenn.dev/mosida/articles/a","publishedAt":"2026-10-01T00:00:00.000Z"}]\n';
    respond = github({ zenn });
    assert.equal(await restoreFromSnapshot('tok', 'src/data/zenn.json', root), true);
    assert.equal(await readFile(file, 'utf8'), zenn);
    assert.deepEqual(keys(), [CONTENTS]);
  }));

test('restore はスナップショットに無ければ書かない', () =>
  inTmp(async (root, file) => {
    respond = github();
    assert.equal(await restoreFromSnapshot('tok', 'src/data/zenn.json', root), false);
    await assert.rejects(readFile(file), { code: 'ENOENT' });
  }));

test('restore は 500 なら status を含めて失敗する', () =>
  inTmp(async (root) => {
    respond = github({ status: { [CONTENTS]: 500 } });
    await assert.rejects(restoreFromSnapshot('tok', 'src/data/zenn.json', root), { status: 500, type: 'github_status_500' });
  }));

test('restore は内容が JSON の配列でなければ書かずに失敗する', () =>
  inTmp(async (root, file) => {
    for (const zenn of ['{"a":1}', 'not json']) {
      respond = github({ zenn });
      await assert.rejects(restoreFromSnapshot('tok', 'src/data/zenn.json', root), { stage: 'restore', type: 'invalid_snapshot' });
    }
    await assert.rejects(readFile(file), { code: 'ENOENT' });
  }));

test('本番では fetch・restore・fetch-zenn・snapshot・build の順に進め、tree に zenn.json を含める', async () => {
  respond = github();
  const { ran, run } = okRun();
  assert.equal(await main(PROD, run), 0);
  assert.equal(ran.length, 3);
  assert.equal(keys()[0], CONTENTS);
  const trees = calls.find((c) => c.url.endsWith('/git/trees'));
  assert.ok(trees?.body.tree.some((t) => t.path === 'src/data/zenn.json'));
});

test('本番で contents が 500 なら fetch-zenn と build を実行せず、Issue を作って失敗する', async () => {
  respond = github({ status: { [CONTENTS]: 500 } });
  const { ran, run } = okRun();
  assert.equal(await main(PROD, run), 1);
  assert.equal(ran.length, 1);
  assert.deepEqual(keys(), [CONTENTS, 'POST /issues']);
  assert.equal(calls[1].body.title, 'ビルドに失敗した(restore)');
  assert.ok(calls[1].body.body.includes('error.type: github_status_500'));
});

test('fetch-zenn が終了コード 1 で終わったら build を実行せず失敗する', async () => {
  /** @type {string[][]} */
  const ran = [];
  const run = (args) => (ran.push(args), { status: args[0].endsWith('fetch-zenn.mjs') ? 1 : 0, signal: null, stderr: '', error: undefined });
  assert.equal(await main({}, run), 1);
  assert.equal(ran.length, 2);
});
