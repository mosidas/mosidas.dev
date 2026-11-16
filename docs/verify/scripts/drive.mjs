#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const RUNS = join(ROOT, 'docs/verify/runs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Cloudflare が公開している、常に検証を通すテスト用のシークレット(ローカルでは hostname が example.com になる)
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';
const READY_TITLE = '<title>mosida</title>';
const USAGE = '使い方: drive.mjs <up|doctor|browser|down> <実行の ID> [操作...]';
const WRANGLER_LOG = 'wrangler.log';
const BROWSER_LOG = 'browser.log';

/** @typedef {{ id: string, dir: string, env: string, data: string, chrome: string, chromePid: string, evidence: string }} Paths */
/** @typedef {Record<'RUN_ID' | 'BASE' | 'PORT' | 'INSPECTOR_PORT' | 'PID' | 'COMMIT' | 'DIST' | 'EVIDENCE_DIR', string>} Run */

/** @param {string} id */
const paths = (id) => {
  const dir = join(RUNS, id);
  return {
    id,
    dir,
    env: join(dir, 'run.env'),
    data: join(dir, 'data'),
    chrome: join(dir, 'chrome'),
    chromePid: join(dir, 'chrome.pid'),
    evidence: join(dir, 'evidence'),
  };
};

/** @param {string | undefined} id */
const validId = (id) => id !== undefined && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';

/**
 * run.env は手引きが `. run.env` でシェルに読み込むので、値を単引用符で囲み、値の中の単引用符を '\'' にして書く。
 * @param {Run} run
 */
const formatRun = (run) => Object.entries(run).map(([k, v]) => `${k}='${v.replaceAll("'", "'\\''")}'\n`).join('');

/**
 * formatRun が書いた形だけを読む。
 * @param {Paths} p
 * @returns {Run | undefined}
 */
const readRun = (p) =>
  existsSync(p.env)
    ? /** @type {Run} */ (
        Object.fromEntries(
          Array.from(readFileSync(p.env, 'utf8').matchAll(/^(\w+)='((?:[^']|'\\'')*)'$/gm), ([, k, v]) => [k, v.replaceAll("'\\''", "'")]),
        )
      )
    : undefined;

/**
 * @param {string} cmd
 * @param {string[]} args
 */
const out = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

/** @param {number} pid */
const groupAlive = (pid) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e).code !== 'ESRCH';
  }
};

/** @param {string | number} port */
const listeners = (port) => out('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']).split('\n').filter(Boolean);

/**
 * @param {() => boolean | Promise<boolean>} done
 * @param {number} ms
 */
const waitFor = async (done, ms) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(200)) {
    if (await done()) return true;
  }
  return done();
};

/** @param {number} n */
const freePorts = async (n) => {
  // shortcut: 空きポートの選択と bind の間に競合の隙がある, 衝突が観測されたら wrangler の出力から実際のポートを読む
  const servers = await Promise.all(
    Array.from(
      { length: n },
      () =>
        /** @type {Promise<import('node:net').Server>} */ (
          new Promise((ok, ng) => {
            const server = createServer();
            server.once('error', ng);
            server.listen(0, '127.0.0.1', () => ok(server));
          })
        ),
    ),
  );
  const ports = servers.map((s) => /** @type {import('node:net').AddressInfo} */ (s.address()).port);
  await Promise.all(servers.map((s) => new Promise((ok) => s.close(ok))));
  return ports;
};

/** @param {string} dir */
const listFiles = async (dir) =>
  (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath, d.name)))
    .sort();

const distHash = async () => {
  const dist = join(ROOT, 'dist');
  const hash = createHash('sha256');
  for (const file of await listFiles(dist)) {
    hash.update(`${file}\0${createHash('sha256').update(await readFile(join(dist, file))).digest('hex')}\n`);
  }
  return hash.digest('hex');
};

/**
 * Node の fetch は wrangler の自己署名の証明書を拒否するので node:https で検証を外して取る。
 * @param {string} base
 * @returns {Promise<boolean>}
 */
const homeReady = (base) =>
  new Promise((ok) => {
    const req = request(`${base}/`, { rejectUnauthorized: false, agent: false, timeout: 5000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => ok(res.statusCode === 200 && body.includes(READY_TITLE)));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => ok(false));
    req.end();
  });

/**
 * SIGTERM で止め、止まらなければ SIGKILL を送る。gone が真になった宛先には SIGKILL を送らない。
 * @param {number} target process.kill の宛先(負ならプロセスグループ)
 * @param {() => boolean} gone
 */
const terminate = async (target, gone) => {
  for (const [signal, ms] of /** @type {const} */ ([['SIGTERM', 15_000], ['SIGKILL', 5_000]])) {
    try {
      process.kill(target, signal);
    } catch {}
    if (await waitFor(gone, ms)) return true;
  }
  return false;
};

/**
 * @param {number} pid
 * @param {string[]} ports
 */
const stopGroup = async (pid, ports) => (await terminate(-pid, () => !groupAlive(pid))) && ports.every((port) => listeners(port).length === 0);

/**
 * リーダーの npx だけが落ちても、グループの ID はメンバーが残る間は再利用されない(POSIX の Process ID の定義)。
 * このためリーダーでなくグループの中身で判定する。npx の command は npm が書き換えた process.title(npm exec …)なので、
 * 同じグループの node の wrangler の command で --persist-to を照合する。
 * wrangler の本体の node が落ちると親の node 2 つも終わり、PORT を持つ workerd だけが残る(orphan)。
 * @param {Run} run
 * @param {Paths} p
 * @returns {'gone' | 'mine' | 'orphan' | 'foreign'}
 */
const groupState = (run, p) => {
  const commands = out('ps', ['-ww', '-g', run.PID, '-o', 'command=']).split('\n').filter(Boolean);
  if (commands.length === 0) return 'gone';
  if (commands.some((c) => c.includes(`--persist-to ${p.data}`))) return 'mine';
  const workerd = new RegExp(`--socket-addr=entry=localhost:${run.PORT}(?!\\d)`);
  return commands.some((c) => workerd.test(c)) ? 'orphan' : 'foreign';
};

/**
 * @param {Run} run
 * @param {Paths} p
 * @returns {Record<ReturnType<typeof groupState>, string | undefined>} 状態ごとの問題。mine は問題がない
 */
const groupProblems = (run, p) => ({
  gone: `グループ ${run.PID} は既に無い`,
  mine: undefined,
  orphan: `グループ ${run.PID} の wrangler が落ち、PORT ${run.PORT} の workerd だけが残る`,
  foreign: `グループ ${run.PID} に --persist-to ${p.data} のプロセスも PORT ${run.PORT} の workerd もない`,
});

/**
 * workerd は npx と同じプロセスグループに入り、PORT と INSPECTOR_PORT を LISTEN する。
 * @param {Run} run
 * @returns {string | undefined}
 */
const ownsPorts = (run) => {
  for (const port of [run.PORT, run.INSPECTOR_PORT]) {
    const pids = listeners(port);
    if (pids.length === 0) return `ポート ${port} で LISTEN がない`;
    const foreign = pids.filter((pid) => out('ps', ['-o', 'pgid=', '-p', pid]) !== run.PID);
    if (foreign.length > 0) return `ポート ${port} を別のグループの PID ${foreign.join(',')} が持つ`;
  }
};

/**
 * @param {string} evidence
 * @param {string} file
 * @returns {string | undefined} evidence の内側に解決できるときだけ絶対パス
 */
const evidencePath = (evidence, file) => {
  const abs = resolve(evidence, file);
  const rel = relative(evidence, abs);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? abs : undefined;
};

/** @param {Paths} p */
const clean = (p) => Promise.all([p.data, p.chrome, p.chromePid, p.env].map((f) => rm(f, { recursive: true, force: true })));

/** @typedef {{ send: (method: string, params?: object) => Promise<any>, once: (method: string, ms: number) => Promise<any> }} Cdp */

class Disconnected extends Error {}

/**
 * 接続が切れると、待っている要求とイベントの待ちを Disconnected で拒否し、その後の要求もすぐ拒否する。
 * WebSocket は閉じた後の send を黙って捨てるので、拒否しないと応答を永久に待つ。
 * @param {WebSocket} ws
 * @returns {Cdp}
 */
const connect = (ws) => {
  let next = 0;
  /** @type {Disconnected | undefined} */
  let lost;
  /** @type {Map<number, { ok: (v: any) => void, ng: (e: Error) => void }>} */
  const pending = new Map();
  /** @type {Set<(m: any) => void>} */
  const events = new Set();
  /** @type {Set<(e: Error) => void>} */
  const eventWaiters = new Set();
  const drop = () => {
    lost ??= new Disconnected('CDP の接続が切れた');
    for (const { ng } of pending.values()) ng(lost);
    pending.clear();
    for (const ng of eventWaiters) ng(lost);
  };
  ws.addEventListener('close', drop);
  ws.addEventListener('error', drop);
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    const waiter = pending.get(m.id);
    if (waiter) {
      pending.delete(m.id);
      if (m.error) waiter.ng(new Error(`${m.error.message}`));
      else waiter.ok(m.result);
    } else for (const handle of events) handle(m);
  });
  return {
    send: (method, params = {}) =>
      new Promise((ok, ng) => {
        if (lost) return ng(lost);
        pending.set(++next, { ok, ng });
        ws.send(JSON.stringify({ id: next, method, params }));
      }),
    once: (method, ms) => {
      const promise = new Promise((ok, ng) => {
        if (lost) return ng(lost);
        /** @param {(settle: () => void) => void} finish */
        const finish = (settle) => {
          clearTimeout(timer);
          events.delete(handle);
          eventWaiters.delete(fail);
          settle();
        };
        /** @param {any} m */
        const handle = (m) => {
          if (m.method === method) finish(() => ok(m.params));
        };
        /** @param {Error} e */
        const fail = (e) => finish(() => ng(e));
        const timer = setTimeout(() => fail(new Error(`${method} が ${ms / 1000} 秒で来ない`)), ms);
        events.add(handle);
        eventWaiters.add(fail);
      });
      promise.catch(() => {});
      return promise;
    },
  };
};

/**
 * @param {Cdp} cdp
 * @param {string} expression
 */
const evaluate = async (cdp, expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

/**
 * 評価の例外とページの移動中の CDP の誤りは偽に数える。接続が切れたときは待っても真にならないので投げる。
 * @param {Cdp} cdp
 * @param {string} expression
 */
const truthy = (cdp, expression) =>
  evaluate(cdp, expression).catch((e) => {
    if (e instanceof Disconnected) throw e;
    return false;
  });

/** @param {string} selector */
const element = (selector) =>
  `(document.querySelector(${JSON.stringify(selector)}) ?? (() => { throw new Error('要素がない: ' + ${JSON.stringify(selector)}); })())`;

// 読み込み中のページへの入力とクリックは効かないことがある
/** @param {Cdp} cdp */
const loaded = async (cdp) => {
  const complete = () => truthy(cdp, 'document.readyState === "complete"');
  if (!(await waitFor(complete, 15_000))) throw new Error('読み込みが 15 秒で終わらない');
};

/** @typedef {{ arity: number, outArg?: number, run: (cdp: Cdp, run: Run, ...args: string[]) => Promise<void> }} Action */

/** @type {Record<string, Action>} */
const ACTIONS = {
  open: {
    arity: 1,
    run: async (cdp, run, path) => {
      const loadEvent = cdp.once('Page.loadEventFired', 15_000);
      const r = await cdp.send('Page.navigate', { url: new URL(path, run.BASE).href });
      if (r.errorText) throw new Error(r.errorText);
      await loadEvent;
    },
  },
  fill: {
    arity: 2,
    run: async (cdp, _run, selector, text) => {
      await loaded(cdp);
      await evaluate(cdp, `{ const el = ${element(selector)}; el.focus(); el.select(); }`);
      await cdp.send('Input.insertText', { text });
    },
  },
  enter: {
    arity: 0,
    run: async (cdp) => {
      await loaded(cdp);
      const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    },
  },
  click: {
    arity: 1,
    run: async (cdp, _run, selector) => {
      await loaded(cdp);
      const { x, y } = await evaluate(
        cdp,
        `{ const el = ${element(selector)}; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); }`,
      );
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      }
    },
  },
  until: {
    arity: 1,
    run: async (cdp, _run, expression) => {
      const done = () => truthy(cdp, `!!(${expression})`);
      if (!(await waitFor(done, 15_000))) throw new Error('15 秒で真にならない');
    },
  },
  text: {
    arity: 2,
    outArg: 1,
    run: async (cdp, run, selector, file) => {
      const text = await evaluate(cdp, `${element(selector)}.innerText`);
      const abs = /** @type {string} */ (evidencePath(run.EVIDENCE_DIR, file));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, `${text}\n`);
    },
  },
  shot: {
    arity: 1,
    outArg: 0,
    run: async (cdp, run, file) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const abs = /** @type {string} */ (evidencePath(run.EVIDENCE_DIR, file));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, Buffer.from(data, 'base64'));
    },
  },
};

/**
 * @param {string[]} args
 * @param {string} evidence
 * @returns {{ steps: { name: string, args: string[] }[] } | { error: string }}
 */
const parseSteps = (args, evidence) => {
  const steps = [];
  for (let i = 0; i < args.length; ) {
    const name = args[i];
    if (!Object.hasOwn(ACTIONS, name)) return { error: `未知の操作: ${name}` };
    const { arity, outArg } = ACTIONS[name];
    const stepArgs = args.slice(i + 1, i + 1 + arity);
    if (stepArgs.length < arity) return { error: `${name} の引数が ${arity} 個に足りない` };
    if (outArg !== undefined) {
      const abs = evidencePath(evidence, stepArgs[outArg]);
      if (!abs) return { error: `${name} の出力先が evidence の外: ${stepArgs[outArg]}` };
      // macOS の既定のファイルシステムは大文字と小文字を区別しないので、小文字にして比べる
      if ([WRANGLER_LOG, BROWSER_LOG].includes(relative(evidence, abs).toLowerCase())) return { error: `${name} の出力先が証拠のログ: ${stepArgs[outArg]}` };
    }
    steps.push({ name, args: stepArgs });
    i += 1 + arity;
  }
  return steps.length > 0 ? { steps } : { error: '操作がない' };
};

/** @param {number} port */
const pageTarget = async (port) => {
  /** @type {{ type: string, webSocketDebuggerUrl: string } | undefined} */
  let target;
  const found = await waitFor(async () => {
    try {
      /** @type {{ type: string, webSocketDebuggerUrl: string }[]} */
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {}
    return target !== undefined;
  }, 15_000);
  if (!found || !target) throw new Error('Chrome の page のターゲットが 15 秒で見つからない');
  return target;
};

/**
 * @param {Paths} p
 * @returns {Promise<boolean>} この実行の Chrome が残っていない
 */
const stopChrome = async (p) => {
  if (!existsSync(p.chromePid)) return true;
  const pid = readFileSync(p.chromePid, 'utf8').trim();
  const gone = () => !out('ps', ['-ww', '-o', 'command=', '-p', pid]).includes(`--user-data-dir=${p.chrome}`);
  return gone() || terminate(Number(pid), gone);
};

/** @type {Record<string, (p: Paths, args: string[]) => Promise<number>>} */
const COMMANDS = {
  up: async (p) => {
    if (existsSync(p.env)) {
      console.error('起動済み。doctor を実行する');
      return 1;
    }
    // wrangler.log と browser.log は追記するので、同じ ID で up し直すと前の回の行と混ざり証拠の件数が合わなくなる
    if (existsSync(p.evidence)) {
      console.error('使用済みの実行の ID。新しい ID で up する');
      return 1;
    }
    if (spawnSync('npx', ['astro', 'build'], { cwd: ROOT, stdio: 'inherit' }).status !== 0) return 1;
    const [port, inspectorPort] = await freePorts(2);
    const base = `https://localhost:${port}`;
    const commit = out('git', ['rev-parse', 'HEAD']);
    const dist = await distHash();
    await mkdir(p.data, { recursive: true });
    await mkdir(p.evidence, { recursive: true });
    const log = join(p.evidence, WRANGLER_LOG);
    const fd = openSync(log, 'a');
    // wrangler の warn と error は stderr、info と Ready on は stdout に出るので、両方を同じログに書く
    const child = spawn(
      'npx',
      [
        'wrangler', 'dev',
        '--port', String(port),
        '--inspector-port', String(inspectorPort),
        '--local-upstream', 'mosidas.dev',
        '--local-protocol', 'https',
        '--persist-to', p.data,
        '--var', `TURNSTILE_SECRET_KEY:${TURNSTILE_TEST_SECRET}`,
        '--var', 'CONTACT_TO:verify@example.com',
      ],
      { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd] },
    );
    child.unref();
    closeSync(fd);
    const pid = /** @type {number} */ (child.pid);
    /** @type {Run} */
    const run = {
      RUN_ID: p.id,
      BASE: base,
      PORT: String(port),
      INSPECTOR_PORT: String(inspectorPort),
      PID: String(pid),
      COMMIT: commit,
      DIST: dist,
      EVIDENCE_DIR: p.evidence,
    };
    await writeFile(p.env, formatRun(run));
    const ready = await waitFor(
      async () => !groupAlive(pid) || (readFileSync(log, 'utf8').includes(`Ready on ${base}`) && (await homeReady(base))),
      90_000,
    );
    if (ready && groupAlive(pid)) {
      console.log(`ready ${base}`);
      return 0;
    }
    const stopped = await stopGroup(pid, [run.PORT, run.INSPECTOR_PORT]);
    if (stopped) await clean(p);
    console.error(`起動できない。${relative(ROOT, log)} の末尾:`);
    console.error(readFileSync(log, 'utf8').split('\n').slice(-40).join('\n'));
    if (!stopped) console.error(`グループ ${pid} かポート ${run.PORT}・${run.INSPECTOR_PORT} が残るので run.env を残す。down を実行する`);
    return 1;
  },

  doctor: async (p) => {
    const run = readRun(p);
    if (!run) {
      console.log(`ng run.env: ${relative(ROOT, p.env)} がない`);
      return 1;
    }
    console.log('ok run.env');
    /** @type {[string, () => (string | undefined) | Promise<string | undefined>][]} */
    const checks = [
      ['プロセス', () => groupProblems(run, p)[groupState(run, p)]],
      ['ポート', () => ownsPorts(run)],
      ['コミット', () => {
        const head = out('git', ['rev-parse', 'HEAD']);
        return head === run.COMMIT ? undefined : `HEAD が ${head}、起動時は ${run.COMMIT}`;
      }],
      ['ビルド', async () => ((await distHash()) === run.DIST ? undefined : 'dist/ が起動時と違う')],
      ['応答', async () => ((await homeReady(run.BASE)) ? undefined : `GET ${run.BASE}/ が 200 で ${READY_TITLE} を含まない`)],
    ];
    let failed = false;
    for (const [name, check] of checks) {
      const problem = await check();
      failed ||= problem !== undefined;
      console.log(problem === undefined ? `ok ${name}` : `ng ${name}: ${problem}`);
    }
    console.log(`BASE=${run.BASE}\nCOMMIT=${run.COMMIT}\nEVIDENCE_DIR=${run.EVIDENCE_DIR}`);
    return failed ? 1 : 0;
  },

  browser: async (p, args) => {
    const parsed = parseSteps(args, p.evidence);
    if ('error' in parsed) {
      console.error(parsed.error);
      return 2;
    }
    const run = readRun(p);
    if (!run) {
      console.error(`${relative(ROOT, p.env)} がない。up を実行する`);
      return 1;
    }
    const [port] = await freePorts(1);
    await mkdir(p.chrome, { recursive: true });
    await mkdir(p.evidence, { recursive: true });
    // 拡張機能を許すと Chrome は既定の拡張機能(数百 KB の .js)をプロファイルに入れ、tsconfig の include が拾って astro check がメモリ不足で落ちる
    const chrome = spawn(
      CHROME,
      ['--headless', '--ignore-certificate-errors', '--hide-scrollbars', '--disable-extensions', `--remote-debugging-port=${port}`, `--user-data-dir=${p.chrome}`, 'about:blank'],
      { stdio: 'ignore' },
    );
    const exited = new Promise((ok) => chrome.once('exit', ok));
    await writeFile(p.chromePid, String(chrome.pid));
    /** @type {WebSocket | undefined} */
    let ws;
    try {
      const target = await pageTarget(port);
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      ws = socket;
      await new Promise((ok, ng) => {
        socket.addEventListener('open', ok);
        socket.addEventListener('error', () => ng(new Error('CDP の WebSocket につながらない')));
      });
      const cdp = connect(socket);
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      // headless Chrome は幅 500px 未満に縮まないので、画面の大きさは CDP のエミュレーションで決める
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      for (const step of parsed.steps) {
        const label = [step.name, ...step.args].join(' ');
        /** @type {string} */
        let result;
        try {
          await ACTIONS[step.name].run(cdp, run, ...step.args);
          result = 'ok';
        } catch (e) {
          result = `ng: ${/** @type {Error} */ (e).message.split('\n')[0]}`;
        }
        const line = `${new Date().toISOString()} ${label} ${result}`;
        console.log(line);
        await appendFile(join(p.evidence, BROWSER_LOG), `${line}\n`);
        if (result !== 'ok') return 1;
      }
      return 0;
    } finally {
      ws?.close();
      chrome.kill('SIGTERM');
      await exited;
      await rm(p.chromePid, { force: true });
    }
  },

  down: async (p) => {
    if (!(await stopChrome(p))) {
      console.log(`ng 停止: --user-data-dir=${p.chrome} の Chrome が残る`);
      return 1;
    }
    const run = readRun(p);
    if (!run) {
      await clean(p);
      console.log('記録されたインスタンスはない');
      return 0;
    }
    const state = groupState(run, p);
    const problem = groupProblems(run, p)[state];
    if (state === 'foreign') {
      console.log(`ng プロセス: ${problem}。何も止めない`);
      return 1;
    }
    if (problem) console.log(problem);
    if (state !== 'gone' && !(await stopGroup(Number(run.PID), [run.PORT, run.INSPECTOR_PORT]))) {
      console.log(`ng 停止: グループ ${run.PID} かポート ${run.PORT}・${run.INSPECTOR_PORT} が残る`);
      return 1;
    }
    await clean(p);
    console.log(`evidence: ${relative(ROOT, p.evidence)}`);
    if (existsSync(p.evidence)) for (const file of await listFiles(p.evidence)) console.log(`  ${file}`);
    return 0;
  },
};

const [name, id, ...args] = process.argv.slice(2);
if (!Object.hasOwn(COMMANDS, name) || !validId(id)) {
  console.error(USAGE);
  process.exit(2);
}
process.exitCode = await COMMANDS[name](paths(id), args).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  return 1;
});
