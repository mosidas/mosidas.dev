// shortcut: 転送のログ・メトリクスなし, R7(アクセス解析)で計装する
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  EMAIL: { send(m: { to: string; from: string; replyTo: string; subject: string; text: string }): Promise<unknown> };
  CONTACT_LIMITER: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
  TURNSTILE_SECRET_KEY?: string;
  CONTACT_TO?: string;
}

const ORIGIN = 'https://mosidas.dev';
const RESULT_PAGES = { invalid: 'invalid', rejected: 'rejected', limited: 'limited', failed: 'failed' } as const;
const LABELS = { name: '名前', email: 'メールアドレス', message: '本文' } as const;
const CONTROL = /\p{Cc}/u;
const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/;
const LIMIT = 3;
const WINDOW_MS = 60_000;

type Field = keyof typeof LABELS;
type Outcome = keyof typeof FAILURES | 'sent';
interface Result {
  response: Response;
  outcome: Outcome;
  errorType?: string;
  invalidFields?: Field[];
}

// 失敗の結果ごとのログのレベルとエラーの分類
const FAILURES = {
  method_not_allowed: { level: 'warn', origin: 'client', transient: false },
  bad_origin: { level: 'warn', origin: 'client', transient: false },
  bad_body: { level: 'warn', origin: 'client', transient: false },
  invalid_fields: { level: 'warn', origin: 'client', transient: false },
  turnstile_missing: { level: 'warn', origin: 'client', transient: false },
  turnstile_failed: { level: 'warn', origin: 'client', transient: false },
  rate_limited: { level: 'warn', origin: 'client', transient: true },
  rate_limiter_unavailable: { level: 'error', origin: 'system', transient: true },
  missing_config: { level: 'error', origin: 'system', transient: false },
  turnstile_unavailable: { level: 'error', origin: 'system', transient: true },
  email_send_failed: { level: 'error', origin: 'system', transient: true },
} as const;

const log = (fields: Record<string, unknown>) =>
  (fields.level === 'info' ? console.log : console.error)(JSON.stringify(fields));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || url.hostname !== 'mosidas.dev') {
      // new URL(path, ORIGIN) は //evil.example を別ホストに解決するため、文字列連結で組み立てる
      return Response.redirect(ORIGIN + url.pathname + url.search, 301);
    }
    if (url.pathname === '/api/contact') return handleContact(request, env);
    return env.ASSETS.fetch(request);
  },
};

// IP ごとに 1 つ作り、直近 WINDOW_MS の受付時刻を数える。ログは呼び出し側の境界で出す
export class ContactRateLimiter {
  state: {
    storage: {
      get<T>(k: string): Promise<T | undefined>;
      put(k: string, v: unknown): Promise<void>;
      setAlarm(t: number): Promise<void>;
      deleteAll(): Promise<void>;
    };
  };

  constructor(state: ContactRateLimiter['state'], _env: unknown) {
    this.state = state;
  }

  async fetch(): Promise<Response> {
    const now = Date.now();
    // get から put の間は入力ゲートで他の要求が割り込まないため、読んで書く処理が原子的になる
    const hits = ((await this.state.storage.get<number[]>('hits')) ?? []).filter((t) => now - t < WINDOW_MS);
    if (hits.length >= LIMIT) return new Response(null, { status: 429 });
    hits.push(now);
    await this.state.storage.put('hits', hits);
    await this.state.storage.setAlarm(now + WINDOW_MS);
    return new Response(null, { status: 204 });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    // alarm は受付と前後して走るため、窓の内側の受付時刻を残して次の alarm を張り直す
    const hits = ((await this.state.storage.get<number[]>('hits')) ?? []).filter((t) => now - t < WINDOW_MS);
    if (hits.length === 0) return this.state.storage.deleteAll();
    await this.state.storage.put('hits', hits);
    await this.state.storage.setAlarm(hits[0] + WINDOW_MS);
  }
}

// shortcut: 問い合わせのメトリクスは Workers Logs の集計で代える, 件数が増えたら Analytics Engine へ移す
async function handleContact(request: Request, env: Env): Promise<Response> {
  const started = Date.now();
  const ray = request.headers.get('cf-ray');
  // 相関 ID は結果ページの HTML に埋め込むため、形を確かめてから使う
  const id = ray && /^[\w-]{1,64}$/.test(ray) ? ray : crypto.randomUUID();
  const r = await processContact(request, env, id);
  const failure = r.outcome === 'sent' ? undefined : FAILURES[r.outcome];
  log({
    level: failure?.level ?? 'info',
    msg: '問い合わせを処理した',
    'app.request.id': id,
    'http.response.status_code': r.response.status,
    'app.contact.outcome': r.outcome,
    duration_ms: Date.now() - started,
    ...(failure && {
      'error.type': r.errorType ?? r.outcome,
      'app.error.origin': failure.origin,
      'app.error.transient': failure.transient,
    }),
    ...(r.invalidFields && { 'app.contact.invalid_fields': r.invalidFields }),
  });
  return r.response;
}

async function processContact(request: Request, env: Env, id: string): Promise<Result> {
  const fail = async (outcome: Outcome, page: keyof typeof RESULT_PAGES, status: number, missing = '') => ({
    outcome,
    response: await resultPage(env, RESULT_PAGES[page], status, { MISSING: missing, REQUEST_ID: id }),
  });

  if (request.method !== 'POST') {
    return { outcome: 'method_not_allowed', response: new Response(null, { status: 405, headers: { Allow: 'POST' } }) };
  }
  if (request.headers.get('origin') !== ORIGIN) return fail('bad_origin', 'rejected', 403);
  const secret = env.TURNSTILE_SECRET_KEY;
  const to = env.CONTACT_TO;
  if (!secret || !to) return fail('missing_config', 'failed', 503);
  const ip = request.headers.get('cf-connecting-ip');
  let limiterStatus: number;
  try {
    const stub = env.CONTACT_LIMITER.get(env.CONTACT_LIMITER.idFromName(ip ?? 'unknown'));
    limiterStatus = (await stub.fetch(new Request('https://limiter/', { method: 'POST' }))).status;
  } catch (e) {
    // message には IP が混ざりうるため、種別の名前だけを残す
    const r = await fail('rate_limiter_unavailable', 'failed', 503);
    return { ...r, errorType: e instanceof Error ? e.name : undefined };
  }
  if (limiterStatus === 429) return fail('rate_limited', 'limited', 429);
  if (limiterStatus !== 204) return fail('rate_limiter_unavailable', 'failed', 503);

  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('application/x-www-form-urlencoded')) return fail('bad_body', 'rejected', 400);
  const raw = await request.text();
  if (raw.length > 32768) return fail('bad_body', 'rejected', 413);
  const params = new URLSearchParams(raw);

  const checked = validate(params);
  if (!checked.ok) {
    const r = await fail('invalid_fields', 'invalid', 400, checked.fields.map((f) => LABELS[f]).join('、'));
    return { ...r, invalidFields: checked.fields };
  }

  const token = params.get('cf-turnstile-response') ?? '';
  if (!token || token.length > 2048) return fail('turnstile_missing', 'rejected', 403);
  let verdict: { success?: unknown; hostname?: unknown };
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    if (!res.ok) throw new Error('siteverify status');
    verdict = await res.json();
  } catch {
    return fail('turnstile_unavailable', 'failed', 503);
  }
  if (verdict.success !== true || verdict.hostname !== 'mosidas.dev') return fail('turnstile_failed', 'rejected', 403);

  const { name, email, message } = checked.value;
  try {
    await env.EMAIL.send({
      to,
      from: 'contact@mosidas.dev',
      replyTo: email,
      subject: 'mosidas.dev への問い合わせ',
      text: `名前: ${name}\nメールアドレス: ${email}\n\n${message}`,
    });
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    const r = await fail('email_send_failed', 'failed', 502);
    return { ...r, errorType: typeof code === 'string' ? code : undefined };
  }
  return { outcome: 'sent', response: new Response(null, { status: 303, headers: { Location: ORIGIN + '/contact/sent/' } }) };
}

function validate(
  params: URLSearchParams,
): { ok: true; value: Record<Field, string> } | { ok: false; fields: Field[] } {
  const value = {
    name: (params.get('name') ?? '').trim(),
    email: (params.get('email') ?? '').trim(),
    message: (params.get('message') ?? '').trim(),
  };
  const fields: Field[] = [];
  if (value.name.length < 1 || value.name.length > 100 || CONTROL.test(value.name)) fields.push('name');
  if (value.email.length < 3 || value.email.length > 254 || CONTROL.test(value.email) || !EMAIL.test(value.email)) {
    fields.push('email');
  }
  if (value.message.length < 1 || value.message.length > 5000) fields.push('message');
  return fields.length ? { ok: false, fields } : { ok: true, value };
}

// 利用者の入力は書き戻さない。差し込むのは固定のラベルと相関 ID だけ
async function resultPage(
  env: Env,
  name: string,
  status: number,
  slots: { MISSING: string; REQUEST_ID: string },
): Promise<Response> {
  const asset = await env.ASSETS.fetch(new Request(ORIGIN + '/contact/' + name + '/'));
  const body = (await asset.text()).replaceAll('%MISSING%', slots.MISSING).replaceAll('%REQUEST_ID%', slots.REQUEST_ID);
  // CSP などはアセットから引き継ぎ、置換で長さが変わる Content-Length とアセットのキャッシュ状態を示す cf-cache-status を落とす
  const headers = new Headers(asset.headers);
  headers.delete('content-length');
  headers.delete('cf-cache-status');
  return new Response(body, { status, headers });
}
