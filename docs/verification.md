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

`npm run build` は `node scripts/build.mjs` を実行し、最初に `scripts/fetch-news.mjs` を呼ぶ(8.1 を参照)。
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
9. メールを送信する。送信に失敗したら 502 を返す。成功したら 303 で `/contact/sent/` へ移す。

405 を除き、失敗したときは、静的な結果ページ(`/contact/{invalid,rejected,limited,failed}/`)に状態コードを付けて返す。
405 は本文の無い応答である。

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

レート制限は、IP ごとの Durable Object で数える(PR #9、コミット `e9ef8e6`)。
Durable Object は SQLite バックエンドで、Free プランで利用できる。
同一 IP からの受付は 60 秒に 3 回までとし、4 回目以降は 429 と `limited` の結果ページを返す。
Durable Object の呼び出しが失敗したときは、503 で拒否する(fail closed)。
この方式にした経緯は 7.4 に書く。

問い合わせの内容は Cloudflare 側に保存しない。
Durable Object には受付の時刻だけを保存する。
受付のたびに、最後の受付の 60 秒後に alarm を張る。
alarm は、60 秒の窓より古い時刻だけを捨てる。
残りがあれば最古の時刻の 60 秒後に alarm を張り直し、残りが無ければ保存した時刻を削除する(コミット `d849147`)。

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

ユーザーの申告では、送信から到着までは 1 分以内である。送信の時刻は計測していない。

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
次の試験では、どちらも 429 を一度も返さなかった。

| 方式 | 試験の時刻(UTC) | 送った要求 | 結果 |
| :-- | :-- | :-- | :-- |
| Rate Limiting バインディング | 10:21:09〜10:22:13 | 同一端末から(要求ごとに curl を起動)2 秒間隔で 30 回 | 429 は 0 回 |
| Rate Limiting バインディング | 記録なし | 同一端末から(要求ごとに curl を起動)間隔なしで 20 回連続 | 429 は 0 回 |
| WAF レート制限ルール | 10:32〜10:35 | 60 回以上 | 429 は 0 回 |

WAF レート制限ルールは、ユーザーが 10:32:13 UTC に作成した。
Free プランで作れる 1 件を使い、パスは `/api/contact`、IP ごとに 10 秒に 3 回まで、超えたら Block とした。
ルールの Analytics では、149 件の要求がルールに一致した。遮断は 0 件だった。

429 が出なかったのは、試験方法の欠陥による。
確認した端末は、TCP 接続ごとに接続元 IP が変わる。
`/cdn-cgi/trace` を 5 回取得すると、接続元 IP は 5 回とも異なった。

- 203.25.124.15
- 203.25.124.21
- 203.25.124.81
- 203.25.124.86
- 212.32.76.20

上の試験は `curl` を要求ごとに起動したため、要求は毎回別の IP として数えられた。
したがって、要求ごとに接続する試験では、IP 単位の制限はどれも発動しなかった。
Rate Limiting バインディングと WAF ルールのどちらも同じである。

対策として、Durable Objects で IP ごとに数える方式に置き換えた(7.1)。
PR #9 は 11:02:03 UTC にマージした(マージコミット `3737313`)。
Workers Builds は 11:03:21 UTC に成功した。
migrations v1(ContactRateLimiter、SQLite)は、エラーなく適用された。
デプロイ後に要求ごとに `curl` を起動して送ると、Workers Logs の tail では要求ごとに別の durableObjectId が呼ばれ、429 は出なかった(時刻は記録していない)。
Durable Objects も、要求ごとに接続する試験では発動しない。

デプロイ後、本番で同一の TCP 接続から POST /api/contact を送り、次の結果を得た。

| 時刻(UTC) | 送った要求 | 結果 | 429 の本文 |
| :-- | :-- | :-- | :-- |
| 11:08:11 | 同一接続(keep-alive)から 6 回 | 403 403 403 429 429 429 | 「error code: 1015」 |
| 11:08:49〜11:09:00 | 同一接続から 5 回 | 429 が 5 回 | `limited` ページ |
| 11:12:44〜11:13:00 | 単一接続から 4 秒間隔で 5 回(項目は空) | 400 400 400 429 429 | `limited` ページ |

11:08:11 の 429 は、ゾーンの WAF レート制限ルール(10 秒に 3 回で Block)による遮断である。
WAF ルールは有効であり、削除せずに残してある。

11:08:49 の計測は、1 回目から 429 になった。
直前の 6 回のうち 3 回を、Durable Object が受付として数えていたためである。
`limited` ページの title は「送信が多すぎる | mosidas」である。

11:12:44 の計測は、curl 8.7.1 の `--rate 15/m` で 4 秒間隔にした。
local port は 58439 で、`num_connects` は 1 回目だけ 1 だった。
429 の cf-ray は `a495ac20cabe8169-NRT` と `a495ac39db1a8169-NRT` である。
4 秒間隔は、WAF ルール(10 秒に 3 回)に掛からない。
したがって、この 429 は Durable Objects によるものである。

429 を返した層は、本文で見分ける。

| 429 の本文 | 遮断した層 |
| :-- | :-- |
| 「error code: 1015」 | ゾーンの WAF レート制限ルール |
| 「送信が多すぎる」の結果ページ(`limited`) | Worker(Durable Objects) |

Rate Limiting バインディングは、同一接続での試験をしていない。
試験の前に、PR #9 で Durable Objects に置き換えたためである。
制限が発動していた可能性はあるが、確かめていない。
公式文書は、Rate Limiting バインディングを次のように説明している。

> permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system

本番のレート制限は、1 つの接続で送って確かめる。
次のコマンドは、同じ URL を 5 回並べ、4 秒間隔で 1 つの接続から送る。
DNS の負のキャッシュがあるときだけ、`--resolve` を付ける。

```sh
curl -s --rate 15/m -H 'Origin: https://mosidas.dev' -H 'Content-Type: application/x-www-form-urlencoded' -d 'name=&email=&message=' -o /dev/null -o /dev/null -o /dev/null -o /dev/null -o /dev/null -w '%{http_code} %{num_connects}\n' https://mosidas.dev/api/contact https://mosidas.dev/api/contact https://mosidas.dev/api/contact https://mosidas.dev/api/contact https://mosidas.dev/api/contact
```

期待する結果は、400 が 3 回、続いて 429 が 2 回である。
`num_connects` は 1 回目だけ 1 になる。

推進室の資料(homepage-replace)は「レート制限を設ける」と書いている。
資料には「問い合わせ API のレート制限は Durable Objects で実装し、ゾーンの WAF レート制限ルールを併用する。Free プランで実現できる」と反映する。

### 7.5 注意点

- レート制限は、Durable Objects(Worker 内で確実に数える)と WAF ルール(ゾーン、Free の 1 件)の 2 層を残す。
  Rate Limiting バインディングには戻さない。
  公式文書が permissive, eventually consistent としているためである。
- デプロイの 504 は Cloudflare 側の一時障害で、Retry build で回復した。
- Workers Builds の非 production ブランチのチェックの失敗(6.5)は、PR #7・#8 でも続いている。
- 確認した端末では DNS の負のキャッシュが残っていたため、5.3・6.5 と同じく `curl` に `--resolve` を付けて実行した。

出典:

- [Rate Limiting · Cloudflare Workers docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Send emails from Workers · Cloudflare Email Routing docs](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/)
- [Pricing · Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Turnstile · Cloudflare docs](https://developers.cloudflare.com/turnstile/)
- [Alarms · Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Rate limiting rules · Cloudflare WAF docs](https://developers.cloudflare.com/waf/rate-limiting-rules/)

## 8. 1 日 1 回のビルドとコンテンツの保存

### 8.1 方式

構成は Cloudflare だけで完結する(コミット `7dbeb0b`・`2fd261b`)。
`wrangler.jsonc` の `triggers.crons` に `0 21 * * *`(UTC 21:00、JST 6:00)を設定した。
Cron Triggers は `src/worker.ts` の `scheduled` を起動する。
`scheduled` は、Worker のシークレット `DEPLOY_HOOK_URL` に POST する。値は Workers Builds の Deploy Hook(`main`)の URL である。
URL が `https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/` で始まらなければ、呼ばずに失敗させる。
一時的な失敗(429・5xx・`fetch` の例外)のときだけ、10 秒の間隔をあけて最大 3 回まで試す(コミット `a219f30`)。
3xx は失敗として扱い、再試行しない。

ビルドコマンド `npm run build` は、`node scripts/build.mjs` を実行する。
`scripts/build.mjs` は、次の順に処理する。

1. `scripts/fetch-news.mjs` でお知らせを取得する。
2. 取得したコンテンツをスナップショットとしてコミットする。
3. `astro build` を実行する。

スナップショットのコミット先は、同じリポジトリの orphan ブランチ `content-snapshot` である。
tree は `src/data/news.json` と `public/news/images/*` だけを持つ。
コミットには GitHub REST API(Git Data)を使う。
tree の sha が前回のコミットと同じなら、コミットしない。

コミット先を `main` にしない理由は 2 つある。

- `main` のルールセットは PR を必須にしており、直接のコミットを拒む。
- 本番のビルド(`WORKERS_CI_BRANCH` が `main`)は、`main` への push と Deploy Hook でだけ走る。`content-snapshot` への push で走るのは非 production のビルドであり、`build.mjs` はスナップショットをコミットしない。そのため、コミットが次のコミットを起動して繰り返すことは構造上起きない。Workers Builds には `[skip ci]` の文書が無い。

コミットと Issue の作成は、`WORKERS_CI` があり、`WORKERS_CI_BRANCH` が `main` のときだけ行う。
トークンはビルドのシークレット `SNAPSHOT_GITHUB_TOKEN` である。
fine-grained PAT で、対象は mosidas/mosidas.dev だけ、権限は Contents と Issues の Read and write、有効期限を設ける。
トークンの値は、PRD・docs・Issue の本文に書かない。

失敗の検知は次のとおりである。

| 失敗 | 検知 |
| :-- | :-- |
| fetch-news の失敗 | `build.mjs` が Issue「ビルドに失敗した(fetch)」を作る |
| スナップショットのコミットの失敗 | ビルドを失敗させて配信しない。`build.mjs` が Issue「ビルドに失敗した(snapshot)」を作る |
| `astro build` の失敗 | `build.mjs` が Issue「ビルドに失敗した(build)」を作る |
| `SNAPSHOT_GITHUB_TOKEN` が未登録 | `missing_credentials` でビルドが失敗する。Issue は作れない |
| clone・`npm ci`・`wrangler deploy` の失敗、時間切れ | 検知しない |
| Cron Triggers から Deploy Hook の呼び出しの失敗 | `scheduled` の error ログと Cron Events に残る。ログには試行回数 `app.build.attempts` が出る |

見送った案と理由は次のとおりである。

| 案 | 見送った理由 |
| :-- | :-- |
| ビルドを GitHub Actions に委ねる | Worker に GitHub のトークンが必要になる。microCMS の API キーの置き場所が 2 か所になる |
| GitHub Actions の schedule で起動する | 起点が Cron Triggers でなくなる |
| `main` に直接コミットする | ルールセットが拒む |
| `[skip ci]` で再ビルドを止める | Workers Builds の文書に根拠が無い |
| ビルド内で `git push` する | トークンがビルド環境に残りやすい |
| 別のリポジトリにコミットする | PAT の対象が広がる |

### 8.2 手順

次の手順はユーザーが行う。

1. GitHub で fine-grained PAT を発行する。Repository access は mosidas/mosidas.dev だけ、Permissions は Contents: Read and write と Issues: Read and write にし、有効期限を設ける。
2. Worker `mosidas-dev` の Settings > Build > Variables and secrets に、シークレット `SNAPSHOT_GITHUB_TOKEN`(1. の PAT)を登録する。登録は PR のマージ前に行う。未登録だと `main` のビルドが `missing_credentials` で失敗し、前回の配信が続く。
3. Settings > Build > Deploy Hooks にある `main` のフック(6.2 で作成済み)の URL を、Settings > Variables and Secrets にシークレット `DEPLOY_HOOK_URL` として登録する。
4. PR をマージする。
5. マージ後のビルドが成功し、`content-snapshot` ブランチが作られたことを確かめる(`gh api repos/mosidas/mosidas.dev/branches/content-snapshot`)。
6. 任意で、`content-snapshot` の削除と非 fast-forward の push を禁じるルールセットを作る。
7. Settings > Build の Builds for Preview branches を None にした。設定しないと、orphan ブランチの `content-snapshot` には `package.json` が無いため、非 production のビルドが毎日失敗して通知が届く。ブランチ名で除外する設定は無かった。PR の検証は GitHub Actions の check で足りる。

### 8.3 計測

時刻はすべて 2026-10-12 UTC である。

| 項目 | 確かめ方 | 結果 |
| :-- | :-- | :-- |
| AC1: Cron Triggers の起動 | Worker の Logs または Metrics の Cron Triggers(Cron Events)に起動が記録される | 21:00:38 に起動したが、`outcome: exception`・`wallTimeMs: 1`・「Deploy Hook の呼び出しに失敗した: TypeError」で失敗した。原因は、Workers の `fetch` が `redirect: 'error'` を受け付けないことである。コミット `a219f30` で `manual` に直した。修正後の起動は、翌日の Cron(2026-10-13 21:00 UTC)で確かめる |
| AC2: コンテンツの保存 | microCMS の変更時刻と、`content-snapshot` のコミット時刻を比べる | PR #11 を 12:12:50 にマージした(マージコミット `f9a4711`)。Workers Builds は 12:14:03 に成功した。`content-snapshot` の最初のコミット `185a17a` は 12:13:23 で、`src/data/news.json` と `public/news/images/880af8b6c3282a3d.jpg` の 2 ファイルを持つ。以後は内容が変わったときだけコミットされる。12:19:19 の再ビルド `3c4ab7eb` では、内容が同じためコミットされなかった |
| AC3: 失敗時の配信の継続 | ビルドのシークレット `MICROCMS_API_KEY` を一時的に誤った値にして Deploy Hook を呼び(`http_status_401`)、サイトが前回の内容で閲覧できることを確かめる。確かめたら `MICROCMS_API_KEY` を元の値に戻す | `MICROCMS_API_KEY` を誤った値にして、12:16:24 に Deploy Hook を POST した(ビルド `e5188e3f`)。ビルドは fetch の段階で `http_status_401` により失敗した。12:17:01 に、サイトは 200 で前回の内容(お知らせ test2)を配信していた。値を戻した 12:19:19 の再ビルドは成功し、新しい Issue は作られなかった |
| AC4: 失敗の通知 | AC3 と同じ操作で Issue が作られることを確かめる。起点はビルドログの error 行の時刻、終点は `gh issue view <番号> --json createdAt` の値である。Issue の error.type は `exit_code_1` で、`http_status_401` は本文の stderr の末尾に出る | 手段は GitHub REST API(Issues)である。Issue #12「ビルドに失敗した(fetch)」が 12:16:53 に作られた(POST から 29 秒)。本文は stage=fetch、error.type=`exit_code_1`、ビルド ID、stderr の末尾(`http_status_401`)である。試験のため Issue は閉じた |

Worker の Logs はダッシュボードで読んだ。wrangler の OAuth トークンには、観測ログを読むスコープが無い。

### 8.4 注意点

- clone・`npm ci`・`wrangler deploy` の失敗と時間切れは、Issue にならない。
- PAT の有効期限が切れると、`github_status_401` でビルドが失敗し、Issue も作れない。期限の前に PAT を再発行し、ビルドのシークレット `SNAPSHOT_GITHUB_TOKEN` を置き換える。
- PAT または Deploy Hook の URL が漏えいしたときは、GitHub で PAT を失効させ、Cloudflare で Deploy Hook を削除して作り直す。作り直した URL は `DEPLOY_HOOK_URL` と microCMS の Webhook に登録し直す。
- 同時に走らせるビルドは 1 本にする。2 本が重なると、後のビルドの ref の更新(PATCH)が 422 で失敗し、Issue が作られる。
- Deploy Hook が 5xx を返しながらビルドを始めていたときは、再試行でビルドが重複しうる(再試行は最大 2 回)。

スナップショットからの復元は、次の手順で行う。自動化は対象外である。

1. `git fetch origin content-snapshot` を実行する。
2. `git restore --source=origin/content-snapshot --worktree -- src/data/news.json public/news/images` で内容を取り出す。インデックスは変えないので、`main` の追跡ファイルはステージされない。
3. 取り出した内容を、microCMS に手で登録し直す。

推進室の資料(homepage-replace)との対応は次のとおりである。

| 資料の記述 | 本節の実装 |
| :-- | :-- |
| 構成図の「1 日 1 回の Cron Triggers でビルド」 | 8.1 の Cron Triggers と Deploy Hook |
| 「バックアップと復元」の「ビルドのたびにコンテンツと画像も GitHub に保存する」 | 8.1 の `content-snapshot` へのコミットと、8.4 の復元の手順 |
| 「障害時の動作」の「保守の担当者へ通知が届く」 | 8.1 の失敗時の Issue |
| Cloudflare の費用の「Cron Triggers 2 件(ビルドの起動・アクセストークンの更新)」 | 本節で使うのはビルドの起動の 1 件である |

## 10. アクセス解析(Cloudflare Web Analytics)

### 10.1 方式

アクセス解析には Cloudflare Web Analytics を使う。
計測のスクリプト(beacon)は、手動のスニペットとして `src/layouts/Base.astro` で全ページに入れる(コミット `e925ce8`・`3e23d1f`)。
ダッシュボードの自動セットアップ(JS の自動注入)は見送った。
自動注入が Worker(`run_worker_first`)の応答に反映されるかを確かめられず、入ったかをリポジトリのテストで確かめられないためである。
手動のスニペットなら、beacon の有無を `dist` のテストで確かめられ、Cloudflare 側の設定に左右されない。

beacon の token は、ビルド変数 `PUBLIC_WEB_ANALYTICS_TOKEN` から読む。
未設定のときの動作は次のとおりである。

| ビルドの環境 | 未設定のときの動作 |
| :-- | :-- |
| `WORKERS_CI` あり(Workers Builds) | 「PUBLIC_WEB_ANALYTICS_TOKEN が未設定」でビルドが失敗する。前回の配信が続き、`build.mjs` が Issue「ビルドに失敗した(build)」を作る |
| `WORKERS_CI` なし(ローカル) | warn のログを 1 行出し、beacon を出力しない |

token は `src/analytics.ts` の `beaconToken` で `/^[\w-]{1,64}$/` に一致するかを検証し、一致しなければビルドを失敗させる。
エラーのメッセージには token の値を出さない。

CSP(`public/_headers`)には次の 2 つを追加した。

- `script-src` に `https://static.cloudflareinsights.com`(beacon の読み込み元)
- `connect-src` に `https://cloudflareinsights.com`(計測の送信先)

Web Analytics は Cookie を使わない。
公式の説明は "does not use any client-side state, such as cookies or localStorage" である。

プライバシーポリシーのページ `/privacy/` を追加し、Turnstile と Web Analytics の利用を記載した(コミット `8c78407`)。
全ページのフッターから `/privacy/` へリンクする。

見送った案と理由は次のとおりである。

| 案 | 見送った理由 |
| :-- | :-- |
| ゾーンの自動セットアップ(JS の自動注入) | Worker の応答に反映されるかを確かめられず、テストで確かめられない |
| Worker のログと Analytics Engine で数える | 計装と集計を自前で持つことになる。ページビューと参照元は Web Analytics で足りる |
| beacon に SRI(`integrity`)を付ける | `beacon.min.js` の版が固定されず、内容が変わると読み込めなくなる |

### 10.2 手順

次の手順はユーザーがダッシュボードで行う。

1. Analytics & Logs > Web Analytics で、サイト `mosidas.dev` を追加する。自動セットアップ(JS の自動注入)は有効にせず、手動のスニペットを選ぶ。二重の計測と CSP 違反を防ぐためである。
2. 表示されたスニペットの token を、Worker `mosidas-dev` の Settings > Build > Variables and secrets に、ビルド変数 `PUBLIC_WEB_ANALYTICS_TOKEN` として登録する。未登録だと `main` のビルドが「PUBLIC_WEB_ANALYTICS_TOKEN が未設定」で失敗し、前回の配信が続く。
3. 本 PR(PR #<番号>)をマージする。
4. `https://mosidas.dev/` をブラウザーで開く。コンソールに CSP 違反が出ないこと、Network に `cloudflareinsights.com/cdn-cgi/rum` への送信が出ることを確かめる。
5. ダッシュボードの Web Analytics で、ページビューと参照元が表示されることを確かめる。
6. `https://mosidas.dev/privacy/` を開き、Turnstile と Web Analytics の記載を確かめる。

### 10.3 確認

| 項目 | 確かめ方 | 結果 |
| :-- | :-- | :-- |
| AC1: トップページを開いた後、ダッシュボードにページビューが記録される | 10.2 の 4.・5. | (マージ後に記入) |
| AC2: プライバシーポリシーのページに Turnstile と Web Analytics の利用が記載されている | `dist/privacy/index.html` を読むテストと、10.2 の 6. | ローカルのビルドで確認した(`test/build.test.mjs` の「プライバシーポリシーのページが Turnstile と Web Analytics の利用を説明する」) |

### 10.4 注意点

- JS を実行しないクライアントとボットは数えない。
- 4xx の件数と、workers.dev からの転送の件数は出ない。Worker の例外は Workers のメトリクスで見る。
- token はページの HTML に出る公開値で、シークレットではない。PRD に従い、ビルド変数に置く。
- token をシェルの環境変数で渡したとき(`PUBLIC_WEB_ANALYTICS_TOKEN=… npm test`)も `npm test` は通る。テストが token の有無で beacon の本数の期待値を切り替えるためである。`.env` に書くと、ビルドは beacon を入れるが `node --test` は `.env` を読まないため、期待値が 0 本になりテストが失敗する。

出典:

- [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/)
