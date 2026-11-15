# 問い合わせ

利用者は `/contact/` のフォームに名前・メールアドレス・本文を入力する。Turnstile の確認が済んだ後に送信のボタンを押す。ページは JSON の応答を求めて入力を `POST /api/contact` で送る。結果はフォームの上の通知(`[data-result=<結果>]`)で示す。項目の誤りでは誤った入力欄に `aria-invalid="true"` が付く。Worker は Origin の検査を通った要求を 60 秒に 3 件まで受け付ける。Worker は結果を `wrangler.log` に `app.contact.outcome` として残す。

## サブ機能

- `contact-method`: `GET /api/contact` には 405 と `Allow: POST` と題が `このページは直接開けません | mosida` の HTML が返る。
- `contact-bad-origin`: `Origin` の無い要求と `Origin` が `$BASE` でも `https://mosidas.dev` でもない要求に 403 と `{"result":"rejected"}` が返る。
- `contact-result-redirect`: `/contact/invalid/`・`/contact/rejected/`・`/contact/limited/`・`/contact/failed/`・`/contact/sent/` を直接開くと 303 で `/contact/` へ移る。`/contact/sent/?submitted=1` を開くと 200 で題が `送信しました | mosida` のページが返る。
- `contact-api-html`: `Accept` を付けずに空の項目を送ると 400 で題が `送信できませんでした | mosida` の HTML が返る。応答の本文に誤った項目の名前が入る。
- `contact-rejected`: ブラウザーで正しく入力して送ると通知 `送信を確認できませんでした` が出る。ローカルでは Worker が送信を `turnstile_failed` で拒否する。
- `contact-invalid`: ブラウザーで名前と本文を空白 1 文字にして送ると通知 `送信できませんでした` と `次の項目が未入力か、形式または長さが正しくありません: 名前、本文` が出る。`#name` と `#message` に `aria-invalid="true"` が付く。
- `contact-api-invalid`: `Accept: application/json` を付けて空の項目を送ると 400 と `{"result":"invalid","fields":["name","email","message"]}` が返る。
- `contact-limited`: 60 秒の間に Origin の検査を通った 4 件目の要求に 429 と `{"result":"limited"}` が返る。

## 利用者からの到達

- `/contact/` のフォーム(`#name`・`#email`・`#message`・送信のボタン `form[action="/api/contact"] button`)
- `POST /api/contact`(ページの JavaScript からの送信と JavaScript を使わないフォームの送信)
- `GET /api/contact`(URL の直接入力)
- 結果ページの URL(`/contact/<結果>/`)

## 操作

前提:

- 共通の前提のとおり健康診断がすべて ok である。`run.env` を読み込んである。
- この実行で直近の 60 秒に Origin の検査を通る `POST /api/contact` を送っていない。up した直後の実行と端末とページの閲覧と移動の機能だけを確かめた実行はこれを満たす。
- 操作を書いた順に実行する。**項目の誤りを JSON で受けて上限を超える** はこの実行(1 つ目の実行)を down した後に新しい実行の ID で up し直したインスタンス(2 つ目の実行)で行う。
- ほかの機能をこの実行で確かめるときは問い合わせより先に済ませる。端末とページの閲覧と移動は `/api/` への要求が 0 件であることを確かめるので問い合わせの要求を送った後では確かめられない。
- ネットワークにつながっている。ページは Turnstile のウィジェットを `challenges.cloudflare.com` から読み込む。Worker は `challenges.cloudflare.com` の siteverify に問い合わせる。

- **GET で開く**(`contact-method`): `/api/contact` の URL を直接入力したときと同じ `GET` の要求を curl で送る。この操作を次のコマンドで行う。

  ```sh
  curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -o "$EVIDENCE_DIR/contact/method.html" -w '%{http_code} %header{allow}\n' "$BASE/api/contact"
  grep -o '<title>[^<]*' "$EVIDENCE_DIR/contact/method.html"
  grep -a -c '"app.contact.outcome":"method_not_allowed"' "$EVIDENCE_DIR/wrangler.log"
  ```

  curl は `405 POST` を出す。2 行目のコマンドは `<title>このページは直接開けません | mosida` を出す。3 行目のコマンドは `1` を出す。

- **Origin の誤りで送る**(`contact-bad-origin`): `Origin` を付けない要求と `Origin: https://evil.example` の要求を送る。この操作を次のコマンドで行う。

  ```sh
  curl -sk --create-dirs -H 'Accept: application/json' -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'name=検証 太郎' --data-urlencode 'email=verify@example.com' --data-urlencode 'message=検証の本文' -o "$EVIDENCE_DIR/contact/no-origin.json" -w '%{http_code}\n' "$BASE/api/contact"
  curl -sk --create-dirs -H 'Origin: https://evil.example' -H 'Accept: application/json' -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'name=検証 太郎' --data-urlencode 'email=verify@example.com' --data-urlencode 'message=検証の本文' -o "$EVIDENCE_DIR/contact/evil-origin.json" -w '%{http_code}\n' "$BASE/api/contact"
  grep -a -c '"app.contact.outcome":"bad_origin"' "$EVIDENCE_DIR/wrangler.log"
  ```

  2 つの curl はどちらも `403` を出す。`contact/no-origin.json` と `contact/evil-origin.json` はどちらも `{"result":"rejected"}` である。3 行目のコマンドは `2` を出す。

- **結果ページを直接開く**(`contact-result-redirect`): 5 つの結果ページと送信の後に移る `/contact/sent/?submitted=1` を開く。この操作を次のコマンドで行う。

  ```sh
  for r in invalid rejected limited failed sent; do curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -o "$EVIDENCE_DIR/contact/result-$r.html" -w "$r %{http_code} %{redirect_url}\n" "$BASE/contact/$r/"; done
  curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -o "$EVIDENCE_DIR/contact/sent-submitted.html" -w '%{http_code}\n' "$BASE/contact/sent/?submitted=1"
  grep -o '<title>[^<]*' "$EVIDENCE_DIR/contact/sent-submitted.html"
  ```

  1 行目のコマンドは `<結果> 303 https://localhost:<ポート>/contact/` の行を 5 行出す。2 行目のコマンドは `200` を出す。3 行目のコマンドは `<title>送信しました | mosida` を出す。

- **Accept を付けずに送る**(`contact-api-html`): 空の項目を `Accept` を付けずに送る。この操作を次のコマンドで行う。

  ```sh
  curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'name=' --data-urlencode 'email=' --data-urlencode 'message=' -o "$EVIDENCE_DIR/contact/api-html.html" -w '%{http_code} %{content_type}\n' "$BASE/api/contact"
  grep -o -e '<title>[^<]*' -e '次の項目[^<]*' "$EVIDENCE_DIR/contact/api-html.html"
  grep -a -c '"app.contact.outcome":"invalid_fields","app.contact.response_format":"html"' "$EVIDENCE_DIR/wrangler.log"
  ```

  curl は `400 text/html; charset=utf-8` を出す。2 行目のコマンドは `<title>送信できませんでした | mosida` と `次の項目が未入力か、形式または長さが正しくありません: 名前、メールアドレス、本文` の 2 行を出す。3 行目のコマンドは `1` を出す。

- **正しく入力して送る**(`contact-rejected`): `/contact/` で 3 つの項目を入力する。Turnstile のトークンが入ってから送信のボタンを押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /contact/ fill '#name' '検証 太郎' fill '#email' 'verify@example.com' fill '#message' '検証の本文' until 'new FormData(document.querySelector("#name").form).get("cf-turnstile-response")' shot contact/rejected-before.png click 'form[action="/api/contact"] button' until '!document.querySelector("[data-result=rejected]").hidden' text '[data-result=rejected]' contact/rejected.txt shot contact/rejected.png
  grep -a -c '"app.contact.outcome":"turnstile_failed","app.contact.response_format":"json"' "$EVIDENCE_DIR/wrangler.log"
  ```

  `contact/rejected.txt` の空行を除いた行は `送信を確認できませんでした` と `送信ボタンの上の確認をやり直してから、再度送信してください。` である。`contact/rejected-before.png` に入力した 3 つの項目が写る。`contact/rejected.png` にフォームの上の通知が写る。2 行目のコマンドは `1` を出す。

- **空白だけの項目で送る**(`contact-invalid`): `/contact/` で名前と本文を空白 1 文字にして送る。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /contact/ fill '#name' ' ' fill '#email' 'verify@example.com' fill '#message' ' ' until 'new FormData(document.querySelector("#name").form).get("cf-turnstile-response")' click 'form[action="/api/contact"] button' until '!document.querySelector("[data-result=invalid]").hidden' until 'document.querySelector("#name").getAttribute("aria-invalid") === "true" && document.querySelector("#message").getAttribute("aria-invalid") === "true" && !document.querySelector("#email").hasAttribute("aria-invalid")' text '[data-result=invalid]' contact/invalid.txt shot contact/invalid.png
  grep -a -c '"app.contact.invalid_fields":\["name","message"\]' "$EVIDENCE_DIR/wrangler.log"
  ```

  `contact/invalid.txt` の空行を除いた行は `送信できませんでした`・`次の項目が未入力か、形式または長さが正しくありません: 名前、本文`・`修正のうえ、再度送信してください。` である。3 つ目の `until` の行が `browser.log` で ok である。この行は `#name` と `#message` に `aria-invalid="true"` が付き `#email` に付かないことを示す。2 行目のコマンドは `1` を出す。

- **結果の内訳を確かめる**: 上の操作をすべて終えて 1 つ目の実行を止める前に `wrangler.log` の結果を数える。次のコマンドを実行する。

  ```sh
  grep -a -o '"app.contact.outcome":"[a-z_]*"' "$EVIDENCE_DIR/wrangler.log" | sort | uniq -c
  ```

  結果ごとの数は `bad_origin` が 2・`invalid_fields` が 2・`method_not_allowed` が 1・`turnstile_failed` が 1 である。ほかの結果は出ない。

- **2 つ目の実行に切り替える**: ここまでの操作が上限を使い切るためインスタンスを分ける。ここまでの操作は Origin の検査を通る `POST /api/contact` を 3 件(`Accept` を付けない送信とブラウザーの 2 回の送信)送る。同じインスタンスで続けると 3 件のうち最初の要求から 60 秒たつまでは 1 回目の送信から 429 になる。新しい実行の ID のインスタンスは新しい `data/` を使うので Worker は上限の件数を 0 から数え直す。

  2 つ目の実行の ID は 1 つ目の実行の ID に `-limit` を付けたものにする。次のコマンドで 1 つ目の実行を止めて 2 つ目の実行を起動する。

  ```sh
  docs/verify/scripts/drive.mjs down "$RUN_ID"
  RUN_ID="$RUN_ID-limit"
  docs/verify/scripts/drive.mjs up "$RUN_ID"
  docs/verify/scripts/drive.mjs doctor "$RUN_ID"
  . "docs/verify/runs/$RUN_ID/run.env"
  ```

  down は `evidence: docs/verify/runs/<1 つ目の実行の ID>/evidence` と証拠の一覧を出して終了コード 0 で終わる。1 つ目の実行の証拠はこのディレクトリに残る。up は最後の行に `ready https://localhost:<ポート>` を出す。doctor は 6 項目の `ok` を出す。この後の `$RUN_ID`・`$BASE`・`$EVIDENCE_DIR` は 2 つ目の実行の値である。別のシェルで続けるときは `RUN_ID` に `<1 つ目の実行の ID>-limit` を設定し直してから `. "docs/verify/runs/$RUN_ID/run.env"` で読み込む。

- **項目の誤りを JSON で受けて上限を超える**(`contact-api-invalid`・`contact-limited`): 2 つ目の実行で空の項目を JSON の応答を求めて 4 回続けて送る。この操作を次のコマンドで行う。

  ```sh
  for i in 1 2 3 4; do curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -H 'Accept: application/json' -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'name=' --data-urlencode 'email=' --data-urlencode 'message=' -o "$EVIDENCE_DIR/contact/limit-$i.json" -w "$i %{http_code}\n" "$BASE/api/contact"; done
  grep -a -c '"app.contact.outcome":"invalid_fields"' "$EVIDENCE_DIR/wrangler.log"
  grep -a -c '"app.contact.outcome":"rate_limited"' "$EVIDENCE_DIR/wrangler.log"
  grep -a -o '"app.contact.outcome":"[a-z_]*"' "$EVIDENCE_DIR/wrangler.log" | sort | uniq -c
  ```

  1 行目のコマンドは `1 400`・`2 400`・`3 400`・`4 429` の 4 行を出す。`contact/limit-1.json` は `{"result":"invalid","fields":["name","email","message"]}` である。`contact/limit-4.json` は `{"result":"limited"}` である。2 行目のコマンドは `3` を出す。3 行目のコマンドは `1` を出す。4 行目のコマンドは `invalid_fields` が 3 の行と `rate_limited` が 1 の行の 2 行だけを出す。

- **2 つ目の実行を止める**: 次のコマンドを実行する。

  ```sh
  docs/verify/scripts/drive.mjs down "$RUN_ID"
  ```

  down は `evidence: docs/verify/runs/<2 つ目の実行の ID>/evidence` と証拠の一覧を出して終了コード 0 で終わる。

## 落とし穴

- Turnstile のトークンが入る前に送信のボタンを押すとページは要求を送らずに `送信を確認できませんでした` を出す。通知はサーバーが 403 を返したときと同じなので `wrangler.log` の `turnstile_failed` の行で見分ける。テスト用のサイトキーではトークンは `/contact/` を開いてから数秒で入る。
- 送信が失敗するとページは Turnstile のウィジェットをリセットしてトークンを取り直す。同じ browser の呼び出しで 2 回目を送るときは送る前にトークンを `until` で待ち直す。
- 項目が空のときはブラウザーが入力の検査(`required`)で送信を止める。ページは要求を送らない。ブラウザーで項目の誤りを確かめるときは空白 1 文字を入力する。Worker は前後の空白を除いてから検査する。
- 送信が成功する経路(通知 `送信しました`)にはローカルで届かない。up が設定するテスト用のシークレットでは siteverify が `hostname` を `example.com` で返す。Worker は `mosidas.dev` を求めるので正しく入力した送信は `turnstile_failed` になる。`/contact/sent/?submitted=1` の 200 は静的なページの表示である。送信の成功に数えない。届かなかった経路として `contact-rejected` のコマンドと満たせなかった前提(siteverify の `hostname` が `mosidas.dev` である)を報告する。
- ネットワークにつながった状態では送信の失敗(`/contact/failed/` に当たる 503 と 502)にローカルで届かない。Worker はメールを送る前に `turnstile_failed` で拒否するためである。503 の `missing_config` と `rate_limiter_unavailable` にも届かない。up はシークレットと宛先を設定して起動し上限を数える仕組みも動くためである。ネットワークが無いときは siteverify に届かず 503 と `{"result":"failed"}`(`turnstile_unavailable`)が返る。届かなかった経路として `contact-rejected` のコマンドと満たせなかった前提(メールの送信が失敗する)を報告する。
- JavaScript を使わないフォームの送信(結果ページの HTML と成功のときの 303)は browser では確かめられない。browser は JavaScript を止められないためである。`contact-api-html` の curl は応答の形を確かめるだけでブラウザーの経路の合格に数えない。届かなかった経路として `contact-api-html` のコマンドと満たせなかった前提(フォームを JavaScript が無効のブラウザーから送る)を報告する。
- 項目の誤り(`invalid_fields`)と本文の誤り(`bad_body`)の要求とブラウザーのフォームからの送信も上限の数に入る。`bad_origin` と `GET` の要求は上限の数に入らない。上限で拒否された要求も数に入らない。同じ実行の中では上限の状態が `data/` に残るので数え直すときは新しい実行の ID で up する。
- 通知の要素は `hidden` の属性で隠れている。`[data-result=<結果>]` は通知が隠れていても一致するので `until` で `hidden` が外れたことを待ってから `text` を取る。
- 要求の行と Worker のログの行は応答が返った後に遅れて `wrangler.log` に書かれることがある。curl の直後の `grep -a -c` が期待より少ないときは [mosidas.dev の検証の手引き](../README.md) の「3. 操作」のとおり 1 秒ほど後に同じ `grep` を実行し直す。
- 2 つ目の実行の操作をやり直すときは 1 つ目の実行からやり直さなくてよい。新しい実行の ID のインスタンスは新しい `data/` で上限の件数を 0 から数えるためである。2 つ目の実行を down し、まだ up していない ID(例 `<1 つ目の実行の ID>-limit2`)を `RUN_ID` に直接書いて up する。`<1 つ目の実行の ID>-limit` は使用済みなので、up は `使用済みの実行の ID。新しい ID で up する` を出して終了コード 1 で終わる。
