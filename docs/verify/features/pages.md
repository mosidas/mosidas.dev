# ページの閲覧と移動

利用者はヘッダーのナビ・一覧の行・詳細の前後のリンク・フッターのリンク・URL の直接入力でページを移る。移った先のページはナビの現在地(`aria-current="page"`)と見出し(`h1`)で分かる。制作物の詳細の前後は循環する。どの経路もページを読み込むだけで、問い合わせの API へ要求を送らない。

## サブ機能

- `pages-nav`: ヘッダーのナビ(`nav[aria-label="サイト内"]`)の top・works・articles・contact を押すと、`/`・`/works/`・`/articles/`・`/contact/` へ移り、移った先のリンクに `aria-current="page"` が付く。
- `pages-works`: `/works/` の一覧に制作物の行が 1 件以上あり、先頭の行を押すと `/works/<名前>/` へ移る。詳細の `h1` はその行の `[<名前>]` の名前である。
- `pages-pager`: 詳細の `前の制作物: <名前>`・`次の制作物: <名前>` のリンクで前後の制作物へ移る。前後は循環し、先頭の前は一覧の最後の行、最後の次は先頭の行である。
- `pages-articles`: `/articles/` に記事の一覧を出す。記事が無いときは `記事はまだない。` を出す。
- `pages-privacy`: フッターの `privacy policy` を押すと `/privacy/` へ移り、`h1` が `プライバシーポリシー` になる。ナビのどのリンクにも `aria-current` が付かない。
- `pages-404`: 無いパスは状態コード 404 で、`h1` が `ページが見つかりませんでした` のページを返す。

## 利用者からの到達

- ヘッダーのナビのリンク(`nav[aria-label="サイト内"] a[href="/"]`・`a[href="/works/"]`・`a[href="/articles/"]`・`a[href="/contact/"]`)
- フッターのリンク(`a[href="/privacy/"]`)
- `/works/` の一覧の行(`a[href*=works]:not([aria-current])`)
- 制作物の詳細の前後のリンク(`a[aria-label^=前の制作物]`・`a[aria-label^=次の制作物]`)
- URL の直接入力(browser の `open` と curl)

## 操作

前提:

- 共通の前提のとおり健康診断がすべて ok で、`run.env` を読み込んである。
- `src/data/zenn.json` が `[]` である。`/articles/` に `記事はまだない。` が出る。

- **ナビで移動する**(`pages-nav`): `/` からナビの works・articles・contact・top を順に押す。次のコマンドを実行する。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open / click 'nav[aria-label="サイト内"] a[href="/works/"]' until 'location.pathname === "/works/" && document.readyState === "complete" && document.querySelector("[aria-current=page]").getAttribute("href") === "/works/"' shot pages/nav-works.png click 'nav[aria-label="サイト内"] a[href="/articles/"]' until 'location.pathname === "/articles/" && document.readyState === "complete" && document.querySelector("[aria-current=page]").getAttribute("href") === "/articles/"' shot pages/nav-articles.png click 'nav[aria-label="サイト内"] a[href="/contact/"]' until 'location.pathname === "/contact/" && document.readyState === "complete" && document.querySelector("[aria-current=page]").getAttribute("href") === "/contact/"' shot pages/nav-contact.png click 'nav[aria-label="サイト内"] a[href="/"]' until 'location.pathname === "/" && document.readyState === "complete" && document.querySelector("[aria-current=page]").getAttribute("href") === "/"' shot pages/nav-top.png
  ```

  4 つの `until` の行が `browser.log` で ok である。`pages/nav-works.png`・`pages/nav-articles.png`・`pages/nav-contact.png`・`pages/nav-top.png` では、移った先のナビの項目が反転した色で写る。

- **一覧から開く**(`pages-works`): `/works/` の一覧を保存してから先頭の行を押す。次のコマンドを実行する。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /works/ until 'document.querySelectorAll("a[href*=works]:not([aria-current])").length > 0' text main pages/works.txt click 'a[href*=works]:not([aria-current])' until 'location.pathname !== "/works/" && document.readyState === "complete" && document.querySelector("h1").innerText === location.pathname.split("/")[2]' text h1 pages/work-first.txt shot pages/work-first.png
  ```

  `pages/works.txt` には `❯ tail works.log` の後に、制作物ごとに日付・`[<名前>]`・説明の 3 行が並ぶ。`pages/work-first.txt` の名前は、`pages/works.txt` の最初の `[<名前>]` の名前と同じである。`pages/work-first.png` に詳細の名前・説明・スクリーンショットが写る。

- **前後へ移る**(`pages-pager`): 一覧の先頭の詳細から前の制作物へ移り、そこから次の制作物へ戻る。次のコマンドを実行する。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /works/ click 'a[href*=works]:not([aria-current])' until 'location.pathname !== "/works/" && document.readyState === "complete" && document.querySelector("h1").innerText === location.pathname.split("/")[2]' click 'a[aria-label^=前の制作物]' until 'document.readyState === "complete" && new URL(document.referrer).pathname === document.querySelector("a[aria-label^=次の制作物]").getAttribute("href")' text h1 pages/pager-prev.txt click 'a[aria-label^=次の制作物]' until 'document.readyState === "complete" && new URL(document.referrer).pathname === document.querySelector("a[aria-label^=前の制作物]").getAttribute("href")' text h1 pages/pager-next.txt
  ```

  `pages/pager-prev.txt` の名前は `pages/works.txt` の最後の `[<名前>]` の名前と同じである。`pages/pager-next.txt` の名前は `pages/work-first.txt` と同じである。

- **記事の一覧を開く**(`pages-articles`): `/articles/` を開く。次のコマンドを実行する。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /articles/ until 'document.querySelector("main").innerText.includes("記事はまだない。")' text main pages/articles.txt shot pages/articles.png
  ```

  `pages/articles.txt` は `記事`・`❯ tail articles.log`・`記事はまだない。` の行を含み、`[zenn]` の行を含まない。

- **プライバシーポリシーを開く**(`pages-privacy`): `/` でフッターの `privacy policy` を押す。次のコマンドを実行する。

  ```sh
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open / click 'a[href="/privacy/"]' until 'location.pathname === "/privacy/" && document.readyState === "complete"' until '!document.querySelector("[aria-current]")' text h1 pages/privacy.txt shot pages/privacy.png
  ```

  `pages/privacy.txt` は `プライバシーポリシー` の 1 行である。2 つ目の `until` の行が `browser.log` で ok である。

- **無いページを開く**(`pages-404`): 無いパスを curl で要求し、ブラウザーで開く。次のコマンドを実行する。

  ```sh
  curl -sk --create-dirs -H 'Origin: https://mosidas.dev' -o "$EVIDENCE_DIR/pages/404.html" -w '%{http_code}\n' "$BASE/no-such-page/"
  docs/verify/scripts/drive.mjs browser "$RUN_ID" open /no-such-page/ until 'document.querySelector("h1").innerText === "ページが見つかりませんでした"' text h1 pages/404.txt shot pages/404.png
  ```

  curl は `404` を出す。`pages/404.txt` は `ページが見つかりませんでした` の 1 行である。`pages/404.png` に `cat: page.html: No such file or directory` の行が写る。

- **要求を送らないことを確かめる**: 上の操作をすべて終えた後に `wrangler.log` を調べる。次のコマンドを実行する。

  ```sh
  grep -a -c '\] [A-Z]* /api/' "$EVIDENCE_DIR/wrangler.log"
  grep -a 'GET /no-such-page/ 404' "$EVIDENCE_DIR/wrangler.log"
  ```

  問い合わせの操作をする前なら、1 行目のコマンドは `0` を出す。2 行目のコマンドは `[wrangler:info] GET /no-such-page/ 404 Not Found` で始まる行を 2 行出す。

## 落とし穴

- `click` の後の `until` には `document.readyState === "complete"` の条件を書く。読み込みが終わる前のページへ次の `click` を送ると、ページが移らないことがある。そのときは次の `until` が 15 秒で ng になる。
- 前後のリンクを押した後は、`h1` とパスの一致だけでは移った後のページか見分けられない。移る前のページも同じ条件を満たすためである。移った先の逆向きのリンクが移る前のページ(`document.referrer`)を指すことを `until` で待つ。
- 制作物の件数と名前を決まった値で書かない。一覧は `src/data/projects.ts` から作られるので、件数と名前は `pages/works.txt` の行と比べる。
- `/works/` の一覧では、ナビの works のリンクにだけ `aria-current` が付く。`a[href*=works]:not([aria-current])` は一覧の行だけに一致する。詳細のページでは前後のリンクにも一致するので、詳細では前後のリンクの `aria-label` を使う。
- 外部へのリンクを押さない。制作物の詳細の `open`、記事の行、フッターの GitHub・Zenn のアイコン、プライバシーポリシーの Cloudflare のリンクは新しいタブで外部のサイトを開く。browser は新しいタブを操作しないので、押しても観測できない。
- 記事が無いときは記事の一覧の行(`<日付> [zenn] <題>`)の経路に届かない。空の状態の文を一覧の経路の合格に数えない。届かなかった経路として報告する。
- `http://` から `https://` への 301 と、workers.dev から `https://mosidas.dev` への 301 には届かない。up は wrangler に `--local-upstream mosidas.dev --local-protocol https` を渡すので、Worker が受け取る要求の URL は常に `https://mosidas.dev` である。
- ナビで移動する操作は `/contact/` を開く。`/contact/` は Turnstile のウィジェットを `challenges.cloudflare.com` から読み込むので、この操作はネットワークにつながった状態で行う。
