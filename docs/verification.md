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

## 6. お知らせの投稿(microCMS)

### 6.1 方式

`npm run build` は `node scripts/fetch-news.mjs && astro build` を実行する。
ビルド前スクリプト `scripts/fetch-news.mjs` が、microCMS の API `news` からお知らせを取得する。
取得は `orders=-publishedAt&limit=10` で、`publishedAt` の降順に 10 件である。取得する項目は `id`・`title`・`body`・`publishedAt` である。
本文は sanitize-html で許可リスト方式にサニタイズする。許可リストに無いタグと属性は除き、`h1`〜`h3` は `h4` に置き換える。
本文の画像のうち、`https://images.microcms-assets.io/` のものはビルド時に取得する。
取得した画像は `public/news/images/<URL の sha256 の先頭 16 桁>.<拡張子>` に保存し、`src` をサイト内のパスに書き換える。
そのため画像は microCMS でなく Cloudflare から配信される。
それ以外のホストの画像は本文から除く。
取得結果は `src/data/news.json` に書き、トップページ(`src/pages/index.astro`)はそれを読む。

認証情報の有無と取得の成否で、ビルドの挙動は次のとおり分かれる。

| 条件 | 挙動 |
| :-- | :-- |
| 認証情報(`MICROCMS_SERVICE_DOMAIN`・`MICROCMS_API_KEY`)が無く、`WORKERS_CI` も無い(ローカル・GitHub Actions) | 警告を出して取得を省き、リポジトリにあるスナップショットの `src/data/news.json` でビルドする |
| `WORKERS_CI` があり、認証情報が無い | `missing_credentials` を出力して終了コード 1 で終わり、ビルドが失敗する。前回の配信が続く |
| 取得に失敗した | 失敗の種類を出力して終了コード 1 で終わり、ビルドが失敗する。前回の配信が続く |

再ビルドは、Cloudflare Workers Builds の Deploy Hook(`main`)で起動する。
Deploy Hook の URL を、microCMS の API `news` の Webhook にカスタム通知として登録する。通知タイミングは公開・公開終了・削除である。

### 6.2 手順

次の手順はユーザーがダッシュボードで行う。

1. Cloudflare の Worker `mosidas-dev` の Settings > Build > Variables and Secrets に、`MICROCMS_SERVICE_DOMAIN`(テキスト)と `MICROCMS_API_KEY`(シークレット)を登録する。API キーは GET 権限だけのものにする。登録は実装のマージ前に行う(6.5 を参照)。
2. 実装の PR #6 をマージする。
3. Settings > Build > Deploy Hooks で、`main` のフックを作る。
4. microCMS の API `news` の API 設定 > Webhook に、カスタム通知として Deploy Hook の URL を登録する。通知タイミングは公開・公開終了・削除にする。
5. microCMS でお知らせを公開し、トップページの一覧に表示されることを `curl` で確かめる。

`MICROCMS_SERVICE_DOMAIN` には microCMS のサービスドメインを入れる。

### 6.3 無料プラン(Hobby)での Webhook

microCMS の Hobby プランで、Deploy Hook の URL をカスタム通知の Webhook として登録できた。
公開の操作で Deploy Hook が起動したことを、Cloudflare のダッシュボードで確認した。
代替の手段は不要だった。

出典:

- [Webhook 設定 · microCMS ドキュメント](https://document.microcms.io/manual/webhook-setting)
- [Deploy Hooks · Cloudflare Workers docs](https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/)

### 6.4 「公開」から掲載までの時間

| 計測日 | 操作 | 公開の時刻 | 掲載を確認した時刻 | 所要時間 |
| :-- | :-- | :-- | :-- | :-- |
| 2026-10-12 | お知らせ「test」の題名を「test2」に変えて公開 | 09:30:25 UTC(`revisedAt` 09:30:25.299Z) | 09:31:26 UTC(`curl`、10 秒間隔の監視) | 51〜61 秒 |

新規作成でなく既存の記事を編集して公開したため、公開の時刻には API の `publishedAt`(06:47:56 UTC)でなく `revisedAt` を使った。
監視は 10 秒間隔で `curl` を実行し、`<h3>` が test2 になった最初の時刻を取った。そのため所要時間は幅で示す。
09:33:51 UTC に `curl https://mosidas.dev/` を実行し、次のことを確かめた。

- 一覧の先頭が「test2」で、`<time>` が 2026年10月12日である。
- 本文の画像が `/news/images/880af8b6c3282a3d.jpg` である。
- この画像に `curl -I` を実行すると、200 と `content-type: image/jpeg` が返る。画像がサイトのドメインから配信されている。

### 6.5 注意点

- PR #6 のマージ直後の `main` のビルド(09:18:38〜09:19:57 UTC)は、ビルド変数が未登録だったため `missing_credentials` で失敗し、前回の配信が続いた。ビルド変数を登録して Retry build を実行し、09:28:44 UTC までにお知らせの一覧が配信された。ビルド変数は実装のマージ前に登録する。
- 確認した端末では DNS の負のキャッシュが残っていたため、5.3 と同じく `curl` に `--resolve mosidas.dev:443:<dig +short mosidas.dev A の値>` を付けて実行した。
- Workers Builds の非 production ブランチ(PR のブランチ)のチェックは、PR #2・#3・#6 で失敗している。原因はダッシュボードのビルドログで確認しておらず、継続課題である。

## 7. 問い合わせフォーム(メール送信とレート制限)

### 7.1 方式

問い合わせ API は、`src/worker.ts` の `POST /api/contact` である。
処理は次の順に行う。

1. POST 以外の要求を 405 で拒否する。
2. Origin を検査し、不一致を 403 で拒否する。
3. 設定に不備があれば 503 を返す。
4. レート制限を超えた要求を 429 で拒否する。
5. 本文の形式を検査し、400 または 413 を返す。
6. 項目を検証し、不備を 400 で拒否する。
7. Turnstile のトークンが無ければ 403 で拒否する。
8. siteverify の結果に応じて 403 または 503 を返す。
9. メールを送信し、303 で `/contact/sent/` へ移す。

失敗したときは、静的な結果ページ(`/contact/{invalid,rejected,limited,failed}/`)に状態コードを付けて返す。

メール送信には、Cloudflare Email Routing の `send_email` バインディングを使う。設定は `wrangler.jsonc` の `send_email: [{ name: "EMAIL" }]` である。
送信先は、Email Routing で検証済みの宛先(Destination addresses)に限られる。
検証済みの宛先への送信は、全プランで無料である。
送信元は自ドメインのアドレス(`contact@mosidas.dev`)に限る。
Reply-To には、送信者が入力したアドレスを入れる。
Email Routing を有効にすると、MX と SPF の DNS レコードがゾーンに自動で追加される。

Resend は外部のアカウントが増えるため見送った。
MailChannels は Workers 向けの無料提供が終わったため見送った。

ボット対策には Turnstile を使う。Widget mode は Managed である。
サイトキーはビルド変数 `PUBLIC_TURNSTILE_SITE_KEY`、シークレットキーは Worker のシークレット `TURNSTILE_SECRET_KEY` に登録する。

レート制限は、IP ごとの Durable Object で数える(本 PR、コミット `e9ef8e6`)。
Durable Object は SQLite バックエンドで、Free プランで利用できる。
同一 IP からの受付は 60 秒に 3 回までとし、4 回目以降は 429 と `limited` の結果ページを返す。
Durable Object の呼び出しが失敗したときは、503 で拒否する(fail closed)。
この方式にした経緯は 7.4 に書く。

問い合わせの内容は Cloudflare 側に保存しない。
Durable Object には受付の時刻だけを保存する。保存した時刻は、最後の受付から 60 秒後の alarm で削除する。

### 7.2 手順

次の手順はユーザーがダッシュボードで行う。

1. Turnstile でウィジェットを作る。Hostname は `mosidas.dev`、Widget mode は Managed にする。
2. ゾーン `mosidas.dev` の Email Routing を有効にする。MX と SPF のレコードは自動で追加される。Destination addresses に本人のアドレスを追加し、届いたメールのリンクで検証する。
3. Worker `mosidas-dev` の Settings > Variables and Secrets に、シークレット `TURNSTILE_SECRET_KEY`(1. のシークレットキー)と `CONTACT_TO`(2. で検証した宛先)を登録する。
4. Settings > Build > Variables and secrets に、ビルド変数 `PUBLIC_TURNSTILE_SITE_KEY`(1. のサイトキー)を登録する。未登録だと `main` のビルドが「PUBLIC_TURNSTILE_SITE_KEY が未設定」で失敗し、前回の配信が続く。
5. PR #7(docs: microCMS からのお知らせ掲載の手順と所要時間を記録する)をマージし、次に PR #8(feat: 問い合わせフォームを公開する)をマージする。
6. `https://mosidas.dev/contact/` をブラウザーで開く。Turnstile のウィジェットが表示され、コンソールに CSP 違反が出ないことを確かめる。
7. フォームから送信する。送信完了の画面が表示され、本人宛のメールが届くことを確かめる。

### 7.3 配信と動作の確認

PR #8 のマージから配信までの経過は次のとおりである。

| 時刻(UTC) | 出来事 |
| :-- | :-- |
| 10:14:23 | PR #8 をマージした(マージコミット `16bb1c6`) |
| 10:14:26〜10:15:21 | マージ直後のビルドが成功し、続く `npx wrangler deploy` が Cloudflare API の 504 Gateway Timeout で失敗した |
| 10:17:51 | ユーザーが Retry build を実行し、デプロイが成功した |
| 10:17:55 | `/contact/` が Turnstile 付きで配信された |

504 は Cloudflare 側の一時障害である。
Free プランで、Rate Limiting バインディングと `send_email` を含むデプロイは通った。両バインディングは `npx wrangler versions view` で確認した。

ユーザーが実ブラウザーからフォームで送信し、次のことを確かめた。

| 確認項目 | 結果 |
| :-- | :-- |
| 送信完了の画面 | 表示された |
| メールの到着 | 本人宛(Email Routing で検証済みの宛先)に 10:23 UTC に届いた |
| 送信元 | `contact@mosidas.dev` |
| 件名 | mosidas.dev への問い合わせ |
| Reply-To | 送信者が入力したアドレス |

送信から到着までは 1 分以内である。送信の時刻は計測していない。

拒否の経路は、`curl` で次のとおり確かめた。

| 要求 | 状態コード |
| :-- | :-- |
| Turnstile のトークンが無い POST | 403(ログの outcome は `turnstile_missing`) |
| Origin が無い POST | 403 |
| GET | 405 |
| 必須項目が空の POST | 400 |

### 7.4 レート制限

PR #8 の時点では、Rate Limiting バインディング(`ratelimits`)でレート制限を設けた。設定は 60 秒に 3 回まで、キーは `cf-connecting-ip` である。
その後、ゾーンの WAF レート制限ルールも試した。
どちらも 429 を一度も返さなかった。

| 方式 | 試験の時刻(UTC) | 送った要求 | 結果 |
| :-- | :-- | :-- | :-- |
| Rate Limiting バインディング | 10:21:09〜10:22:13 | 同一 IP から 2 秒間隔で 30 回 | 429 は 0 回 |
| Rate Limiting バインディング | 記録なし | 同一 IP から間隔なしで 20 回連続 | 429 は 0 回 |
| WAF レート制限ルール | 10:32〜10:35 | 60 回以上 | 429 は 0 回 |

公式文書は、Rate Limiting バインディングを次のように説明している。

> permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system

出典: [Rate Limiting · Cloudflare Workers docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

WAF レート制限ルールは、ユーザーが 10:32:13 UTC に作成した。
Free プランで作れる 1 件を使い、パスは `/api/contact`、IP ごとに 10 秒に 3 回まで、超えたら Block とした。
ルールの Analytics では 149 件が一致したが、遮断は 0 件だった。
Free プランでは数え方(cached assets への適用)を変更できない。
そのため、Worker が応答する要求はルールに数えられないと推定する。
WAF ルールは削除せずに残してある。

対策として、Durable Objects で IP ごとに数える方式に置き換えた(7.1)。
本番での計測は、マージ後に行う。計測では、同一 IP からの 60 秒以内の 4 回目の POST が 429 になることを確かめる。結果の表は後続の PR で足す。

推進室の資料(homepage-replace)は「レート制限を設ける」と書いている。
この要求は、Cloudflare の Rate Limiting バインディングと WAF ルールでは、Free プランで実現できなかった。
資料の記述に、Durable Objects による自前の計数が必要である旨を補う必要がある。

### 7.5 注意点

- デプロイの 504 は Cloudflare 側の一時障害で、Retry build で回復した。
- Workers Builds の非 production ブランチのチェックの失敗(6.5)は、PR #7・#8 でも続いている。
- 確認した端末では DNS の負のキャッシュが残っていたため、5.3・6.5 と同じく `curl` に `--resolve` を付けて実行した。

出典:

- [Rate Limiting · Cloudflare Workers docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Send emails from Workers · Cloudflare Email Routing docs](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/)
- [Pricing · Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Turnstile · Cloudflare docs](https://developers.cloudflare.com/turnstile/)
