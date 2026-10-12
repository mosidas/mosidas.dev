// shortcut: 転送のログ・メトリクスなし, R7(アクセス解析)で計装する
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const ORIGIN = 'https://mosidas.dev';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || url.hostname !== 'mosidas.dev') {
      // new URL(path, ORIGIN) は //evil.example を別ホストに解決するため、文字列連結で組み立てる
      return Response.redirect(ORIGIN + url.pathname + url.search, 301);
    }
    return env.ASSETS.fetch(request);
  },
};
