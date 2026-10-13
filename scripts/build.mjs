// お知らせと Zenn の記事を取得し、本番のビルドでは取得したコンテンツを content-snapshot ブランチにコミットしてから astro build を行う。
// 本番では Zenn の取得の前に content-snapshot の zenn.json を復元し、取得に失敗しても前回の一覧でビルドする。
// 失敗したら終了コード 1 で配信を止め、本番ではリポジトリに Issue を作る。
import { spawnSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { log } from './log.mjs';

const REPO = 'https://api.github.com/repos/mosidas/mosidas.dev';
const SNAPSHOT_REF = 'heads/content-snapshot';
const ZENN_PATH = 'src/data/zenn.json';
const TIMEOUT_MS = 30_000;
const ROOT = new URL('..', import.meta.url);

class GitHubError extends Error {
  /** @param {number} status */
  constructor(status) {
    super(`github_status_${status}`);
    this.type = this.message;
    this.status = status;
  }
}

/**
 * @param {string} token
 * @param {string} method
 * @param {string} path REPO からの相対パス
 * @param {unknown} [body]
 * @param {number[]} [allow] 例外にしない status
 */
async function github(token, method, path, body, allow = []) {
  const res = await fetch(`${REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (allow.includes(res.status)) return { status: res.status, data: undefined };
  if (!res.ok) throw new GitHubError(res.status);
  return { status: res.status, data: await res.json() };
}

/**
 * files だけを持つ tree を content-snapshot ブランチにコミットする。内容が前回と同じならコミットしない。
 * @param {string} token
 * @param {{ path: string, content: Uint8Array }[]} files
 * @param {{ message: string }} opts
 */
export async function commitSnapshot(token, files, opts) {
  const ref = await github(token, 'GET', `/git/ref/${SNAPSHOT_REF}`, undefined, [404]);
  const parent = ref.data?.object?.sha;
  const tree = [];
  for (const { path, content } of files) {
    const blob = await github(token, 'POST', '/git/blobs', { content: Buffer.from(content).toString('base64'), encoding: 'base64' });
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.data.sha });
  }
  const treeSha = (await github(token, 'POST', '/git/trees', { tree })).data.sha;
  if (parent) {
    const parentCommit = await github(token, 'GET', `/git/commits/${parent}`);
    if (parentCommit.data.tree.sha === treeSha) return { committed: false, sha: parent };
  }
  const commit = await github(token, 'POST', '/git/commits', {
    message: opts.message,
    tree: treeSha,
    parents: parent ? [parent] : [],
  });
  const sha = commit.data.sha;
  if (parent) {
    await github(token, 'PATCH', `/git/refs/${SNAPSHOT_REF}`, { sha, force: false });
  } else {
    await github(token, 'POST', '/git/refs', { ref: `refs/${SNAPSHOT_REF}`, sha });
  }
  return { committed: true, sha };
}

/**
 * secrets の各値を [redacted] に置き換える。
 * @param {string} text @param {(string | undefined)[]} secrets
 */
export function redact(text, secrets) {
  return secrets.reduce((acc, s) => (s ? acc.replaceAll(s, '[redacted]') : acc), text);
}

const MAX_DETAIL_CHARS = 4000;

/**
 * @param {string} token
 * @param {{ stage: string, errorType: string, exitCode: number | string | null, detail: string }} failure
 */
export async function createIssue(token, { stage, errorType, exitCode, detail }) {
  const env = process.env;
  const tail = redact(detail, [token, env.SNAPSHOT_GITHUB_TOKEN, env.MICROCMS_API_KEY])
    .trimEnd()
    .split('\n')
    .slice(-30)
    .join('\n')
    .slice(-MAX_DETAIL_CHARS);
  const body = [
    `- stage: ${stage}`,
    `- error.type: ${errorType}`,
    `- 終了コード: ${exitCode ?? 'なし'}`,
    `- WORKERS_CI_BUILD_UUID: ${env.WORKERS_CI_BUILD_UUID ?? 'なし'}`,
    `- WORKERS_CI_COMMIT_SHA: ${env.WORKERS_CI_COMMIT_SHA ?? 'なし'}`,
    `- 時刻(UTC): ${new Date().toISOString()}`,
    '',
    'stderr の末尾 30 行:',
    '',
    '````text',
    tail,
    '````',
  ].join('\n');
  const { data } = await github(token, 'POST', '/issues', { title: `ビルドに失敗した(${stage})`, body });
  return { number: data.number };
}

class StageError extends Error {
  /**
   * @param {string} stage @param {string} type
   * @param {number | string | null} exitCode 子プロセスの終了コードまたはシグナル
   * @param {string} detail Issue に載せる詳細(redact 前)
   */
  constructor(stage, type, exitCode, detail) {
    super(type);
    this.stage = stage;
    this.type = type;
    this.exitCode = exitCode;
    this.detail = detail;
  }
}

/** @param {string} stage @param {unknown} err */
const toStageError = (stage, err) =>
  new StageError(stage, err instanceof GitHubError ? err.type : err instanceof Error ? err.name : 'unknown', null, err instanceof Error ? err.message : '');

/**
 * content-snapshot ブランチの path を checkout の同じパスに書く。スナップショットに無ければ書かずに false を返す。
 * @param {string} token
 * @param {string} path JSON の配列を持つファイルのリポジトリ内のパス
 * @returns {Promise<boolean>} 復元したか
 */
export async function restoreFromSnapshot(token, path) {
  const { status, data } = await github(token, 'GET', `/contents/${path}?ref=content-snapshot`, undefined, [404]);
  if (status === 404) return false;
  const invalid = new StageError('restore', 'invalid_snapshot', null, `${path} の内容が JSON の配列でない`);
  if (data?.encoding !== 'base64' || typeof data.content !== 'string') throw invalid;
  const content = Buffer.from(data.content, 'base64');
  try {
    if (!Array.isArray(JSON.parse(content.toString('utf8')))) throw invalid;
  } catch {
    throw invalid;
  }
  await writeFile(new URL(path, ROOT), content);
  return true;
}

/**
 * node でスクリプトを実行する。stderr は捕まえたうえで表示する。
 * @param {string[]} args @param {NodeJS.ProcessEnv} env
 */
function runNode(args, env) {
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'inherit', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.stderr) process.stderr.write(r.stderr);
  return { status: r.status, signal: r.signal, stderr: r.stderr ?? '', error: r.error };
}

/** @param {string} stage @param {ReturnType<typeof runNode>} r */
function assertRun(stage, r) {
  if (r.error) throw new StageError(stage, /** @type {{ code?: string }} */ (r.error).code ?? r.error.name, null, r.stderr);
  if (r.status !== 0) {
    throw new StageError(stage, r.signal ? `signal_${r.signal}` : `exit_code_${r.status}`, r.status ?? r.signal, r.stderr);
  }
}

async function readSnapshotFiles() {
  const files = await Promise.all(['src/data/news.json', ZENN_PATH].map(async (path) => ({ path, content: await readFile(new URL(path, ROOT)) })));
  let entries = [];
  try {
    entries = await readdir(new URL('public/news/images/', ROOT), { withFileTypes: true });
  } catch (err) {
    if (/** @type {{ code?: string }} */ (err).code !== 'ENOENT') throw err;
  }
  for (const e of entries.filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name))) {
    files.push({ path: `public/news/images/${e.name}`, content: await readFile(new URL(`public/news/images/${e.name}`, ROOT)) });
  }
  return files;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {typeof runNode} [run] 子プロセスの実行(テストで差し替える)
 * @returns {Promise<number>} 終了コード
 */
export async function main(env = process.env, run = runNode) {
  const production = Boolean(env.WORKERS_CI) && env.WORKERS_CI_BRANCH === 'main';
  const token = env.SNAPSHOT_GITHUB_TOKEN ?? '';
  const { SNAPSHOT_GITHUB_TOKEN: _, ...childEnv } = env;
  /** @type {Record<string, number>} */
  const durations = {};
  /** @type {{ committed: boolean, sha?: string }} */
  let snapshot = { committed: false };
  let zennRestored = false;
  let stage = 'fetch';
  try {
    let start = performance.now();
    assertRun(stage, run([fileURLToPath(new URL('scripts/fetch-news.mjs', ROOT))], childEnv));
    durations.fetch = Math.round(performance.now() - start);

    stage = 'restore';
    if (production) {
      start = performance.now();
      if (!token) throw new StageError(stage, 'missing_credentials', null, '');
      try {
        zennRestored = await restoreFromSnapshot(token, ZENN_PATH);
      } catch (err) {
        throw err instanceof StageError ? err : toStageError(stage, err);
      }
      durations.restore = Math.round(performance.now() - start);
    }

    stage = 'fetch_zenn';
    start = performance.now();
    assertRun(stage, run([fileURLToPath(new URL('scripts/fetch-zenn.mjs', ROOT))], childEnv));
    durations.fetch_zenn = Math.round(performance.now() - start);

    stage = 'snapshot';
    if (production) {
      start = performance.now();
      try {
        snapshot = await commitSnapshot(token, await readSnapshotFiles(), {
          message: `content: スナップショットを更新する(ビルド ${env.WORKERS_CI_BUILD_UUID ?? '不明'})`,
        });
      } catch (err) {
        throw toStageError(stage, err);
      }
      durations.snapshot = Math.round(performance.now() - start);
    }

    stage = 'build';
    start = performance.now();
    assertRun(stage, run([fileURLToPath(new URL('node_modules/astro/bin/astro.mjs', ROOT)), 'build'], childEnv));
    durations.build = Math.round(performance.now() - start);
  } catch (err) {
    const failure = err instanceof StageError ? err : new StageError(stage, err instanceof Error ? err.name : 'unknown', null, String(err));
    log({
      level: 'error',
      msg: 'ビルドに失敗した',
      'app.build.stage': failure.stage,
      'error.type': failure.type,
      'app.error.origin': 'system',
      ...(failure.exitCode !== null && { 'process.exit.code': failure.exitCode }),
    });
    if (production && token) {
      try {
        const issue = await createIssue(token, {
          stage: failure.stage,
          errorType: failure.type,
          exitCode: failure.exitCode,
          detail: failure.detail,
        });
        log({ level: 'info', msg: 'ビルド失敗の Issue を作った', 'app.issue.number': issue.number });
      } catch (issueErr) {
        log({
          level: 'error',
          msg: 'ビルド失敗の Issue を作れなかった',
          'error.type': issueErr instanceof GitHubError ? issueErr.type : issueErr instanceof Error ? issueErr.name : 'unknown',
          'app.error.origin': 'system',
        });
      }
    }
    return 1;
  }
  log({
    level: 'info',
    msg: 'ビルドした',
    'app.build.production': production,
    'app.build.fetch.duration_ms': durations.fetch,
    ...(durations.restore !== undefined && { 'app.build.restore.duration_ms': durations.restore }),
    'app.build.fetch_zenn.duration_ms': durations.fetch_zenn,
    ...(durations.snapshot !== undefined && { 'app.build.snapshot.duration_ms': durations.snapshot }),
    'app.build.build.duration_ms': durations.build,
    'app.snapshot.committed': snapshot.committed,
    'app.snapshot.zenn_restored': zennRestored,
    ...(snapshot.sha && { 'app.snapshot.commit_sha': snapshot.sha }),
  });
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main();
}
