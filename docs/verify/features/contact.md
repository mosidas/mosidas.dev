# 問い合わせ

利用者は `/contact/` のフォームに名前・メールアドレス・本文を入力し、Turnstile の確認が済んだ後に送信のボタンを押す。ページは `POST /api/contact` へ JSON の応答を求めて送り、結果をフォームの上の通知(`[data-result=<結果>]`)で示す。項目の誤りでは誤った入力欄に `aria-invalid="true"` が付く。Worker は Origin の検査を通った要求を 60 秒に 3 件まで受け付け、結果を `wrangler.log` に `app.contact.outcome` として残す。

## サブ機能

- `contact-rejected`: ブラウザーで正しく入力して送ると、通知 `送信を確認できませんでした` が出る。ローカルでは Turnstile の検証が `turnstile_failed` で拒否される。
- `contact-invalid`: ブラウザーで名前と本文を空白 1 文字にして送ると、通知 `送信できませんでした` と `次の項目が未入力か、形式または長さが正しくありません: 名前、本文` が出る。`#name` と `#message` に `aria-invalid="true"` が付く。
- `contact-api-invalid`: `Accept: application/json` を付けて空の項目を送ると、400 と `{"result":"invalid","fields":["name","email","message"]}` が返る。
- `contact-api-html`: `Accept` を付けずに空の項目を送ると、400 で題が `送信できませんでした | mosida` の HTML が返る。本文に誤った項目の名前が入る。
- `contact-limited`: Origin の検査を通った 60 秒で 4 件目の要求に、429 と `{"result":"limited"}` が返る。
- `contact-method`: `GET /api/contact` に 405 と `Allow: POST` が返り、題が `このページは直接開けません | mosida` の HTML が返る。
- `contact-bad-origin`: `Origin` の無い要求と `Origin` が別の値の要求に、403 と `{"result":"rejected"}` が返る。
- `contact-result-redirect`: `/contact/invalid/`・`/contact/rejected/`・`/contact/limited/`・`/contact/failed/`・`/contact/sent/` を直接開くと 303 で `/contact/` へ移る。`/contact/sent/?submitted=1` は 200 で題が `送信しました | mosida` のページを返す。

## 利用者からの到達

- `/contact/` のフォーム(`#name`・`#email`・`#message`・送信のボタン `form[action="/api/contact"] button`)
- `POST /api/contact`(ページの JavaScript からの送信と、JavaScript を使わないフォームの送信)
- `GET /api/contact`(アドレスの直接入力)
- 結果ページの URL(`/contact/<結果>/`)

## 操作

前提:

- 共通の前提のとおり健康診断がすべて ok で、`run.env` を読み込んである。
- この実行で、直近の 60 秒に Origin の検査を通る `POST /api/contact` を送っていない。up した直後の実行と、端末とページの閲覧だけを操作した実行はこれを満たす。
- 箇条を書いた順に実行する。上限を確かめる箇条は自分の 4 件で上限に当て、続く箇条は 60 秒待ってから 3 件だけを送る。この順なら、どの箇条の観測も前の箇条の送信の時刻に左右されない。
- ネットワークにつながっている。ページは Turnstile のウィジェットを、Worker は siteverify を `challenges.cloudflare.com` に求める。

- **GET で開く**(`contact-method`): `/api/contact` をアドレスで開く。次のコマンドを実行する。

  ```sh
  curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -o "$EVIDENCE_DIR/contact/method.html" -w '%{http_code} %header{allow}\n' "$BASE/api/contact"
  grep -o '<title>[^<]*' "$EVIDENCE_DIR/contact/method.html"
  grep -a -c '"app.contact.outcome":"method_not_allowed"' "$EVIDENCE_DIR/wrangler.log"
  ```

  curl は `405 POST` を出す。2 行目のコマンドは `<title>このページは直接開けません | mosida` を、3 行目のコマンドは `1` を出す。3 行目のコマンドが `0` を出したら、1 秒後に同じコマンドを実行し直す。

- **Origin の誤りで送る**(`contact-bad-origin`): `Origin` を付けない要求と、`Origin: https://evil.example` の要求を送る。次のコマンドを実行する。

  ```sh
  curl -sk --create-dirs -H 'Accept: application/json' -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'name=検証 太郎' --data-urlencode 'email=verify@example.com' --data-urlencode 'message=検証の本文' -o "$EVIDENCE_DIR/contact/no-origin.json" -w '%{http_code}\n' "$BASE/api/contact"
  curl -sk --create-dirs -H 'Origin: https://evil.example' -H 'Accept: application/json' -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'name=検証 太郎' --data-urlencode 'email=verify@example.com' --data-urlencode 'message=検証の本文' -o "$EVIDENCE_DIR/contact/evil-origin.json" -w '%{http_code}\n' "$BASE/api/contact"
  grep -a -c '"app.contact.outcome":"bad_origin"' "$EVIDENCE_DIR/wrangler.log"
  ```

  2 つの curl はどちらも `403` を出す。`contact/no-origin.json` と `contact/evil-origin.json` はどちらも `{"result":"rejected"}` である。3 行目のコマンドは `2` を出す。

- **結果ページを直接開く**(`contact-result-redirect`): 5 つの結果ページと、送信の後に移る `/contact/sent/?submitted=1` を開く。次のコマンドを実行する。

  ```sh
  for r in invalid rejected limited failed sent; do curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -o "$EVIDENCE_DIR/contact/result-$r.html" -w "$r %{http_code} %{redirect_url}\n" "$BASE/contact/$r/"; done
  curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -o "$EVIDENCE_DIR/contact/sent-submitted.html" -w '%{http_code}\n' "$BASE/contact/sent/?submitted=1"
  grep -o '<title>[^<]*' "$EVIDENCE_DIR/contact/sent-submitted.html"
  ```

  1 行目のコマンドは `<結果> 303 https://localhost:<ポート>/contact/` の行を 5 行出す。2 行目のコマンドは `200` を、3 行目のコマンドは `<title>送信しました | mosida` を出す。

- **項目の誤りを JSON で受け、上限を超える**(`contact-api-invalid`・`contact-limited`): 空の項目を JSON の応答を求めて 4 回続けて送る。次のコマンドを実行する。

  ```sh
  for i in 1 2 3 4; do curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -H 'Accept: application/json' -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'name=' --data-urlencode 'email=' --data-urlencode 'message=' -o "$EVIDENCE_DIR/contact/limit-$i.json" -w "$i %{http_code}\n" "$BASE/api/contact"; done
  grep -a -c '"app.contact.outcome":"invalid_fields"' "$EVIDENCE_DIR/wrangler.log"
  grep -a -c '"app.contact.outcome":"rate_limited"' "$EVIDENCE_DIR/wrangler.log"
  ```

  1 行目のコマンドは `1 400`・`2 400`・`3 400`・`4 429` の 4 行を出す。`contact/limit-1.json` は `{"result":"invalid","fields":["name","email","message"]}`、`contact/limit-4.json` は `{"result":"limited"}` である。2 行目のコマンドは `3` を、3 行目のコマンドは `1` を出す。

- **Accept を付けずに送る**(`contact-api-html`): 上限の 60 秒が過ぎるのを待ってから、空の項目を `Accept` を付けずに送る。次のコマンドを実行する。

  ```sh
  sleep 60
  curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'name=' --data-urlencode 'email=' --data-urlencode 'message=' -o "$EVIDENCE_DIR/contact/api-html.html" -w '%{http_code} %{content_type}\n' "$BASE/api/contact"
  grep -o -e '<title>[^<]*' -e '次の項目[^<]*' "$EVIDENCE_DIR/contact/api-html.html"
  grep -a -c '"app.contact.outcome":"invalid_fields","app.contact.response_format":"html"' "$EVIDENCE_DIR/wrangler.log"
  ```

  curl は `400 text/html; charset=utf-8` を出す。3 行目のコマンドは `<title>送信できませんでした | mosida` と `次の項目が未入力か、形式または長さが正しくありません: 名前、メールアドレス、本文` の 2 行を出す。4 行目のコマンドは `1` を出す。

- **正しく入力して送る**(`contact-rejected`): `/contact/` で 3 つの項目を入力し、Turnstile のトークンが入ってから送信のボタンを押す。次のコマンドを実行する。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /contact/ fill '#name' '検証 太郎' fill '#email' 'verify@example.com' fill '#message' '検証の本文' until 'new FormData(document.querySelector("#name").form).get("cf-turnstile-response")' shot contact/rejected-before.png click 'form[action="/api/contact"] button' until '!document.querySelector("[data-result=rejected]").hidden' text '[data-result=rejected]' contact/rejected.txt shot contact/rejected.png
  grep -a -c '"app.contact.outcome":"turnstile_failed","app.contact.response_format":"json"' "$EVIDENCE_DIR/wrangler.log"
  ```

  `contact/rejected.txt` の空行を除いた行は `送信を確認できませんでした` と `送信ボタンの上の確認をやり直してから、再度送信してください。` である。`contact/rejected-before.png` に入力した 3 つの項目が、`contact/rejected.png` にフォームの上の通知が写る。2 行目のコマンドは `1` を出す。

- **空白だけの項目で送る**(`contact-invalid`): `/contact/` で名前と本文を空白 1 文字にして送る。次のコマンドを実行する。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /contact/ fill '#name' ' ' fill '#email' 'verify@example.com' fill '#message' ' ' until 'new FormData(document.querySelector("#name").form).get("cf-turnstile-response")' click 'form[action="/api/contact"] button' until '!document.querySelector("[data-result=invalid]").hidden' until 'document.querySelector("#name").getAttribute("aria-invalid") === "true" && document.querySelector("#message").getAttribute("aria-invalid") === "true" && !document.querySelector("#email").hasAttribute("aria-invalid")' text '[data-result=invalid]' contact/invalid.txt shot contact/invalid.png
  grep -a -c '"app.contact.invalid_fields":\["name","message"\]' "$EVIDENCE_DIR/wrangler.log"
  ```

  `contact/invalid.txt` の空行を除いた行は `送信できませんでした`・`次の項目が未入力か、形式または長さが正しくありません: 名前、本文`・`修正のうえ、再度送信してください。` である。2 つ目の `until` の行が `browser.log` で ok である。2 行目のコマンドは `1` を出す。

- **結果の内訳を確かめる**: 上の操作をすべて終えた後に `wrangler.log` の結果を数える。次のコマンドを実行する。

  ```sh
  grep -a -o '"app.contact.outcome":"[a-z_]*"' "$EVIDENCE_DIR/wrangler.log" | sort | uniq -c
  ```

  `bad_origin` が 2、`invalid_fields` が 5、`method_not_allowed` が 1、`rate_limited` が 1、`turnstile_failed` が 1 である。ほかの結果は出ない。

## 落とし穴

- Turnstile のトークンが入る前に送信のボタンを押すと、ページは要求を送らずに `送信を確認できませんでした` を出す。画面はサーバーの 403 と同じなので、`wrangler.log` の `turnstile_failed` の行で見分ける。テスト用のサイトキーでは、トークンは `/contact/` を開いてから数秒で入る。
- 送信が失敗すると、ページは Turnstile をやり直す。同じ browser の呼び出しで 2 回目を送るときは、送る前にトークンを `until` で待ち直す。
- 空の項目はブラウザーの入力の検査(`required`)で止まり、要求を送らない。ブラウザーで項目の誤りを確かめるときは空白 1 文字を入力する。Worker は前後の空白を除いてから検査する。
- 送信が成功する経路(通知 `送信しました`)にはローカルで届かない。up が設定するテスト用のシークレットでは、siteverify が `hostname` を `example.com` で返す。Worker は `mosidas.dev` を求めるので、正しく入力した送信は `turnstile_failed` になる。`/contact/sent/?submitted=1` の 200 は静的なページの表示であり、送信の成功に数えない。届かなかった経路として、`contact-rejected` のコマンドと満たせなかった前提(siteverify の `hostname` が `mosidas.dev`)を報告する。
- 送信の失敗(`/contact/failed/` に当たる 503 と 502)にはローカルで届かない。up がシークレットと宛先を設定し、メールの送信の前で `turnstile_failed` になるためである。ネットワークが無いときだけ、siteverify に届かず 503 と `{"result":"failed"}`(`turnstile_unavailable`)が返る。
- JavaScript を使わないフォームの送信(結果ページの HTML と、成功のときの 303)は browser では確かめられない。browser は JavaScript を止められないためである。`contact-api-html` の curl は応答の形を確かめるだけで、ブラウザーの経路の合格に数えない。
- 上限の 3 件には、項目の誤り(`invalid_fields`)と本文の誤り(`bad_body`)の要求も、ブラウザーのフォームからの送信も数える。`bad_origin` と `GET` の要求は数えない。上限で拒否された要求は数に加わらない。同じ実行の中では上限の状態が `data/` に残るので、数え直すときは新しい実行の ID で up する。
- 通知の要素は `hidden` の属性で隠れている。`[data-result=<結果>]` は通知が隠れていても一致するので、`until` で `hidden` が外れたことを待ってから `text` を取る。
- Worker のログの行は、応答が返った後に遅れて `wrangler.log` に書かれることがある。curl の直後の `grep -a -c` が期待より 1 つ少ないときは、1 秒後に同じ `grep` を実行し直す。実行し直しても少なければ、要求が Worker に届いていないか結果が違う。
