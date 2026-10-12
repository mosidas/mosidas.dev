// ビルドの前に microCMS からお知らせと本文中の画像を取得し、src/data/news.json と public/news/images/ に書く。
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import sanitizeHtml from 'sanitize-html';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_HOST = 'images.microcms-assets.io';
const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};
const TIMEOUT_MS = 30_000;

class FetchNewsError extends Error {
  /**
   * @param {string} type @param {boolean} transient
   * @param {'api' | 'image'} [target] 失敗した取得先
   * @param {string} [url] 画像の URL(公開アセットなのでログに載せてよい。API の URL は渡さない)
   */
  constructor(type, transient, target, url) {
    super(type);
    this.type = type;
    this.transient = transient;
    this.target = target;
    this.url = url;
  }
}

/** @param {Response} res @param {'api' | 'image'} target @param {string} [url] */
function assertOk(res, target, url) {
  if (!res.ok) {
    throw new FetchNewsError(`http_status_${res.status}`, res.status >= 500 || res.status === 429, target, url);
  }
}

const invalid = () => new FetchNewsError('invalid_response', false);

/** @param {unknown} item */
function validateItem(item) {
  if (typeof item !== 'object' || item === null) throw invalid();
  const { id, title, body, publishedAt } = /** @type {Record<string, unknown>} */ (item);
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw invalid();
  if (typeof title !== 'string' || title.length < 1 || title.length > 200) throw invalid();
  if (typeof publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(publishedAt) || Number.isNaN(Date.parse(publishedAt))) {
    throw invalid();
  }
  if (body !== undefined && typeof body !== 'string') throw invalid();
  return { id, title, body: body ?? '', publishedAt };
}

/**
 * 採用できる画像の URL なら [URL, 拡張子] を返す。
 * @param {string | undefined} src
 */
function acceptImage(src) {
  let url;
  try {
    url = new URL(src ?? '');
  } catch {
    return null;
  }
  const ext = url.pathname.match(/\.([A-Za-z]+)$/)?.[1].toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.hostname !== IMAGE_HOST ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    !ext ||
    !Object.hasOwn(MIME_BY_EXT, ext)
  ) {
    return null;
  }
  return { href: url.href, ext };
}

/**
 * 本文を許可リストで絞り、採用した画像の URL を downloads(URL → ファイル名)に記録する。
 * @param {string} html
 * @param {Map<string, string>} downloads
 */
function sanitizeBody(html, downloads) {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote', 'h4', 'h5', 'ul', 'ol', 'li',
      'a', 'img', 'figure', 'figcaption', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      a: ['href'],
      img: ['src', 'alt', 'width', 'height'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: [],
    allowedSchemesByTag: { a: ['https', 'http', 'mailto'], img: ['https'] },
    transformTags: {
      h1: sanitizeHtml.simpleTransform('h4', {}),
      h2: sanitizeHtml.simpleTransform('h4', {}),
      h3: sanitizeHtml.simpleTransform('h4', {}),
      img: (tagName, attribs) => {
        const { src, ...rest } = attribs;
        const image = acceptImage(src);
        if (!image) return { tagName, attribs: rest };
        const name = `${createHash('sha256').update(image.href).digest('hex').slice(0, 16)}.${image.ext}`;
        downloads.set(image.href, name);
        return { tagName, attribs: { ...rest, src: `/news/images/${name}` } };
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  });
}

/** @param {string} href @param {string} name */
async function downloadImage(href, name) {
  const res = await fetch(href, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  assertOk(res, 'image', href);
  const ext = /** @type {keyof typeof MIME_BY_EXT} */ (name.slice(name.lastIndexOf('.') + 1));
  const type = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== MIME_BY_EXT[ext] || Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES || !res.body) {
    throw new FetchNewsError('image_rejected', false, 'image', href);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    if (size > MAX_IMAGE_BYTES) throw new FetchNewsError('image_rejected', false, 'image', href);
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * お知らせと本文中の画像をメモリに取得する。ファイルには書かない。
 * @param {string} serviceDomain
 * @param {string} apiKey
 */
export async function fetchNews(serviceDomain, apiKey) {
  const res = await fetch(
    `https://${serviceDomain}.microcms.io/api/v1/news?orders=-publishedAt&limit=10&fields=id,title,body,publishedAt`,
    { headers: { 'X-MICROCMS-API-KEY': apiKey }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  assertOk(res, 'api');
  let data;
  try {
    data = await res.json();
  } catch {
    throw invalid();
  }
  if (typeof data !== 'object' || data === null || !Array.isArray(data.contents)) throw invalid();

  /** @type {Map<string, string>} */
  const downloads = new Map();
  const news = data.contents
    .map(validateItem)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .map((item) => ({ ...item, body: sanitizeBody(item.body, downloads) }));

  /** @type {Map<string, Uint8Array>} */
  const images = new Map();
  for (const [href, name] of downloads) {
    images.set(name, await downloadImage(href, name));
  }
  return { news, images };
}

/** @param {Record<string, unknown>} fields */
const log = (fields) => (fields.level === 'info' ? console.log : console.error)(JSON.stringify(fields));

/** @param {unknown} err */
function logError(err) {
  const type = err instanceof FetchNewsError ? err.type : err instanceof Error ? err.name : 'unknown';
  const transient = err instanceof FetchNewsError ? err.transient : type === 'TypeError' || type === 'TimeoutError';
  const cause = err instanceof Error && /** @type {{ code?: unknown } | undefined} */ (err.cause)?.code;
  log({
    level: 'error',
    msg: 'お知らせの取得に失敗した',
    'error.type': type,
    'app.error.origin': 'system',
    'app.error.transient': transient,
    ...(err instanceof FetchNewsError && err.target && { 'app.fetch.target': err.target }),
    ...(err instanceof FetchNewsError && err.url && { 'url.full': err.url }),
    ...(typeof cause === 'string' && { 'app.error.cause': cause }),
  });
}

async function main() {
  const start = performance.now();
  const domain = process.env.MICROCMS_SERVICE_DOMAIN ?? '';
  const apiKey = process.env.MICROCMS_API_KEY ?? '';
  if (!domain || !apiKey) {
    if (!process.env.WORKERS_CI) {
      log({ level: 'warn', msg: '認証情報が無いため、お知らせの取得を省き、スナップショットを使う' });
      return;
    }
    throw new FetchNewsError('missing_credentials', false);
  }
  if (!/^[a-z0-9-]{1,63}$/.test(domain)) throw new FetchNewsError('invalid_service_domain', false);

  const { news, images } = await fetchNews(domain, apiKey);
  const imageDir = new URL('../public/news/images/', import.meta.url);
  await rm(imageDir, { recursive: true, force: true });
  await mkdir(imageDir, { recursive: true });
  for (const [name, bytes] of images) {
    await writeFile(new URL(name, imageDir), bytes);
  }
  await writeFile(new URL('../src/data/news.json', import.meta.url), JSON.stringify(news, null, 2) + '\n');
  log({
    level: 'info',
    msg: 'お知らせを取得した',
    'news.count': news.length,
    'news.image_count': images.size,
    duration_ms: Math.round(performance.now() - start),
  });
}

if (import.meta.main) {
  main().catch((err) => {
    logError(err);
    process.exitCode = 1;
  });
}
