# 検証の記録

## 1. 基盤の決定と理由

ビルドと配信の基盤には Workers Static Assets を採用した。
理由は次の 3 つである。

- 将来追加する Cron Triggers と問い合わせ API は Workers の機能である。同じ Worker に `main`(Worker のコード)と `triggers.crons` を追加すれば載るので、基盤を移行せずに済む。Worker のコードには、Cron Triggers 用の `scheduled` ハンドラーと、問い合わせ API 用の `fetch` ハンドラーを書く。
- Cloudflare は新規プロジェクトに Workers を推奨している。
- 静的アセットの配信は Worker の呼び出しにならず、無料プランの上限を消費しない。

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
