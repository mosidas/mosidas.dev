# mosidas.dev の検証の手引き

本書は mosidas.dev をローカルで起動し、利用者と同じ経路で操作して証拠を取る手順である。検証の対象はローカルの Worker(`src/worker.ts`)が配信する Web サイトである。ブラウザーで画面を操作し、curl で `POST /api/contact` を送る。本書は `src/` の画面・端末(サイトのコマンドの入力欄)・問い合わせを変えたときに開き、実アプリで振る舞いを確かめる。機能ごとの操作は [mosidas.dev の機能マップ](features/README.md) から該当する機能ファイルを開いて確かめる。コマンドはすべてリポジトリのルートで実行する。

## 1. 起動

前提は次のとおりである。

- macOS で Node.js 24.2 以上を使う。
- `npm ci` を実行済みである。
- `/Applications/Google Chrome.app` に Google Chrome をインストール済みである。browser のサブコマンドはこの Chrome を headless で起動する。
- 問い合わせのページ(`/contact/`)を確かめるときと `cf-turnstile-response` を付けて `POST /api/contact` を送るときはネットワークにつながっている。ページは Turnstile のウィジェットを `challenges.cloudflare.com` から読み込み、Worker は `challenges.cloudflare.com` の siteverify に問い合わせるためである。ネットワークにつながっていないと Worker の要求は siteverify に届かず、503(`turnstile_unavailable`)が返る。

実行の ID を決めて起動する。実行の ID は 1 回の検証の名前で、ポート・データ・Chrome のプロファイル・証拠の保存先(`docs/verify/runs/<実行の ID>/`)をこの ID ごとに分ける。実行の ID には英数字・`.`・`_`・`-` だけを使う。`.` と `..` だけの ID は使えない。up は毎回新しい実行の ID で行う。一度 up した ID で up し直さない。`wrangler.log` と `browser.log` は追記で書かれるので、同じ ID で up し直すと前の回の行が混ざり、証拠の行の数が機能マップの観測と合わなくなる。そのため up は `evidence/` が残る ID では起動しない。

```sh
RUN_ID=$(date +%Y%m%d-%H%M%S)
docs/verify/scripts/drive.mjs up "$RUN_ID"
```

最後の行に `ready https://localhost:<ポート>` が出て終了コードが 0 なら準備ができている。up は wrangler の `Ready on` の行が出て `GET /` が 200 で題 `mosida` のページを返すまで最大 90 秒待つ。準備ができないとき・同じ実行の ID の `run.env` が残っているとき・使用済みの実行の ID のときは、次のどれかを出して終了コード 1 で終わる。

| 出力 | 状態 | 対処 |
| :-- | :-- | :-- |
| `npx astro build` の出力だけ | ビルドが失敗した。wrangler は起動していない | ビルドの誤りを報告する |
| `起動できない。docs/verify/runs/<実行の ID>/evidence/wrangler.log の末尾:` とログの末尾 40 行 | 準備ができる前に wrangler が終了したか、90 秒で準備ができなかった。wrangler を止めて `run.env` を削除した。`evidence/` は残る | ログの末尾を報告する。やり直すときは新しい実行の ID で up する |
| `起動できない。…` とログの末尾に続けて `グループ <PID> かポート <ポート>・<ポート> が残るので run.env を残す。down を実行する` | wrangler のプロセスグループかポートの LISTEN が残る | 5. の down を実行する。やり直すときは新しい実行の ID で up する |
| `起動済み。doctor を実行する` | 同じ実行の ID の `run.env` が残っている | 2. の健康診断を実行する |
| `使用済みの実行の ID。新しい ID で up する` | この実行の ID の `evidence/` が残っている。ビルドも起動もしていない | `RUN_ID` に新しい値を設定して up する |

別のシェルでコマンドを続けるときは `RUN_ID` に同じ値を設定し直す。3. の操作に進むときは `run.env` もそのシェルで読み込み直す。シェルの変数はシェルをまたいで残らない。

up は次のことを行う。

- `npx astro build` で `dist/` を作る。`npm run build` は `scripts/fetch-zenn.mjs` で git が追跡する `src/data/zenn.json` を書き換えるため使わない。
- 空いているポートを 2 つ選び、Worker と inspector に割り当てて `wrangler dev` を起動する。
- `wrangler dev` に `--local-upstream mosidas.dev --local-protocol https` を渡す。Worker から見た要求の URL は `https://mosidas.dev` になり、`src/worker.ts` は要求を 301 で転送しない。証明書は自己署名である。
- Worker のデータを `docs/verify/runs/<実行の ID>/data/` に保存する。
- Turnstile のテスト用のシークレットと問い合わせの宛先 `CONTACT_TO` を設定する。本番のキーは使わない。テスト用のシークレットでは siteverify の `success` が true になるが `hostname` が `example.com` になる。そのため Worker は `turnstile_failed` で拒否し、ローカルでは問い合わせのメールを送る処理まで進まない。
- `docs/verify/runs/<実行の ID>/run.env` に実行の記録(`RUN_ID`・`BASE`・`PORT`・`INSPECTOR_PORT`・`PID`・`COMMIT`・`DIST`・`EVIDENCE_DIR`)を書く。
- wrangler の標準出力と標準エラーを `docs/verify/runs/<実行の ID>/evidence/wrangler.log` に書く。

ポート・データ・Chrome のプロファイルは実行の ID ごとに分かれる。`dist/` は実行の間で共有する。up・`npm test`・pre-push の hook(`npm test` を実行する)はどれも `dist/` を作り直す。そのため、別の実行が起動している間は up・`npm test`・push を実行しない。実行すると起動中の実行の健康診断で `ビルド` が ng になる。

起動中の Worker は up のときに作った `dist/` を配信している。`src/` を変えたら 5. の手順で down し、`RUN_ID` に新しい値を設定して 1. の up をやり直す。

## 2. 健康診断

up で起動したインスタンス(この実行の wrangler と Worker)を操作してよいかを読み取りだけで確かめる。次のときに実行する。

- 最初の操作の前
- 操作が ng で終わった後
- インスタンスが予想と違う振る舞いをした後

```sh
docs/verify/scripts/drive.mjs doctor "$RUN_ID"
```

次の 6 項目が `ok <項目>` か `ng <項目>: <理由>` の行で出る。続けて `BASE`・`COMMIT`・`EVIDENCE_DIR` の値が出る。すべて ok なら終了コードは 0、1 つでも ng なら 1 である。`run.env` が無いときは `ng run.env: docs/verify/runs/<実行の ID>/run.env がない` の 1 行だけを出して終了コード 1 で終わる。

| 項目 | ok が示すこと | ng の主な原因 |
| :-- | :-- | :-- |
| `run.env` | 実行の記録がある | up をしていないか、down を済ませた |
| `プロセス` | 記録した PID のプロセスグループに、この実行の `--persist-to` を持つ wrangler のプロセスがある | wrangler が異常終了したか、グループが既に無い |
| `ポート` | Worker と inspector の 2 つのポートを、記録したグループのプロセスが LISTEN している | 別のグループのプロセスがポートを持つか、LISTEN が無い |
| `コミット` | `HEAD` が up のときのコミットと同じである | up の後にコミットしたかブランチを切り替えた |
| `ビルド` | `dist/` の中身が up のときと同じである | 別の実行の up・`npm test`・push が `dist/` を作り直した |
| `応答` | `GET /` が 200 で `<title>mosida</title>` を含む | Worker が応答しない |

ng が 1 つでもあれば操作しない。5. の手順で down し、`RUN_ID` に新しい値を設定して 1. の up をやり直す。サイトにはログインが無いので認証の確認は無い。

## 3. 操作

操作の前に実行の記録を読み込む。`$BASE`(`https://localhost:<ポート>`)と `$EVIDENCE_DIR`(証拠の保存先の絶対パス)が設定される。

```sh
. "docs/verify/runs/$RUN_ID/run.env"
```

ブラウザーの操作は drive.mjs の browser で行う。

```sh
docs/verify/scripts/drive.mjs browser "$RUN_ID" <操作> [<操作> ...]
```

browser は呼び出しのたびに新しい headless Chrome を起動する。画面の大きさは幅 1280px・高さ 800px である。Chrome は証明書の誤りを無視する。browser は操作を書いた順に実行し、ng になった操作で止まる。終わると Chrome を閉じる。ページの状態は呼び出しをまたいで残らないので、各呼び出しを `open` から始める。

| 操作 | 引数 | すること | 待ち方 |
| :-- | :-- | :-- | :-- |
| `open` | `<パス>` | `$BASE` からのパスのページを開く | load のイベントを最大 15 秒待つ |
| `fill` | `<セレクター> <文字列>` | 要素にフォーカスを移し、入力済みの値を選択してから文字列を入力する。値は文字列に置き換わる | 操作の前に読み込みの完了を待つ |
| `enter` | なし | フォーカスのある要素で Enter キーを押す | 操作の前に読み込みの完了を待つ |
| `click` | `<セレクター>` | 要素を画面の中央へスクロールし、要素の中心をマウスでクリックする | 操作の前に読み込みの完了を待つ |
| `until` | `<JavaScript の式>` | 式が真になるまで 200 ミリ秒ごとに評価する。評価の例外は偽に数える | 最大 15 秒待ち、真にならなければ ng |
| `text` | `<セレクター> <ファイル>` | 要素の `innerText` をファイルに保存する | 待たない |
| `shot` | `<ファイル>` | 画面のスクリーンショットを PNG で保存する | 待たない |

`fill`・`enter`・`click` は操作の前にページの読み込みの完了(`document.readyState` が `complete`)を最大 15 秒待つ。15 秒で完了しなければ `ng: 読み込みが 15 秒で終わらない` で止まる。操作の後のページの変化は待たないので、ページが変わる操作の後には `until` で変わった後の状態を待つ。

`<ファイル>` は `$EVIDENCE_DIR` からの相対パスで書く。`$EVIDENCE_DIR` の外と、`wrangler.log`・`browser.log` には書けない。

引用符は次のように付ける。`until` の式は外側を単引用符で囲み、式の中の文字列を二重引用符で書く。セレクターも単引用符で囲む。

```sh
docs/verify/scripts/drive.mjs browser "$RUN_ID" open / until 'document.querySelector("#shell-input")' fill '#shell-input' whoami enter
```

セレクターには次のものだけを使う。

- id
- role
- aria の属性
- data 属性
- リンク先と送信先のパス(`href` とフォームの `action` の値)
- 要素の名前(`h1`・`main`・`nav`・`a`・`form`・`button`)

class の名前と DOM の位置は見た目を変えるときに変わる。要素の名前は見出し・ランドマーク・リンク・フォームの役割を表すので、見た目を変えても変わらない。

browser は操作ごとに `<ISO 8601 の時刻> <操作と引数> ok` か `<ISO 8601 の時刻> <操作と引数> ng: <理由>` の行を標準出力と `$EVIDENCE_DIR/browser.log` に出す。終了コードはすべて ok なら 0、ng があれば 1 である。browser は未知の操作・引数の不足・保存先の誤り・操作が 1 つも無いことを Chrome を起動する前に検出し、終了コード 2 で終わる。`run.env` が無いときは `docs/verify/runs/<実行の ID>/run.env がない。up を実行する` を出して終了コード 1 で終わる。Chrome のページにつながらないときは `ng` の行を出さずに終了コード 1 で終わる。

HTTP の要求は curl で送る。証明書が自己署名なので `-k` を付ける。保存先の `<機能 ID>` は機能ファイルの名前から `.md` を除いた語(`shell`・`pages`・`contact`)である。`--create-dirs` は保存先の `<機能 ID>/` のディレクトリを作る。`--create-dirs` を付けずにディレクトリも無いときは、curl は保存できず終了コード 23 で終わる。

```sh
curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -o "$EVIDENCE_DIR/<機能 ID>/<名前>" -w '%{http_code}\n' "$BASE/<パス>"
```

`POST /api/contact` には次の型で送る。`--data-urlencode` は本文を送るので、要求のメソッドは POST になる。`Accept: application/json` を付けると応答の本文は `{"result":"<結果>"}` の JSON になる。付けないと結果のページ(題が `送信を確認できませんでした | mosida` など)の HTML になる。JSON の応答では項目の誤りのときに `"fields":[<項目>]` が加わる(例 `{"result":"invalid","fields":["name","email","message"]}`)。

```sh
curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -H 'Accept: application/json' -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'name=<名前>' --data-urlencode 'email=<メールアドレス>' --data-urlencode 'message=<本文>' --data-urlencode 'cf-turnstile-response=<トークン>' -o "$EVIDENCE_DIR/<機能 ID>/<名前>" -w '%{http_code}\n' "$BASE/api/contact"
```

`name`・`email`・`message` が正しい値で `cf-turnstile-response` が空でなく 2048 文字以下の値(例 `dummy`)なら、403 と `{"result":"rejected"}` が返る。`wrangler.log` の `app.contact.outcome` は `turnstile_failed` になる。

Origin の検査を通った要求は 60 秒に 3 件まで受け付ける。4 件目からは 429 と `{"result":"limited"}` が返り、`app.contact.outcome` は `rate_limited` になる。3 件には項目の誤り(`invalid_fields`)と本文の誤り(`bad_body`)の要求も数える。同じ実行の中では、問い合わせのページのフォームからの送信も同じ上限の数に入る。

`POST /api/contact` は `Origin` が `https://mosidas.dev` でなければ 403(`bad_origin`)を返す。wrangler は `Origin` が `$BASE` と同じ要求だけ `Origin` を `https://mosidas.dev` に書き換える。そのため `Origin: $BASE` の要求(問い合わせのページから送る要求を含む)は Origin の検査を通る。`Origin` の無い要求と別の値(例 `https://evil.example`)の要求は 403(`bad_origin`)になる。ローカルで確かめられないのは `Origin: $BASE` の要求と `Origin: https://mosidas.dev` の要求の扱いの違いだけである。wrangler が前者を後者に書き換えるので、Worker は両者を同じに扱う。

Worker のログは `wrangler.log` から引く。wrangler は ANSI の色の制御文字を出すので、`grep` には `-a` を付ける。

```sh
grep -a '<キー>' "$EVIDENCE_DIR/wrangler.log"
```

`wrangler.log` には次の行が入る。

- 要求ごとに `[wrangler:info] <メソッド> <パス> <状態コード> <理由句> (<時間>)` の行が入る。
- Worker の JSON のログ(`info`・`warn`・`error`)が入る。
- 起動時の行が入る。この中に `/cdn-cgi/local/explorer/api/` を含む URL がある。

API への要求だけを数えるには `grep -a -c '\] [A-Z]* /api/' "$EVIDENCE_DIR/wrangler.log"` を使う。`grep -a -c '/api/'` は起動時の行も数える。

要求の行と Worker のログの行は、Worker が応答を返した後に遅れて書かれることがある。行の数が期待より少ないときは 1 秒ほど後に同じ `grep` を実行し直す。実行し直しても少なければ、要求が Worker に届いていないか、期待と違う結果になっている。行が無いこと(0 件)を証拠にするときは、最後に送った要求の行が `wrangler.log` に出たことを確かめてから数える。行が出る前に数えると、まだ書かれていない行が数に入らず 0 件になることがある。

## 4. 証拠

証拠は次の基準で取る。

- 利用者と同じ経路を通す。内部の setter とテスト専用のエンドポイントを使わない。
- 操作とその結果の状態の両方を取る。最後の画面だけでは足りない。
- 見えるものに加えて副作用を確かめる。このリポジトリでは `wrangler.log` の要求の行と Worker のログの行で確かめる。
- モックを使ってよいのは、本番のコードが外部のシステムを境界で切り離している箇所だけである。
- 安全な経路(dry-run やテスト用のモード)を使うときは、その経路が何を省くかをファイル・ネットワーク・git の参照の観測で確かめる。モードの名前から省く範囲を推測しない。
- 報告には、証拠ごとにサブ機能の ID と使った入口(機能に入る経路。browser の `open` のパスか curl で送ったパス)を書く。届かなかった入口は試したコマンドと満たせなかった前提を書いて報告する。別の入口で通したことを届かなかった入口の合格に数えない。

証拠は `$EVIDENCE_DIR/<機能 ID>/` に保存する。`$EVIDENCE_DIR` は `docs/verify/runs/<実行の ID>/evidence/` の絶対パスである。このリポジトリで取れる証拠は次の 4 種類である。

- `shot` のスクリーンショット(PNG)
- `text` で保存した `innerText`
- `wrangler.log` の行
- curl の状態コードと応答の本文

`wrangler.log` は up が、`browser.log` は browser が `evidence/` の直下に自動で残す。`browser.log` の各行には操作と出力先のパスが入るので、使った入口(`open` のパス)と機能 ID が分かる。

証拠のファイルに `.js`・`.ts`・`.mjs` のような JavaScript と TypeScript の拡張子を付けない。`tsconfig.json` の `include` が `**/*` なので、`npm run lint`(astro check)が `docs/verify/runs/` の中も検査する。`runs/` は `docs/verify/.gitignore` で git の管理から外してある。

## 5. 後始末

検証が終わったら、この実行のインスタンスを止める。`npm test`・コミット・push の前にも止める。`npm test` と pre-push の hook は `dist/` を作り直し、コミットは `HEAD` を変える。どちらも起動中の実行の健康診断を ng にする。

```sh
docs/verify/scripts/drive.mjs down "$RUN_ID"
```

down は止める対象をプロセスの名前でなく、記録した PID とその引数で選ぶ。手順は次のとおりである。

1. `chrome.pid` に記録した PID のプロセスが `--user-data-dir` にこの実行のプロファイルを持つ Chrome であれば止める。
2. `run.env` に記録した PID のプロセスグループの中身を確かめる。この実行のものと判定できなければ何も止めずに終わる。
3. そのグループに SIGTERM を送る。15 秒で終わらなければ SIGKILL を送る。
4. 2 つのポートに LISTEN が無いことを確かめる。
5. `data/`・`chrome/`・`chrome.pid`・`run.env` を削除する。
6. 残した証拠の一覧を出す。

`evidence/` は削除しない。成功すると `evidence: docs/verify/runs/<実行の ID>/evidence` と証拠のファイルの一覧が出て、終了コードは 0 である。

次のコマンドで後始末ができたことを確かめる。`ls` が `evidence` だけを出し、`git status --porcelain` に検証で作ったファイルが出なければ後始末ができている。

```sh
ls "docs/verify/runs/$RUN_ID"
git status --porcelain
```

down は次の行を出すことがある。`ng` で始まる行を出したときは終了コード 1 で終わる。それ以外の行だけのときは終了コード 0 で終わる。

| 出力 | 状態 | 対処 |
| :-- | :-- | :-- |
| `記録されたインスタンスはない` | `run.env` が無い。残りの一時ファイルを削除した | 不要 |
| `グループ <PID> は既に無い` | プロセスは既に終了していた。一時ファイルを削除した | 不要 |
| `グループ <PID> の wrangler が落ち、PORT <ポート> の workerd だけが残る` | wrangler が異常終了し、ポートを持つ workerd だけがグループに残っていた。down はそのグループを止めて一時ファイルを削除した | 不要 |
| `ng 停止: --user-data-dir=<プロファイル> の Chrome が残る` | この実行の Chrome が止まらない | `ps -ww -p "$(cat "docs/verify/runs/$RUN_ID/chrome.pid")"` で確かめてから down をやり直す。それでも残れば出力を報告する |
| `ng 停止: グループ <PID> かポート <ポート>・<ポート> が残る` | SIGKILL の後もプロセスかポートが残る | `ps -ww -g <PID>` と `lsof -nP -iTCP:<ポート> -sTCP:LISTEN` で残ったものを確かめ、出力を報告する |
| `ng プロセス: グループ <PID> に --persist-to <データ> のプロセスも PORT <ポート> の workerd もない。何も止めない` | グループの中身がこの実行のものと判定できない | 次の段落の手順で確かめる |

「何も止めない」で終わるのは、グループの中身がこの実行のものと判定できないときである。たとえばポートを持つ workerd が異常終了し、ポートを持たない workerd だけがグループに残ったときに起きる。次のコマンドでグループの中身を確かめる。

```sh
. "docs/verify/runs/$RUN_ID/run.env"
ps -ww -g "$PID" -o pid,command
```

出たプロセスがすべてこのリポジトリの `node_modules/@cloudflare/workerd-*/bin/workerd` であれば、この実行の workerd である。ほかのプロセスが出たときは止めずに、グループの中身を報告する。この実行の workerd だけのときは、そのグループに SIGTERM を送る。

```sh
kill -TERM -- "-$PID"
ps -ww -g "$PID" -o pid,command
```

`ps` が見出しの行(`PID COMMAND`)だけを出すまで `ps` を実行し直す。15 秒たっても見出しの行だけにならなければ、それ以上シグナルを送らずにグループの中身を報告する。見出しの行だけになったら down をやり直す。down は `グループ <PID> は既に無い` を出して一時ファイルを削除する。

```sh
docs/verify/scripts/drive.mjs down "$RUN_ID"
```

## 6. 補助スクリプト

補助スクリプトは `docs/verify/scripts/drive.mjs` の 1 本である。呼び方は `docs/verify/scripts/drive.mjs <サブコマンド> <実行の ID> [<操作> ...]` で、サブコマンドは次の 4 つである。サブコマンドか実行の ID が誤っていると `使い方: drive.mjs <up|doctor|browser|down> <実行の ID> [操作...]` を出して終了コード 2 で終わる。

| サブコマンド | 呼び方 | 出力 | 終了コード |
| :-- | :-- | :-- | :-- |
| `up` | `docs/verify/scripts/drive.mjs up "$RUN_ID"` | ビルドの出力の後に `ready https://localhost:<ポート>` | 0: 準備ができた。1: 準備ができないか、起動済みか、使用済みの実行の ID |
| `doctor` | `docs/verify/scripts/drive.mjs doctor "$RUN_ID"` | 6 項目の `ok`・`ng` の行と `BASE`・`COMMIT`・`EVIDENCE_DIR` | 0: すべて ok。1: ng がある |
| `browser` | `docs/verify/scripts/drive.mjs browser "$RUN_ID" <操作> [<操作> ...]` | 操作ごとに `<時刻> <操作と引数> ok` か `ng: <理由>` | 0: すべて ok。1: ng があるか、`run.env` が無いか、Chrome につながらない。2: 操作の書き方の誤り |
| `down` | `docs/verify/scripts/drive.mjs down "$RUN_ID"` | `evidence: docs/verify/runs/<実行の ID>/evidence` と証拠の一覧 | 0: 止めて後始末した。1: 止められない |
