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
本文は sanitize-html で許可リスト方式にサニタイズする。許可リストに無いタグと属性は除き、`h1`〜`h3` は `h4` に置き換え、`a` には `target="_blank"`・`rel="noopener noreferrer"` を固定値で付ける。
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
応答の形式は、要求の Accept ヘッダーで切り替える。
Accept に `application/json` を含む要求には JSON を、それ以外の要求(form post)には HTML を返す。
Accept の値は形式の判定にだけ使い、応答に書き戻さない。
処理は次の順に行う。

1. POST 以外の要求を 405 で拒否する。
2. Origin を検査し、不一致を 403(`rejected`)で拒否する。
3. 設定に不備があれば 503(`failed`)を返す。
4. レート制限を超えた要求を 429(`limited`)で拒否する。
5. 本文の形式を検査する。Content-Type が `application/x-www-form-urlencoded` でなければ 400(`rejected`)、要求の本文が 66,662 文字を超えれば 413(`rejected`)を返す。
6. 項目を検証し、不備を 400(`invalid`)で拒否する。
7. Turnstile のトークンが無いか 2,048 文字を超えれば 403(`rejected`)で拒否する。
8. siteverify が不合格なら 403(`rejected`)、siteverify の呼び出しが失敗すれば 503(`failed`)を返す。
9. メールを送信する。送信に失敗したら 502(`failed`)を返す。成功したら、JSON の要求には 200 と `{"result":"sent"}` を返し、それ以外の要求は 303 で `/contact/sent/?submitted=1` へ移す。

本文の長さ(5. の検査)は、URL エンコード後の文字数で数える。
上限の 66,662 は「各項目の検証の上限の和 × 9 + キー名と区切りの 44 文字」で求める。
検証の上限は名前 100、メールアドレス 254、本文 5,000、トークン 2,048 で、単位は UTF-16 の code unit である。
9 は、3 バイトの文字 1 つをパーセントエンコードした後の長さである。
フォームから送れる入力は、この上限に届かない(PR #30、TASK-078)。

失敗の状態コードは、応答の形式によらず同じである。
405 を除き、JSON の要求には `{ "result": <結果名>, "fields"?: [...] }` を返す。
それ以外の要求には、結果ページ(`/contact/{invalid,rejected,limited,failed}/`)の HTML をその状態コードで返す。
`invalid` のときは、不備のある項目(`name`・`email`・`message`)を、JSON では `fields` に入れ、結果ページでは項目の名前(名前・メールアドレス・本文)として本文に差し込む。
利用者の入力は応答に書き戻さない。
差し込むのは固定の項目名だけである。
405 は `/405/` のエラーページを `Allow: POST` 付きで返す。
405 の応答は、Accept によらず HTML である。

結果ページ(`/contact/{sent,invalid,rejected,limited,failed}/`)を直接開くと、Worker が 303 で `/contact/` へ移す。
末尾に `index.html` を付けた URL も同じである。
例外はクエリに `submitted` を持つ `/contact/sent/` だけで、この URL には静的アセットをそのまま返す。
転送の目的は、未置換の `%MISSING%` を見せないことと、送信していない人が送信完了と誤認するのを防ぐことである。
失敗の応答の結果ページは、Worker がアセットから直接読み出すため、この転送を通らない。

入力画面(`src/pages/contact/index.astro`)の script は、`Accept: application/json` を付けて `fetch` で `/api/contact` へ送信し、結果を同じ画面のフォームの上に表示する。
成功したらフォームを隠し、送信完了の案内を表示する。
失敗したら入力を残し、`fields` の項目に `aria-invalid` を付け、Turnstile を取り直す。
Turnstile のトークンが無いときは送信せず、`rejected` の案内を表示する。
応答の `result` と `fields` は、許可リストで確かめてから表示に使う。
`fetch` の例外、30 秒の時間切れ、JSON でない応答は、`failed` として表示する。
script が動かないときは、form post で送信し、結果ページへ移る。
ただし Turnstile も JavaScript を要するため、JavaScript が無効のブラウザーからは送信できない。
入力画面は `<noscript>` でその旨を案内する。
結果の案内の文言は `src/contact-messages.ts` にまとめ、敬体で書く。

`public/_headers` の CSP は、`script-src` と `connect-src` に `'self'` を含む(PR #28)。
`/_astro/*.js` の読み込みには `script-src 'self'` が、`fetch` での送信には `connect-src 'self'` が必要になる。
Astro は小さい script をインラインで出力するが、CSP はインラインの script を許さない。
そのため `astro.config.mjs` の `vite.build.assetsInlineLimit: 0` で、script を外部ファイルに出す。

問い合わせ 1 件ごとに、Workers Logs へ 1 行のログ(`msg` は `問い合わせを処理した`)を出す。
処理の途中で例外が発生したとき(結果ページの読み出しの失敗など)は、この行は出ない。
このときは Worker の fetch が例外を捕捉して 500 のページを返し、`msg` が `要求の処理中に例外が発生した` の error ログを出す(10.4)。
処理の結果は `app.contact.outcome`(`bad_origin`・`turnstile_missing`・`sent` など、結果名より細かい分類)に入る。
`app.contact.response_format` には、Accept から選んだ形式(`json` または `html`)が入る。
405 の応答は Accept によらず HTML だが、Accept に `application/json` を含む要求では `json` が記録される。
相関 ID の `app.request.id`(`cf-ray` の値。無ければ UUID)はログにだけ載せ、利用者には表示しない。
結果ページの直接表示の転送は、ログに出さない(`src/worker.ts` の shortcut のコメント)。

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
同一 IP からの受付は 60 秒に 3 回までとし、4 回目以降は 429(`limited`)を返す。
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

TASK-077 の PR #28 を 2026-10-14 12:50:13 UTC にマージした(マージコミット `d3f16ee`)。
マージ後に本番で確かめた結果は、下の表のとおりである。
確認日は 2026-10-14 で、確認の時刻は記録していない。

| 確認項目 | 結果 |
| :-- | :-- |
| 結果ページ 5 つ(`/contact/{sent,invalid,rejected,limited,failed}/`)の直接表示 | 303 |
| `/contact/sent/?submitted=1` | 200 |
| JSON で項目に不備のある POST | 400、`result`(`invalid`)と `fields` |
| JSON でトークンの無い POST | 403、`{"result":"rejected"}` |
| CSP | `script-src` と `connect-src` に `'self'` を含む |
| `/contact/` の script 要素 | Turnstile と `/_astro/*.js` の 2 本 |
| 実ブラウザーからの送信の成功 | 本人の確認待ち |

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
2. 本番のビルドでは、`content-snapshot` の `src/data/zenn.json` を checkout の同じパスに復元する(9.1 を参照)。
3. `scripts/fetch-zenn.mjs` で Zenn の記事の一覧を取得する。
4. 本番のビルドでは、取得したコンテンツをスナップショットとしてコミットする。
5. `astro build` を実行する。

スナップショットのコミット先は、同じリポジトリの orphan ブランチ `content-snapshot` である。
tree は `src/data/news.json`・`src/data/zenn.json`・`public/news/images/*` だけを持つ。
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
| `src/data/zenn.json` の復元の失敗 | ビルドを失敗させて配信しない。`build.mjs` が Issue「ビルドに失敗した(restore)」を作る |
| Zenn の記事の一覧の取得の失敗 | ビルドは続く。`fetch-zenn.mjs` が error ログを 1 行出す。Issue は作らない(9.1 を参照) |
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
| AC1: Cron Triggers の起動 | Worker の Logs または Metrics の Cron Triggers(Cron Events)に起動が記録される | 21:00:38 に起動したが、`outcome: exception`・`wallTimeMs: 1`・「Deploy Hook の呼び出しに失敗した: TypeError」で失敗した。原因は、Workers の `fetch` が `redirect: 'error'` を受け付けないことである。コミット `a219f30` で `manual` に直した。修正後の Cron は 2026-10-13 21:00 に起動し、Workers Builds のビルドが 2026-10-13 21:01:12 にデプロイされた(`npx wrangler deployments list` の最新のデプロイ)。その前のデプロイは 2026-10-13 12:54:10(PR #25 のマージ)で、`main` への最後の push は 2026-10-13 12:53:36 である。`content-snapshot` には内容に差分がないため、コミットされなかった(最新は 2026-10-13 12:11 の `62c01e1`)。内容が変わっていないので、Deploy Hook のもう 1 つの呼び出し元である microCMS の Webhook が起動する理由もない。したがって 2026-10-13 21:01:12 のデプロイは Cron 起点である。新しい Issue は作られず、サイトは 2026-10-13 22:25 に 200 を返した |
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
2. `git restore --source=origin/content-snapshot --worktree -- src/data/news.json src/data/zenn.json public/news/images` で内容を取り出す。インデックスは変えないので、`main` の追跡ファイルはステージされない。
3. 取り出したお知らせと画像を、microCMS に手で登録し直す。`src/data/zenn.json` は、次のビルドで Zenn のフィードから取得し直される。

推進室の資料(homepage-replace)との対応は次のとおりである。

| 資料の記述 | 本節の実装 |
| :-- | :-- |
| 構成図の「1 日 1 回の Cron Triggers でビルド」 | 8.1 の Cron Triggers と Deploy Hook |
| 「バックアップと復元」の「ビルドのたびにコンテンツと画像も GitHub に保存する」 | 8.1 の `content-snapshot` へのコミットと、8.4 の復元の手順 |
| 「障害時の動作」の「保守の担当者へ通知が届く」 | 8.1 の失敗時の Issue |
| Cloudflare の費用の「Cron Triggers 2 件(ビルドの起動・アクセストークンの更新)」 | 本節で使うのはビルドの起動の 1 件である |

## 9. Zenn の記事の一覧

### 9.1 方式

ビルド前スクリプト `scripts/fetch-zenn.mjs` が、Zenn のフィードから記事の一覧を取得する(コミット `0300008`・`93e206a`・`f8fde8d`)。
フィードの URL の既定値は `https://zenn.dev/mosida/feed` である。Zenn のユーザー名は `mosida` で、GitHub の `mosidas` と異なる。
環境変数 `ZENN_FEED_URL` があれば、その URL から取得する。URL は `https:` に限る。
フィードは RSS 2.0 である。依存を追加せず、正規表現で `item` ごとの `title`・`link`・`pubDate` を取り出す。
`link` は許可リストで検証する。許可するのは `https://zenn.dev/<ユーザー名>/articles/<スラッグ>` の形だけで、クエリ・フラグメント・ポートを持つ URL は除く。
検証を通った記事を `pubDate` の降順に並べ、最新の 10 件を `src/data/zenn.json` に書く。
記事の一覧のページ(`/articles/`、`src/pages/articles/index.astro`)はそれを読み、題名を記事の URL へのリンクにして日付とともに表示する。

取得または検証に失敗したら、`fetch-zenn.mjs` は error ログを 1 行出し、`zenn.json` を書き換えずに終了コード 0 で終わる。
`item` が 1 件でも検証に失敗したら、一覧全体を失敗として扱う。一部が欠けた一覧で前回の一覧を上書きしないためである。

`main` にある `src/data/zenn.json` は空の配列 `[]` である。
そのまま取得に失敗すると、一覧が空のまま配信され、スナップショットの一覧も空に戻る。
そのため、本番のビルドでは `build.mjs` が `fetch-zenn.mjs` の前に、`content-snapshot` の `src/data/zenn.json` を checkout の同じパスに復元する。
復元には GitHub REST API(Contents)を使う。トークンは 8.1 の `SNAPSHOT_GITHUB_TOKEN` である。

条件ごとのビルドの挙動は次のとおりである。

| 条件 | 挙動 |
| :-- | :-- |
| 取得に成功した | 取得した一覧を `zenn.json` に書いてビルドする。本番では一覧をスナップショットにコミットする |
| 取得に失敗し、復元に成功した(本番) | 復元した前回の一覧でビルドする。スナップショットの一覧は変わらない |
| 取得に失敗し、スナップショットに `zenn.json` が無い(本番の初回) | checkout の `[]` でビルドし、記事の一覧のページ(`/articles/`)に「記事はまだない。」と表示する |
| 取得に失敗した(ローカル・GitHub Actions) | 復元しない。checkout の `zenn.json` でビルドする |
| 復元に失敗した(GitHub API の失敗、内容が JSON の配列でない、`SNAPSHOT_GITHUB_TOKEN` が未登録) | ビルドを失敗させて配信しない。前回の配信が続く。本番では Issue「ビルドに失敗した(restore)」を作る(8.1 を参照) |
| `item` の検証に失敗した | 取得の失敗と同じく、前回の一覧でビルドする |

見送った案と理由は次のとおりである。

| 案 | 見送った理由 |
| :-- | :-- |
| XML パーサーの依存を追加する | 取り出す要素は `item` の 3 つだけで、正規表現で足りる。依存を増やすと更新と脆弱性の確認の対象が増える |
| 取得の失敗でビルドを失敗させる | 記事の一覧は Zenn の状態に左右され、本サイトの配信を止める理由にならない。お知らせ(6.1)は本サイトのコンテンツのため、取得の失敗でビルドを失敗させる |
| Zenn の API から取得する | フィードで記事の題名・URL・公開日を取得でき、一覧の表示に足りる |

### 9.2 手順

ユーザーの作業は無い。ビルド変数は登録せず、既定の URL を使う。

AC2 を本番で確かめる手順は次のとおりである。本タスクでは実施しない。

1. Worker `mosidas-dev` の Settings > Build > Variables and Secrets に、テキストのビルド変数 `ZENN_FEED_URL` を `https://127.0.0.1:9/feed` で登録する。
2. Deploy Hook(`main`)を POST で呼ぶ。
3. ビルドが成功し、ビルドログに「Zenn の記事の取得に失敗した」の error 行が出ること、記事の一覧のページ(`/articles/`)に前回の一覧が表示されることを確かめる。
4. ビルド変数 `ZENN_FEED_URL` を削除する。

### 9.3 計測

2026-10-13 に、ローカル(`WORKERS_CI` が無い環境)で確かめた。

| 項目 | 確かめ方 | 結果 |
| :-- | :-- | :-- |
| AC1: 新しい順の表示とリンク | `node scripts/fetch-zenn.mjs && npx astro build` を実行し、`dist/index.html` の記事のリンクと `<time>` を読む。確かめたら `git checkout src/data/zenn.json` で戻す | 取得は 2 件(`zenn.article_count: 2`)だった。`dist/index.html` には、2026年8月10日の `https://zenn.dev/mosida/articles/claude-code-large-task-design`、2026年7月18日の `https://zenn.dev/mosida/articles/psychological-safety-as-result` の順にリンクが出た |
| AC2: 取得の失敗時の前回の一覧 | `ZENN_FEED_URL=https://127.0.0.1:9/feed npm run build` を実行し、終了コード、`zenn.json` の変化、`dist/index.html` を確かめる | checkout の `zenn.json`(`[]`)では、終了コードは 0 で、`git status` に差分は無く、トップページは「記事はまだない。」だった。AC1 で取得した 2 件の `zenn.json` で同じコマンドを実行すると、終了コードは 0 で、`zenn.json` の sha1 は実行の前後で同じだった。`dist/index.html` には 2 件のリンクが残った |
| AC3: 失敗のログ | AC2 のコマンドの出力を読む | 次の error 行が出た |

AC3 で出た error 行は次のとおりである。

```json
{"level":"error","msg":"Zenn の記事の取得に失敗した","error.type":"TypeError","app.error.origin":"system","app.error.transient":true}
```

本番(`main` のマージ後)の表示とビルドログの確認は、後続の反復で本節に追記する。

### 9.4 注意点

- フィードに記事以外の URL(本・スクラップ)が混ざると、`link` の検証に失敗し、一覧全体が失敗として扱われる。一覧は前回のまま更新されない。
- `content-snapshot` に `zenn.json` が無い初回のビルドで取得に失敗すると、checkout の `[]` で進み、一覧は空になる。
- GitHub REST API(Contents)は、1MB を超えるファイルの内容を返さない。`zenn.json` は最大 10 件のため、この上限に達しない。
- Zenn のユーザー名を変えたときは、`scripts/fetch-zenn.mjs` の既定の URL を直す。

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
| `WORKERS_CI` あり(Workers Builds) | 「PUBLIC_WEB_ANALYTICS_TOKEN が未設定」でビルドが失敗する。前回の配信が続く。`main` のビルドでは `build.mjs` が Issue「ビルドに失敗した(build)」を作る |
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
3. PR #15(feat: Cloudflare Web Analytics を導入し、プライバシーポリシーのページを追加する)をマージする。
4. `https://mosidas.dev/` をブラウザーで開く。コンソールに CSP 違反が出ないこと、Network に `cloudflareinsights.com/cdn-cgi/rum` への送信が出ることを確かめる。
5. ダッシュボードの Web Analytics で、ページビューと参照元が表示されることを確かめる。
6. `https://mosidas.dev/privacy/` を開き、Turnstile と Web Analytics の記載を確かめる。

### 10.3 確認

2026-10-13 に本番で確かめた。

| 項目 | 確かめ方 | 結果 |
| :-- | :-- | :-- |
| AC1: トップページを開いた後、ダッシュボードにページビューが記録される | 10.2 の 4.・5. | 記録された。ダッシュボードの Web Analytics(2026-10-12 02:21 UTC 〜 10-13 02:21 UTC の範囲、Exclude bots あり)に、ページビュー 7 件(path `/` 7 件、host `mosidas.dev` 7 件、参照元 None(direct)7 件)が出た。最新の 1 件は 10-13 02:20 UTC ごろで、手動のスニペットを入れたビルドの完了(01:59:33 UTC)より後のため、ページの beacon による記録である。それ以前の件は、切り替え前の自動注入によるものである |
| AC2: プライバシーポリシーのページに Turnstile と Web Analytics の利用が記載されている | `dist/privacy/index.html` を読むテストと、10.2 の 6. | ローカルのビルドで確認した(`test/build.test.mjs` の「プライバシーポリシーのページが Turnstile と Web Analytics の利用を説明する」)。本番の `https://mosidas.dev/privacy/` も 200 を返す |

本番の配信は `curl` で確かめた(10-13 02:23 UTC)。
`https://mosidas.dev/` と `https://mosidas.dev/privacy/` のどちらも 200 を返し、`static.cloudflareinsights.com/beacon.min.js` の `script` が 1 本ずつ入り、`data-cf-beacon` の `token` が登録した値と一致した。
応答の `Content-Security-Policy` には `script-src` に `https://static.cloudflareinsights.com`、`connect-src` に `https://cloudflareinsights.com` が入っていた。
ブラウザーのコンソールの CSP 違反は、ユーザーから報告が無かった。
計測が記録されたことから、beacon の読み込みと送信は CSP を通っている。

10.2 の手順は、次の点が想定と違った。

| 手順 | 実際 |
| :-- | :-- |
| 1. サイトを追加する | サイト `mosidas.dev` は、自動注入(EU 除外)で既に存在した。「Enable with JS Snippet installation」に切り替えて自動注入を止め、表示された token を 2. で登録した |
| 2. と 3. の順序 | 3.(PR #15 のマージ、01:2x UTC、マージコミット `6eff776`)を 2. より先に行った。`main` のビルドは「PUBLIC_WEB_ANALYTICS_TOKEN が未設定」で失敗し、`build.mjs` が 01:30:03 UTC に Issue #16「ビルドに失敗した(build)」を作った。ビルドの失敗は 01:30:08 UTC に確定し、前回の配信が続いた。10.1 の表の「`WORKERS_CI` あり」の動作のとおりである。token の登録と PR #14(マージコミット `1c8aaeb`)のマージの後、`main` のビルドは 01:59:33 UTC に成功した。Issue #16 は閉じた |

### 10.4 注意点

- JS を実行しないクライアントとボットは数えない。
- 4xx の件数と、workers.dev からの転送の件数は出ない。Worker の fetch の例外は捕捉して 500 のページを返し、Workers Logs に `msg: 要求の処理中に例外が発生した` の error ログを 1 行残す。例外の件数はこのログで見る。
- token はページの HTML に出る公開値で、シークレットではない。PRD に従い、ビルド変数に置く。
- token をシェルの環境変数で渡したとき(`PUBLIC_WEB_ANALYTICS_TOKEN=… npm test`)も `npm test` は通る。テストが token の有無で beacon の本数の期待値を切り替えるためである。`.env` に書くと、ビルドは beacon を入れるが `node --test` は `.env` を読まないため、期待値が 0 本になりテストが失敗する。

出典:

- [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/)
