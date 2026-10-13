// ビルドの前段のスクリプトが共有する構造化ログ。1 イベントを JSON 1 行で出す。

/** @param {Record<string, unknown>} fields */
export const log = (fields) => (fields.level === 'info' ? console.log : console.error)(JSON.stringify(fields));

/**
 * 取得の失敗を error ログ 1 行に出す。err が type と transient を持てばそれを分類に使い、
 * 持たなければ例外の名前で分類する(TypeError・TimeoutError はネットワークの一時的な失敗とみなす)。
 * @param {string} msg
 * @param {unknown} err
 */
export function logError(msg, err) {
  const e = /** @type {{ type?: unknown, transient?: unknown, target?: unknown, url?: unknown, cause?: { code?: unknown } }} */ (
    err instanceof Error ? err : {}
  );
  const classified = typeof e.type === 'string' && typeof e.transient === 'boolean';
  const type = classified ? e.type : err instanceof Error ? err.name : 'unknown';
  const transient = classified ? e.transient : type === 'TypeError' || type === 'TimeoutError';
  const cause = e.cause?.code;
  log({
    level: 'error',
    msg,
    'error.type': type,
    'app.error.origin': 'system',
    'app.error.transient': transient,
    ...(typeof e.target === 'string' && { 'app.fetch.target': e.target }),
    ...(typeof e.url === 'string' && { 'url.full': e.url }),
    ...(typeof cause === 'string' && { 'app.error.cause': cause }),
  });
}
