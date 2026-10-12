import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { ContactRateLimiter } from '../src/worker.ts';

const env = { ASSETS: { fetch: async () => new Response('asset') } };

test('http の要求を https://mosidas.dev へ 301 で転送する', async () => {
  const res = await worker.fetch(new Request('http://mosidas.dev/a?b=1'), env);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://mosidas.dev/a?b=1');
});

test('workers.dev の要求を https://mosidas.dev へ 301 で転送する', async () => {
  const res = await worker.fetch(new Request('https://mosidas-dev.example.workers.dev/a?b=1'), env);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://mosidas.dev/a?b=1');
});

test('https://mosidas.dev の要求はアセットの応答をそのまま返す', async () => {
  const res = await worker.fetch(new Request('https://mosidas.dev/'), env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'asset');
});

test('パスが // で始まっても転送先は mosidas.dev から外れない', async () => {
  const res = await worker.fetch(new Request('https://mosidas-dev.example.workers.dev//evil.example/x'), env);
  assert.equal(res.status, 301);
  assert.equal(new URL(res.headers.get('location')).hostname, 'mosidas.dev');
});

test('Host ヘッダーを偽っても転送先は mosidas.dev から外れない', async () => {
  const req = new Request('https://mosidas-dev.example.workers.dev//evil.example/x', {
    headers: { host: 'evil.example' },
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 301);
  assert.equal(new URL(res.headers.get('location')).hostname, 'mosidas.dev');
});

const ORIGIN = 'https://mosidas.dev';
const IP = '203.0.113.7';
const FORM = {
  name: '山田太郎',
  email: 'taro@example.com',
  message: '問い合わせの本文です',
  'cf-turnstile-response': 'turnstile-token-123',
};
const SECRETS = [FORM.name, FORM.email, FORM.message, FORM['cf-turnstile-response'], IP, 'owner@example.com', 'test-secret'];
const CSP = "default-src 'self'";

function contactEnv({ limiter = async () => new Response(null, { status: 204 }), send, ...rest } = {}) {
  const sent = [];
  const limits = [];
  return {
    sent,
    limits,
    TURNSTILE_SECRET_KEY: 'test-secret',
    CONTACT_TO: 'owner@example.com',
    EMAIL: {
      send: async (m) => {
        sent.push(m);
        if (send) await send(m);
      },
    },
    CONTACT_LIMITER: {
      idFromName: (n) => {
        limits.push(n);
        return n;
      },
      get: () => ({ fetch: async () => limiter() }),
    },
    ASSETS: {
      fetch: async (req) =>
        new Response(`${new URL(req.url).pathname} [%MISSING%] [%REQUEST_ID%]`, {
          headers: { 'content-security-policy': CSP, 'content-type': 'text/html; charset=utf-8', 'cf-cache-status': 'HIT' },
        }),
    },
    ...rest,
  };
}

function contactRequest(form = FORM, { method = 'POST', headers = {}, body } = {}) {
  return new Request(ORIGIN + '/api/contact', {
    method,
    headers: {
      origin: ORIGIN,
      'cf-connecting-ip': IP,
      'cf-ray': 'ray-test-1',
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: method === 'POST' ? (body ?? new URLSearchParams(form).toString()) : undefined,
  });
}

// siteverify とログを捕まえて 1 要求を処理し、ログが 1 行で秘密を含まないことを確かめる
async function run(t, env, req, verify = async () => Response.json({ success: true, hostname: 'mosidas.dev' })) {
  const verifyCalls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    verifyCalls.push({ url: String(url), body: new URLSearchParams(init.body) });
    return verify();
  });
  const out = t.mock.method(console, 'log', () => {});
  const err = t.mock.method(console, 'error', () => {});
  const res = await worker.fetch(req, env);
  const lines = [...out.mock.calls, ...err.mock.calls].map((c) => c.arguments[0]);
  assert.equal(lines.length, 1);
  for (const s of SECRETS) assert.ok(!lines[0].includes(s), `ログに ${s} が含まれる`);
  return { res, log: JSON.parse(lines[0]), stream: out.mock.callCount() ? 'log' : 'error', verifyCalls };
}

test('正常な送信は 303 で送信完了ページへ移り、メールを 1 通送る', async (t) => {
  const env = contactEnv();
  const { res, log, stream, verifyCalls } = await run(t, env, contactRequest());
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://mosidas.dev/contact/sent/');
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0].to, 'owner@example.com');
  assert.equal(env.sent[0].from, 'contact@mosidas.dev');
  assert.equal(env.sent[0].replyTo, FORM.email);
  assert.ok(env.sent[0].text.includes(FORM.message));
  assert.ok(env.sent[0].text.includes(FORM.name));
  assert.equal(verifyCalls.length, 1);
  assert.equal(verifyCalls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(verifyCalls[0].body.get('secret'), 'test-secret');
  assert.equal(verifyCalls[0].body.get('response'), FORM['cf-turnstile-response']);
  assert.equal(verifyCalls[0].body.get('remoteip'), IP);
  assert.equal(stream, 'log');
  assert.equal(log.level, 'info');
  assert.equal(log['app.contact.outcome'], 'sent');
  assert.equal(log['app.request.id'], 'ray-test-1');
  assert.equal(log['http.response.status_code'], 303);
  assert.equal(typeof log.duration_ms, 'number');
});

test('send が例外を投げると 502 で失敗ページを返し、error ログに code を残す', async (t) => {
  const env = contactEnv({
    send: async () => {
      throw Object.assign(new Error(`宛先 owner@example.com に送れない`), { code: 'E_TEST' });
    },
  });
  const { res, log } = await run(t, env, contactRequest());
  assert.equal(res.status, 502);
  assert.equal(await res.text(), '/contact/failed/ [] [ray-test-1]');
  assert.equal(res.headers.get('content-security-policy'), CSP);
  assert.equal(res.headers.get('cf-cache-status'), null);
  assert.equal(res.headers.get('content-length'), null);
  assert.equal(log.level, 'error');
  assert.equal(log['app.contact.outcome'], 'email_send_failed');
  assert.equal(log['error.type'], 'E_TEST');
  assert.equal(log['app.error.origin'], 'system');
  assert.equal(log['app.request.id'], 'ray-test-1');
});

test('トークンが無ければ 403 で siteverify も send も呼ばない', async (t) => {
  const env = contactEnv();
  const { res, log, verifyCalls } = await run(t, env, contactRequest({ ...FORM, 'cf-turnstile-response': '' }));
  assert.equal(res.status, 403);
  assert.equal(await res.text(), '/contact/rejected/ [] [ray-test-1]');
  assert.equal(verifyCalls.length, 0);
  assert.equal(env.sent.length, 0);
  assert.equal(log['app.contact.outcome'], 'turnstile_missing');
  assert.equal(log.level, 'warn');
});

for (const [label, verdict] of [
  ['success: false', { success: false, hostname: 'mosidas.dev' }],
  ['別の hostname', { success: true, hostname: 'evil.example' }],
]) {
  test(`siteverify が ${label} なら 403 で send を呼ばない`, async (t) => {
    const env = contactEnv();
    const { res, log } = await run(t, env, contactRequest(), async () => Response.json(verdict));
    assert.equal(res.status, 403);
    assert.equal(env.sent.length, 0);
    assert.equal(log['app.contact.outcome'], 'turnstile_failed');
  });
}

for (const [label, verify] of [
  ['例外を投げる', async () => { throw new TypeError('network'); }],
  ['5xx を返す', async () => new Response('x', { status: 500 })],
  ['JSON でない本文を返す', async () => new Response('not json')],
]) {
  test(`siteverify が${label}と 503 で send を呼ばない`, async (t) => {
    const env = contactEnv();
    const { res, log } = await run(t, env, contactRequest(), verify);
    assert.equal(res.status, 503);
    assert.equal(await res.text(), '/contact/failed/ [] [ray-test-1]');
    assert.equal(env.sent.length, 0);
    assert.equal(log.level, 'error');
    assert.equal(log['app.contact.outcome'], 'turnstile_unavailable');
    assert.equal(log['app.error.transient'], true);
  });
}

test('名前と本文が空白だけなら 400 で不適合の項目名を示す', async (t) => {
  const env = contactEnv();
  const { res, log, verifyCalls } = await run(t, env, contactRequest({ ...FORM, name: ' ', message: '\n\t' }));
  assert.equal(res.status, 400);
  assert.equal(await res.text(), '/contact/invalid/ [名前、本文] [ray-test-1]');
  assert.equal(env.sent.length, 0);
  assert.equal(verifyCalls.length, 0);
  assert.deepEqual(log['app.contact.invalid_fields'], ['name', 'message']);
  assert.equal(log['app.error.origin'], 'client');
});

test('名前に CRLF を含むと 400 を返す', async (t) => {
  const env = contactEnv();
  const { res } = await run(t, env, contactRequest({ ...FORM, name: '山田\r\nBcc: x@example.com' }));
  assert.equal(res.status, 400);
  assert.equal(env.sent.length, 0);
});

for (const email of ['taro', 'taro@example', 'ta ro@example.com', 'taro@example.com\r\nBcc: x@example.com', '<a>@example.com']) {
  test(`メールアドレス ${JSON.stringify(email)} は 400 を返す`, async (t) => {
    const env = contactEnv();
    const { res } = await run(t, env, contactRequest({ ...FORM, email }));
    assert.equal(res.status, 400);
    assert.equal(await res.text(), '/contact/invalid/ [メールアドレス] [ray-test-1]');
    assert.equal(env.sent.length, 0);
  });
}

test('DO が 429 を返すと 429 で siteverify も send も呼ばない', async (t) => {
  const env = contactEnv({ limiter: async () => new Response(null, { status: 429 }) });
  const { res, log, verifyCalls } = await run(t, env, contactRequest());
  assert.equal(res.status, 429);
  assert.equal(await res.text(), '/contact/limited/ [] [ray-test-1]');
  assert.deepEqual(env.limits, [IP]);
  assert.equal(verifyCalls.length, 0);
  assert.equal(env.sent.length, 0);
  assert.equal(log['app.contact.outcome'], 'rate_limited');
  assert.equal(log.level, 'warn');
});

test('DO の fetch が例外を投げると 503 で siteverify も send も呼ばない', async (t) => {
  const env = contactEnv({
    limiter: async () => {
      throw new TypeError(`${IP} に届かない`);
    },
  });
  const { res, log, verifyCalls } = await run(t, env, contactRequest());
  assert.equal(res.status, 503);
  assert.equal(await res.text(), '/contact/failed/ [] [ray-test-1]');
  assert.equal(verifyCalls.length, 0);
  assert.equal(env.sent.length, 0);
  assert.equal(log.level, 'error');
  assert.equal(log['app.contact.outcome'], 'rate_limiter_unavailable');
  assert.equal(log['app.error.origin'], 'system');
  assert.equal(log['app.error.transient'], true);
  assert.equal(log['error.type'], 'TypeError');
});

test('DO が想定外の状態 500 を返すと 503 で send を呼ばない', async (t) => {
  const env = contactEnv({ limiter: async () => new Response(null, { status: 500 }) });
  const { res, log, verifyCalls } = await run(t, env, contactRequest());
  assert.equal(res.status, 503);
  assert.equal(verifyCalls.length, 0);
  assert.equal(env.sent.length, 0);
  assert.equal(log['app.contact.outcome'], 'rate_limiter_unavailable');
});

function limiterState() {
  const data = new Map();
  const alarms = [];
  return {
    data,
    alarms,
    storage: {
      get: async (k) => data.get(k),
      put: async (k, v) => void data.set(k, v),
      setAlarm: async (at) => void alarms.push(at),
      deleteAll: async () => data.clear(),
    },
  };
}

test('ContactRateLimiter は 60 秒に 3 回まで受け付け、拒否した試行は数えない', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const state = limiterState();
  const limiter = new ContactRateLimiter(state, {});
  const status = async () => (await limiter.fetch()).status;
  assert.equal(await status(), 204);
  t.mock.timers.tick(1000);
  assert.equal(await status(), 204);
  t.mock.timers.tick(1000);
  assert.equal(await status(), 204);
  assert.deepEqual(state.alarms, [60_000, 61_000, 62_000]);
  assert.equal(await status(), 429);
  assert.equal(await status(), 429);
  assert.deepEqual(state.data.get('hits'), [0, 1000, 2000]);
  // 最初の受付から 59 999 ミリ秒後はまだ窓の中、60 000 ミリ秒後に窓から外れる
  t.mock.timers.tick(57_999);
  assert.equal(await status(), 429);
  t.mock.timers.tick(1);
  assert.equal(await status(), 204);
  assert.deepEqual(state.data.get('hits'), [1000, 2000, 60_000]);
  assert.equal(state.alarms.at(-1), 120_000);
  t.mock.timers.tick(60_000);
  assert.equal(await status(), 204);
  await limiter.alarm();
  assert.equal(state.data.size, 0);
});

test('別の Origin からの要求は 403 を返す', async (t) => {
  const env = contactEnv();
  const { res, log } = await run(t, env, contactRequest(FORM, { headers: { origin: 'https://evil.example' } }));
  assert.equal(res.status, 403);
  assert.equal(env.sent.length, 0);
  assert.equal(env.limits.length, 0);
  assert.equal(log['app.contact.outcome'], 'bad_origin');
});

test('GET は 405 と Allow: POST を返す', async (t) => {
  const { res, log } = await run(t, contactEnv(), contactRequest(FORM, { method: 'GET' }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
  assert.equal(log.level, 'warn');
});

test('form 以外の content-type は 400 を返す', async (t) => {
  const env = contactEnv();
  const { res, log } = await run(t, env, contactRequest(FORM, { headers: { 'content-type': 'application/json' } }));
  assert.equal(res.status, 400);
  assert.equal(await res.text(), '/contact/rejected/ [] [ray-test-1]');
  assert.equal(log['app.contact.outcome'], 'bad_body');
});

test('本文が 32768 文字を超えると 413 を返す', async (t) => {
  const env = contactEnv();
  const { res } = await run(t, env, contactRequest(FORM, { body: 'x'.repeat(32769) }));
  assert.equal(res.status, 413);
  assert.equal(env.sent.length, 0);
});

test('シークレットが未設定なら 503 を返す', async (t) => {
  const env = contactEnv({ TURNSTILE_SECRET_KEY: '' });
  const { res, log, verifyCalls } = await run(t, env, contactRequest());
  assert.equal(res.status, 503);
  assert.equal(await res.text(), '/contact/failed/ [] [ray-test-1]');
  assert.equal(verifyCalls.length, 0);
  assert.equal(env.limits.length, 0);
  assert.equal(log.level, 'error');
  assert.equal(log['app.contact.outcome'], 'missing_config');
});

test('cf-ray が無ければ相関 ID を生成して結果ページとログに載せる', async (t) => {
  const req = contactRequest({ ...FORM, name: '' });
  req.headers.delete('cf-ray');
  const { res, log } = await run(t, contactEnv(), req);
  const id = log['app.request.id'];
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(await res.text(), `/contact/invalid/ [名前] [${id}]`);
});

test('wrangler.jsonc は vars を持たず、microCMS・GitHub の値を Worker に渡さない', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /vars|microcms|github/i);
});
