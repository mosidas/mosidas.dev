// ビルドの前に Zenn のフィードから記事の一覧を取得し、src/data/zenn.json に書く。
// 取得に失敗したら zenn.json を書き換えずに終了コード 0 で終え、前回の一覧でビルドを続ける。
import { writeFile } from 'node:fs/promises';
import { log, logError } from './log.mjs';

const DEFAULT_FEED_URL = 'https://zenn.dev/mosida/feed';
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 1024 * 1024;
const MAX_ITEMS = 10;

class FetchZennError extends Error {
  /** @param {string} type @param {boolean} transient */
  constructor(type, transient) {
    super(type);
    this.type = type;
    this.transient = transient;
  }
}

const invalid = () => new FetchZennError('invalid_response', false);

/** @type {Record<string, string>} */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML の実体参照を 1 回の走査で復元する(&amp;lt; を < にしないため)。 @param {string} s */
const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, ref) => {
    if (ref[0] !== '#') return ENTITIES[ref] ?? whole;
    const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

/**
 * RSS 2.0 を解析し、item ごとの title・link・pubDate の文字列を返す。
 * @param {string} xml
 */
function parseRss(xml) {
  // CDATA を先にプレースホルダーへ置き換え、CDATA 内の </item> などをタグとして読まないようにする
  if (xml.includes('\u0000')) throw invalid();
  /** @type {string[]} */
  const cdata = [];
  const body = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text) => `\u0000${cdata.push(text) - 1}\u0000`);
  if (!/<rss[\s>]/.test(body) || !/<channel[\s>]/.test(body)) throw invalid();

  /** @param {string} item @param {string} tag */
  const field = (item, tag) => {
    const raw = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))?.[1];
    if (raw === undefined) throw invalid();
    return raw
      .split(/\u0000(\d+)\u0000/)
      .map((part, i) => (i % 2 ? cdata[Number(part)] : decodeEntities(part)))
      .join('')
      .trim();
  };
  return [...body.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)].map(([, item]) => ({
    title: field(item, 'title'),
    link: field(item, 'link'),
    pubDate: field(item, 'pubDate'),
  }));
}

/** 記事の URL を許可リストで検証し、正規化した URL を返す。 @param {string} link */
function validateLink(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    throw invalid();
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'zenn.dev' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    !/^\/[A-Za-z0-9_-]{1,100}\/articles\/[A-Za-z0-9_-]{1,100}$/.test(url.pathname)
  ) {
    throw invalid();
  }
  return url.href;
}

/** @param {{ title: string, link: string, pubDate: string }} item */
function validateItem({ title, link, pubDate }) {
  if (title.length < 1 || title.length > 200) throw invalid();
  const time = Date.parse(pubDate);
  if (Number.isNaN(time)) throw invalid();
  return { title, url: validateLink(link), date: new Date(time).toISOString() };
}

/** @param {Response} res */
async function readText(res) {
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES || !res.body) {
    throw new FetchZennError('response_too_large', false);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new FetchZennError('response_too_large', false);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Zenn のフィードから記事の一覧を取得し、新しい順に最大 10 件を返す。ファイルには書かない。
 * item が 1 件でも検証に失敗したら、一覧全体を失敗として扱う(一部だけ欠けた一覧で前回の一覧を上書きしないため)。
 * @param {string} feedUrl
 */
export async function fetchZenn(feedUrl) {
  let url;
  try {
    url = new URL(feedUrl);
  } catch {
    throw new FetchZennError('invalid_feed_url', false);
  }
  if (url.protocol !== 'https:') throw new FetchZennError('invalid_feed_url', false);

  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status !== 200) {
    throw new FetchZennError(`http_status_${res.status}`, res.status >= 500 || res.status === 429);
  }
  return parseRss(await readText(res))
    .map(validateItem)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, MAX_ITEMS);
}

async function main() {
  const start = performance.now();
  let articles;
  try {
    articles = await fetchZenn(process.env.ZENN_FEED_URL || DEFAULT_FEED_URL);
  } catch (err) {
    logError('Zenn の記事の取得に失敗した', err);
    return;
  }
  await writeFile(new URL('../src/data/zenn.json', import.meta.url), JSON.stringify(articles, null, 2) + '\n');
  log({
    level: 'info',
    msg: 'Zenn の記事を取得した',
    'zenn.article_count': articles.length,
    duration_ms: Math.round(performance.now() - start),
  });
}

if (import.meta.main) {
  main().catch((err) => {
    logError('Zenn の記事の一覧の書き込みに失敗した', err);
    process.exitCode = 1;
  });
}
