# ページの閲覧と移動

利用者はヘッダーのナビ・制作物の一覧の行・制作物の詳細の前後のリンク・フッターのリンク・URL の直接入力でページを移る。移った先のページはナビの現在地(`aria-current="page"`)と見出し(`h1`)で分かる。制作物の詳細の前後は循環する。どの経路もページを読み込むだけで問い合わせの API(`/api/contact`)へ要求を送らない。

## サブ機能

- `pages-nav`: ヘッダーのナビ(`nav[aria-label="サイト内"]`)の top・works・articles・contact を押すと `/`・`/works/`・`/articles/`・`/contact/` へ移る。移った先のページではそのページを指すナビのリンクに `aria-current="page"` が付く。
- `pages-works`: `/works/` の一覧に制作物の行が 1 件以上ある。先頭の行を押すと `/works/<名前>/` へ移る。詳細の `h1` はその行の `[<名前>]` の名前である。
- `pages-pager`: 詳細の `前の制作物: <名前>`・`次の制作物: <名前>` のリンクで前後の制作物へ移る。前後は循環する。先頭の前は一覧の最後の行である。最後の次は先頭の行である。
- `pages-articles`: `/articles/` を開くと記事の一覧が出る。記事が無いときは `記事はまだない。` が出る。
- `pages-privacy`: フッターの `privacy policy` を押すと `/privacy/` へ移る。`h1` は `プライバシーポリシー` である。ナビのどのリンクにも `aria-current` が付かない。
- `pages-404`: 無いパスを開くと状態コード 404 で `h1` が `ページが見つかりませんでした` のページが返る。

## 利用者からの到達

- ヘッダーのナビのリンク(`nav[aria-label="サイト内"] a[href="/"]`・`a[href="/works/"]`・`a[href="/articles/"]`・`a[href="/contact/"]`)
- フッターのリンク(`a[href="/privacy/"]`)
- `/works/` の一覧の行(`a[href*=works]:not([aria-current])`)
- 制作物の詳細の前後のリンク(`a[aria-label^=前の制作物]`・`a[aria-label^=次の制作物]`)
- URL の直接入力(browser の `open` と curl)

## 操作

前提:

- 共通の前提のとおり健康診断がすべて ok である。`run.env` を読み込んである。
- `src/data/zenn.json` が `[]` である。`/articles/` に `記事はまだない。` が出る。
- この実行で問い合わせ(`POST /api/contact`)の要求を送っていない。
- ネットワークにつながっている。**ナビで移動する** が開く `/contact/` は Turnstile のウィジェットを `challenges.cloudflare.com` から読み込む。

- **ナビで移動する**(`pages-nav`): `/` からナビの works・articles・contact・top を順に押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open / click 'nav[aria-label="サイト内"] a[href="/works/"]' until 'location.pathname === "/works/" && document.querySelector("[aria-current=page]").getAttribute("href") === "/works/"' shot pages/nav-works.png click 'nav[aria-label="サイト内"] a[href="/articles/"]' until 'location.pathname === "/articles/" && document.querySelector("[aria-current=page]").getAttribute("href") === "/articles/"' shot pages/nav-articles.png click 'nav[aria-label="サイト内"] a[href="/contact/"]' until 'location.pathname === "/contact/" && document.querySelector("[aria-current=page]").getAttribute("href") === "/contact/"' shot pages/nav-contact.png click 'nav[aria-label="サイト内"] a[href="/"]' until 'location.pathname === "/" && document.querySelector("[aria-current=page]").getAttribute("href") === "/"' shot pages/nav-top.png
  ```

  4 つの `until` の行が `browser.log` で ok である。`pages/nav-works.png`・`pages/nav-articles.png`・`pages/nav-contact.png`・`pages/nav-top.png` では移った先のページを指すナビのリンクが反転した色で写る。

- **一覧から開く**(`pages-works`): `/works/` の一覧を保存してから先頭の行を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /works/ until 'document.querySelectorAll("a[href*=works]:not([aria-current])").length > 0' text main pages/works.txt click 'a[href*=works]:not([aria-current])' until 'location.pathname !== "/works/" && document.querySelector("h1").innerText === location.pathname.split("/")[2]' text h1 pages/work-first.txt shot pages/work-first.png
  ```

  `pages/works.txt` には `❯ tail works.log` の後に制作物ごとに日付・`[<名前>]`・説明の 3 行が並ぶ。`pages/work-first.txt` の名前は `pages/works.txt` の最初の `[<名前>]` の名前と同じである。`pages/work-first.png` に詳細の名前・説明・スクリーンショットが写る。

- **前後へ移る**(`pages-pager`): **一覧から開く** の後に行う。一覧の先頭の行の詳細から前の制作物へ移る。そこから次の制作物のリンクで一覧の先頭の行の制作物へ戻る。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /works/ click 'a[href*=works]:not([aria-current])' until 'location.pathname !== "/works/" && document.querySelector("h1").innerText === location.pathname.split("/")[2]' click 'a[aria-label^=前の制作物]' until 'new URL(document.referrer).pathname === document.querySelector("a[aria-label^=次の制作物]").getAttribute("href")' text h1 pages/pager-prev.txt click 'a[aria-label^=次の制作物]' until 'new URL(document.referrer).pathname === document.querySelector("a[aria-label^=前の制作物]").getAttribute("href")' text h1 pages/pager-next.txt
  ```

  `pages/pager-prev.txt` の名前は **一覧から開く** で保存した `pages/works.txt` の最後の `[<名前>]` の名前と同じである。`pages/pager-next.txt` の名前は同じ操作で保存した `pages/work-first.txt` と同じである。

- **記事の一覧を開く**(`pages-articles`): `/articles/` を開く。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /articles/ until 'document.querySelector("main").innerText.includes("記事はまだない。")' text main pages/articles.txt shot pages/articles.png
  ```

  `pages/articles.txt` は `記事`・`❯ tail articles.log`・`記事はまだない。` の行を含む。`[zenn]` の行は含まない。

- **プライバシーポリシーを開く**(`pages-privacy`): `/` でフッターの `privacy policy` を押す。この操作を次のコマンドで行う。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open / click 'a[href="/privacy/"]' until 'location.pathname === "/privacy/"' until '!document.querySelector("[aria-current]")' text h1 pages/privacy.txt shot pages/privacy.png
  ```

  `pages/privacy.txt` は `プライバシーポリシー` の 1 行である。2 つ目の `until` の行が `browser.log` で ok である。この行はナビのどのリンクにも `aria-current` が付かないことを示す。

- **無いページを開く**(`pages-404`): 無いパス `/no-such-page/` を curl で要求する。同じパスを browser で開く。この操作を次のコマンドで行う。

  ```sh
  curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -o "$EVIDENCE_DIR/pages/404.html" -w '%{http_code}\n' "$BASE/no-such-page/"
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /no-such-page/ until 'document.querySelector("h1").innerText === "ページが見つかりませんでした"' text h1 pages/404.txt shot pages/404.png
  ```

  curl は `404` を出す。`pages/404.txt` は `ページが見つかりませんでした` の 1 行である。`pages/404.png` に `cat: page.html: No such file or directory` の行が写る。

- **API へ要求を送らないことを確かめる**: 上の操作をすべて終えた後に `wrangler.log` を調べる。次のコマンドを上から 1 行ずつ実行する。

  ```sh
  grep -a 'GET /no-such-page/ 404' "$EVIDENCE_DIR/wrangler.log"
  grep -a -c '\] [A-Z]* /api/' "$EVIDENCE_DIR/wrangler.log"
  ```

  1 行目のコマンドは `[wrangler:info] GET /no-such-page/ 404 Not Found` で始まる行を 2 行出す。2 行は **無いページを開く** の curl と browser の要求の行である。この機能で最後に送った要求に当たる。1 行目のコマンドが 2 行を出さなければ 1 秒ほど後に 1 行目のコマンドを実行し直す。2 行が出たことを確かめてから 2 行目のコマンドを実行する。2 行目のコマンドは `0` を出す。

## 落とし穴

- 前後のリンクを押した後は `h1` とパスの一致だけでは移った後のページか見分けられない。移る前のページも同じ条件を満たすためである。移った先の逆向きのリンク(前へ移ったときは次の制作物のリンク)が移る前のページ(`document.referrer`)を指すことを `until` で待つ。
- 制作物の件数と名前を決まった値で書かない。一覧は `src/data/projects.ts` から作られるので件数と名前は `pages/works.txt` の行と比べる。
- `/works/` の一覧ではナビの works のリンクにだけ `aria-current` が付く。`a[href*=works]:not([aria-current])` は一覧の行だけに一致する。詳細のページでは前後のリンクにも一致するので詳細では前後のリンクの `aria-label` を使う。
- 外部へのリンクを押さない。次のリンクは新しいタブで外部のサイトを開く。browser は新しいタブを操作しないので押しても観測できない。
  - 制作物の詳細の `open` のリンク
  - 記事の一覧の行
  - フッターの GitHub と Zenn のアイコン
  - プライバシーポリシーの Cloudflare のリンク
- 記事が無いときは記事の一覧の行(`<日付> [zenn] <題>`)の経路に届かない。空の状態の文 `記事はまだない。` を一覧の経路の合格に数えない。届かなかった経路として `pages-articles` のコマンドと満たせなかった前提(`src/data/zenn.json` に記事がある)を報告する。
- `http://` から `https://` への 301 と workers.dev から `https://mosidas.dev` への 301 には届かない。up は wrangler に `--local-upstream mosidas.dev --local-protocol https` を渡すので Worker が受け取る要求の URL は常に `https://mosidas.dev` である。届かなかった経路として 2 つの 301 と満たせなかった前提(Worker が受け取る要求の URL が `http://` か workers.dev のホストである)を報告する。この経路を試すコマンドは無い。
