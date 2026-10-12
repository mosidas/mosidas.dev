# 検証の記録

## 1. 基盤の決定と理由

ビルドと配信の基盤には Workers Static Assets を採用した。
理由は次の 3 つである。

- 将来追加する Cron Triggers と問い合わせ API は Workers の機能である。同じ Worker に `main`(Worker のコード)と `triggers.crons` を追加すれば載るので、基盤を移行せずに済む。Worker のコードには、Cron Triggers 用の `scheduled` ハンドラーと、問い合わせ API 用の `fetch` ハンドラーを書く。
- Cloudflare は新規プロジェクトに Workers を推奨している。
- 静的アセットの配信は、既定では Worker の呼び出しにならず、無料プランの上限を消費しない。ただし本サイトは 5. の転送のため `run_worker_first` を有効にしており、静的アセットの要求も Worker のリクエスト数(無料プランは 1 日 10 万件)に数えられる。

Cloudflare Pages は見送った。
Pages Functions では Cron Triggers を持てず、定期実行には別の Worker が必要になるためである。
推進室の資料(homepage-replace)は「Cloudflare Pages のビルドで実行」と書いているので、資料の記述を Workers に改める必要がある。

出典:

- [Static Assets · Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/)
- [Migrate from Pages to Workers · Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)

## 2. Git 連携の手順

次の手順はユーザーが Cloudflare のダッシュボードで行う。

1. Cloudflare ダッシュボードで Workers & Pages → Create application → Import a repository → Get started を選択する。
2. Cloudflare の GitHub App を、リポジトリ mosidas/mosidas.dev に限定してインストールする。
3. Worker 名は、`wrangler.jsonc` の `name` と同じ `mosidas-dev` にする。
4. Build command に `npm run build`、Deploy command に `npx wrangler deploy` を指定する。
5. 監視するブランチは既定で `main` である。違う場合は Settings > Build の Git branch で直す。
6. ビルドやデプロイが失敗したときは、ダッシュボードのビルドログと、GitHub のコミットに付くチェックを確認する。

## 3. 配信の確認

1. `https://mosidas-dev.<subdomain>.workers.dev/` を HTTPS で開き、制作物が 6 件表示されることを確かめる。
2. `curl -sI <URL>` を実行し、`public/_headers` で指定した 3 つのヘッダー(`Content-Security-Policy`・`X-Content-Type-Options`・`Referrer-Policy`)が応答に含まれることを確かめる。

`<subdomain>` には、Cloudflare のアカウントに割り当てられた workers.dev のサブドメインが入る。

## 4. push から配信までの時間

所要時間は、ページに入れた変更が `curl` の応答に現れるまでの時間と定義する。
起点は `main` への push の時刻とし、取れなければビルドの開始時刻とする。

| 計測日 | push したコミット | push の時刻(またはビルド開始時刻) | 配信の更新を確認した時刻 | 所要時間 |
| :-- | :-- | :-- | :-- | :-- |
| 2026-10-12 | `50b6aa7` | 07:18:17 UTC(マージ) | 07:21:16 UTC(`curl`) | 43 秒〜2 分 59 秒 |

PR #1 のマージ時刻(`gh pr view 1 --json mergedAt`)を push の時刻とした。
デプロイ完了は 07:19:00 UTC(`npx wrangler deployments list` の Created)で、push の 43 秒後である。
マージに含めた変更(`aria-label="使用技術"`)が `curl` の応答に現れることを確認したのは 2 分 59 秒後である。その間は `curl` を実行していないため、所要時間は幅で示す。
Workers Builds のビルド開始時刻は取得できなかった。ビルド履歴の API が wrangler の OAuth トークンでは認証エラー(code 10000)になるためである。
そのため起点は push の時刻とした。ビルド開始時刻は、ダッシュボードのビルド履歴で確認できる。

## 5. 独自ドメインでの配信

### 5.1 方式

Cloudflare Registrar で mosidas.dev を取得した。
ゾーンは 2026-10-12 06:36:53 UTC に作成され、Free プランで、DNS レコードは無かった。
このゾーンに、Worker のカスタムドメインを設定した。設定は `wrangler.jsonc` の `routes: [{ pattern: "mosidas.dev", custom_domain: true }]` である。
DNS レコードと証明書は Cloudflare が自動で作る。
http と workers.dev からの要求は、`src/worker.ts` の `fetch` ハンドラーが `https://mosidas.dev` へ 301 で転送する。パスとクエリは保持する。
それ以外の要求には、`env.ASSETS.fetch` で静的アセットを返す。
workers.dev の要求もアセットより先に Worker を通すため、`run_worker_first: true` にした。

### 5.2 手順

1. Cloudflare Registrar でドメインを取得する。ゾーンは自動で作成され、NS は Cloudflare になる。
2. `wrangler.jsonc` に `routes` の `custom_domain` と、`main`・`assets.binding`・`run_worker_first` を設定する。`src/worker.ts` に転送を書く(PR #4)。
3. `main` へマージすると、Workers Builds がデプロイする。カスタムドメインの DNS レコードと証明書は自動で作成される。ローカルからの `npx wrangler deploy` は不要だった。
4. `curl -I https://mosidas.dev/` が 200 を返すことを確かめる。
5. `curl -I http://mosidas.dev/` と `curl -I https://mosidas-dev.<subdomain>.workers.dev/` が 301(`Location: https://mosidas.dev/`)を返すことを確かめる。

`<subdomain>` は 3. と同じである。

### 5.3 所要時間

| 計測日 | 起点 | 起点の時刻 | 200 を確認した時刻 | 所要時間 |
| :-- | :-- | :-- | :-- | :-- |
| 2026-10-12 | ゾーンの作成(ドメイン取得) | 06:36:53 UTC | 08:22 UTC | 1 時間 45 分 |
| 2026-10-12 | PR #4 のマージ | 07:49:17 UTC | 08:22 UTC | 8 分 43 秒〜32 分 43 秒 |

ゾーンの作成を起点とした所要時間には、実装と PR の作業時間を含む。
PR #4 のマージ時刻は `gh pr view 4 --json mergedAt` で取得した。
Workers Builds のデプロイ完了は 07:49:53 UTC である(`npx wrangler deployments list` の Created)。
07:49〜07:58 UTC は、`mosidas.dev` の DNS が未解決で `curl` に応答が無かった。
07:58 UTC に、workers.dev が `https://mosidas.dev/` へ 301 を返した。
08:22 UTC に、`curl -I https://mosidas.dev/` が 200 を返した。`public/_headers` の 3 つのヘッダーも応答に含まれていた。
07:58〜08:22 UTC の間は `curl` を実行していないため、所要時間は幅で示す。
下限は、workers.dev の 301 を確認した 07:58 UTC までの時間である。この時点では `https://mosidas.dev/` を確かめていない。
確認した端末では DNS の負のキャッシュが残っていたため、`--resolve mosidas.dev:443:172.67.212.123` を付けて実行した。
`dig +short mosidas.dev A` は 104.21.16.123 と 172.67.212.123 を返す。
08:22 UTC の 200 は `--resolve` で名前解決を迂回した結果であり、利用者の端末で名前解決できるまでの時間は別である。

### 5.4 注意点

- `run_worker_first` によるリクエスト数の消費は、1. の 3 つ目の箇条を参照する。
- Workers Builds のデプロイトークンで、カスタムドメインの作成までできた。
