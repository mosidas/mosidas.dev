# 端末

端末では利用者がページの下端の入力欄にコマンドを入力して Enter を押す。Enter を押すと入力欄の上の履歴(`[role=log]`)に `❯ <入力>` の行と出力の行が加わる。`cd` は別のページへ移動する。`clear` は履歴を空にする。コマンドはブラウザーの中で処理される。端末は問い合わせの API(`/api/contact`)へ要求を送らない。

## サブ機能

- `shell-run`: コマンドを実行して入力の行と出力の行を履歴に加える。
- `shell-help`: `help` で 13 のコマンドと説明の一覧を出す。
- `shell-unknown`: `help` の一覧に無く `sudo`・`rm`・`exit` でもないコマンドに `<コマンド>: command not found` を出す。
- `shell-pwd`: `pwd` で開いているページに対応する場所(`/` は `/home/mosida`・`/works/` は `/home/mosida/works`・`/articles/` は `/home/mosida/articles`)を出す。
- `shell-cd`: `cd works`・`cd articles`・`cd contact`・`cd ~` でそれぞれ `/works/`・`/articles/`・`/contact/`・`/` へ移動する。引数の無い `cd` は `/` へ移動する。無いディレクトリには `cd: no such file or directory: <ディレクトリ>` を出す。引数を 2 つ以上渡すと `cd: too many arguments` を出す。
- `shell-clear`: `clear` で履歴を空にする。
- `shell-log`: `tail works.log` で制作物の一覧と同じ数の行を出す。記事とお知らせが無いときは `tail articles.log` が `記事はまだない。` を出し `tail news.log` が `お知らせはまだない。` を出す。

## 利用者からの到達

- `/` の下端の入力欄(ラベル `コマンド`・`#shell-input`)
- `/works/` の下端の同じ入力欄
- `/articles/` の下端の同じ入力欄

## 操作

前提:

- 共通の前提のとおり健康診断がすべて ok である。`run.env` を読み込んである。
- `src/data/zenn.json` と `src/data/news.json` が `[]` である。`/articles/` に `記事はまだない。` が出る。
- この実行で問い合わせ(`POST /api/contact`)の要求を送っていない。送っていると `wrangler.log` の `/api/` の要求の行の数が 0 にならない。

- **操作の前を撮る**: `/` を開いて何も入力していない状態を撮る。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open / until 'document.querySelector("#shell-input") && document.querySelector("[role=log]").childElementCount === 0' shot shell/before.png
  ```

  `shell/before.png` に入力欄の行(`❯` とカーソル)が写る。

- **端末のコマンドを実行する**(`shell-run`): `/` で `whoami` と入力して Enter を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open / until 'document.querySelector("#shell-input")' fill '#shell-input' whoami enter until 'document.querySelector("[role=log]").innerText.includes("mosida")' text '[role=log]' shell/history.txt shot shell/after.png
  ```

  `shell/history.txt` は `❯ whoami`・空行・`mosida` の 3 行である。`shell/before.png` と比べると `shell/after.png` では入力欄のすぐ上に `❯ whoami` と `mosida` の 2 行が加わっている。

- **一覧を出す**(`shell-help`): `/` で `help` と入力して Enter を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open / until 'document.querySelector("#shell-input")' fill '#shell-input' help enter until 'document.querySelector("[role=log]").innerText.split("\n").filter(Boolean).length === 14' text '[role=log]' shell/help.txt
  ```

  `shell/help.txt` から空行を除くと 14 行になる。1 行目は `❯ help` である。2〜14 行目は `help` から `pwd` までの 13 のコマンドと説明である。

- **未知のコマンドを入力する**(`shell-unknown`): `/` で `nowhere` と入力して Enter を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open / until 'document.querySelector("#shell-input")' fill '#shell-input' nowhere enter until 'document.querySelector("[role=log]").innerText.includes("nowhere: command not found")' text '[role=log]' shell/unknown.txt
  ```

  `shell/unknown.txt` の最後の行が `nowhere: command not found` である。

- **場所を出す: トップ**(`shell-pwd`): `/` で `pwd` と入力して Enter を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open / until 'document.querySelector("#shell-input")' fill '#shell-input' pwd enter until 'document.querySelector("[role=log]").innerText.trim().endsWith("\n/home/mosida")' text '[role=log]' shell/pwd-home.txt
  ```

  `shell/pwd-home.txt` の最後の行が `/home/mosida` である。

- **場所を出す: 制作物**(`shell-pwd`): `/works/` で `pwd` と入力して Enter を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /works/ until 'document.querySelector("#shell-input")' fill '#shell-input' pwd enter until 'document.querySelector("[role=log]").innerText.trim().endsWith("\n/home/mosida/works")' text '[role=log]' shell/pwd-works.txt
  ```

  `shell/pwd-works.txt` の最後の行が `/home/mosida/works` である。

- **場所を出す: 記事**(`shell-pwd`): `/articles/` で `pwd` と入力して Enter を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /articles/ until 'document.querySelector("#shell-input")' fill '#shell-input' pwd enter until 'document.querySelector("[role=log]").innerText.trim().endsWith("\n/home/mosida/articles")' text '[role=log]' shell/pwd-articles.txt
  ```

  `shell/pwd-articles.txt` の最後の行が `/home/mosida/articles` である。

- **ページを移動する**(`shell-cd`): `/` で `cd works` と入力して Enter を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open / until 'document.querySelector("#shell-input")' fill '#shell-input' 'cd works' enter until 'location.pathname === "/works/" && document.querySelector("#shell-input") && document.querySelector("[role=log]").childElementCount === 0' shot shell/cd-works.png
  ```

  `browser.log` の 2 つ目の `until` の行が ok である。この行は移った先が `/works/` で履歴が空であることを示す。`shell/cd-works.png` に制作物の一覧が写る。

- **無いディレクトリへ移動する**(`shell-cd`): `/` で `cd nowhere` と入力して Enter を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open / until 'document.querySelector("#shell-input")' fill '#shell-input' 'cd nowhere' enter until 'location.pathname === "/" && document.querySelector("[role=log]").innerText.includes("cd: no such file or directory: nowhere")' text '[role=log]' shell/cd-nowhere.txt
  ```

  ページは `/` のままである。`cd: no such file or directory: nowhere` の行が `shell/cd-nowhere.txt` の最後に入る。

- **履歴を空にする**(`shell-clear`): `/` で `whoami` と入力して Enter を押す。続けて `clear` と入力して Enter を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open / until 'document.querySelector("#shell-input")' fill '#shell-input' whoami enter until 'document.querySelector("[role=log]").innerText.includes("mosida")' fill '#shell-input' clear enter until 'document.querySelector("[role=log]").childElementCount === 0' shot shell/clear.png
  ```

  `browser.log` の `until document.querySelector("[role=log]").childElementCount === 0` の行が ok である。`shell/clear.png` の入力欄のすぐ上の行は `shell/before.png` と同じ `お知らせはまだない。` である。操作で加えた `❯ whoami`・`❯ clear` の行は写らない。

- **制作物のログを出す**(`shell-log`): `/works/` を開いて制作物の一覧を保存する。続けて `tail works.log` と入力して Enter を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /works/ until 'document.querySelector("#shell-input")' text main shell/works.txt fill '#shell-input' 'tail works.log' enter until 'document.querySelector("[role=log]").innerText.split("\n").filter(Boolean).length - 1 === document.querySelectorAll("a[href*=works]:not([aria-current])").length' text '[role=log]' shell/works-log.txt
  ```

  `browser.log` の 2 つ目の `until` の行が ok である。この行は出力の行の数が `/works/` の制作物のリンクの数と同じであることを示す。`shell/works-log.txt` から空行を除いた 2 行目以降は `<日付> [<名前>] <説明>` の形である。各行の `[<名前>]` は `shell/works.txt` の `[<名前>]` の行と同じ順に並ぶ。

- **記事のログを出す**(`shell-log`): `/articles/` で `tail articles.log` と入力して Enter を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /articles/ until 'document.querySelector("#shell-input")' fill '#shell-input' 'tail articles.log' enter until 'document.querySelector("[role=log]").innerText.includes("記事はまだない。")' text '[role=log]' shell/articles-log.txt
  ```

  `shell/articles-log.txt` の最後の行が `記事はまだない。` である。

- **お知らせのログを出す**(`shell-log`): `/` で `tail news.log` と入力して Enter を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open / until 'document.querySelector("#shell-input")' fill '#shell-input' 'tail news.log' enter until 'document.querySelector("[role=log]").innerText.includes("お知らせはまだない。")' text '[role=log]' shell/news-log.txt
  ```

  `shell/news-log.txt` の最後の行が `お知らせはまだない。` である。

- **API へ要求を送らないことを確かめる**: 上の操作をすべて終えた後に無いパス `/shell-marker/` へ目印の要求を 1 つ送る。目印の要求の行が `wrangler.log` に出てから `/api/` の要求の行を数える。次のコマンドを上から 1 行ずつ実行する。

  ```sh
  curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -o "$EVIDENCE_DIR/shell/marker.html" -w '%{http_code}\n' "$BASE/shell-marker/"
  grep -a 'GET /shell-marker/ 404' "$EVIDENCE_DIR/wrangler.log"
  grep -a -c '\] [A-Z]* /api/' "$EVIDENCE_DIR/wrangler.log"
  grep -a 'GET / 200' "$EVIDENCE_DIR/wrangler.log"
  ```

  curl は `404` を出す。残りの行は次のとおりに確かめる。

  - 2 行目のコマンドは `[wrangler:info] GET /shell-marker/ 404 Not Found` で始まる行を出す。目印の行は端末の操作の要求の行より後に書かれる。そのため、この行が出たことを確かめてから 3 行目のコマンドを実行する。2 行目のコマンドが何も出さなければ 1 秒ほど後に 2・3 行目のコマンドを実行し直す。
  - 3 行目のコマンドは `0` を出す。一致が無いので grep の終了コードは 1 である。
  - 4 行目のコマンドは `[wrangler:info] GET / 200 OK` の行を 1 行以上出す。この行は `wrangler.log` がページの要求を記録していることを示す。そのため、3 行目の `0` は要求が記録されていないことによる値ではない。

## 落とし穴

- 入力欄は JavaScript が template から挿入する。`fill` の前に `until 'document.querySelector("#shell-input")'` で入力欄があることを確かめる。
- ページには端末を操作する前から次の行が表示されている。スクリーンショットに次の行の文字が写っても実行の証拠にならない。判定は `[role=log]` の中(`text` で保存したファイルと `until` の式)で行う。
  - `/`: `❯ whoami`・`mosida`・`❯ cat about.txt`・`❯ cat stack.txt`・`❯ tail news.log`・`お知らせはまだない。`
  - `/works/`: `❯ tail works.log` と制作物ごとの `<日付> [<名前>] <説明>` の行(`tail works.log` の出力と同じ形)
  - `/articles/`: `❯ tail articles.log`・`記事はまだない。`
- `text` で保存した履歴のファイルでは行の間に空行が入る。行を数えるときは空行を除く。
- `sudo`・`rm`・`exit` は `help` の一覧に無いが `command not found` を出さない。未知のコマンドの確かめにはこの 3 つを使わない。3 つのコマンドは次の文を出す。
  - `sudo` は `mosida is not in the sudoers file. This incident will be reported.` を出す。
  - `rm` は `rm: 読み取り専用のサイトです。` を出す。`-rf` のように 1 つのオプションに `r` か `R` と `f` を含めると `rm: 読み取り専用のサイトです。何も消えていません。` を出す。
  - `exit` は `exit: 終了するには、タブを閉じてください。` を出す。
- 入力欄は 200 文字までしか受け付けない。`fill` で 201 文字以上を入力すると入力欄の値は先頭の 200 文字になる。200 文字を超えた入力に端末が出す文(`入力は 200 文字までです。`)は画面から確かめられない。
- 履歴には 1 回の入力ごとに `❯ <入力>` の行と出力の行の組が 1 件加わる。履歴は 100 件まで残る。101 件目が加わると最も古い 1 件が履歴から削除される。多くのコマンドを続けた後に `text` で保存したファイルは最初の入力の行を含まない。
- `cd` で移動するとブラウザーがページを読み込み直すので履歴は空に戻る。移動した後の操作は `until` で `#shell-input` を待ってから行う。
- 端末は問い合わせの API(`/api/contact`)へ要求を送らない。副作用が無いことは `wrangler.log` に API の要求の行が無いことで確かめる。`grep -a -c '/api/'` は wrangler の起動時の行(`/cdn-cgi/local/explorer/api/`)も数えるので使わない。
- 記事とお知らせが空のときは `tail articles.log` と `tail news.log` が一覧の行(`<日付> [zenn] <題>` と `<日付> <題>`)を出す経路に届かない。空の状態の文を一覧の経路の合格に数えない。届かなかった経路として報告する。
- `/privacy/`・`/works/<名前>/`・`/contact/`・エラーページには入力欄が無い。`cd contact` で `/contact/` へ移動した後は端末を操作できない。
