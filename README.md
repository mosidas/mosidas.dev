# mosidas.dev

個人で作ったソフトウェア・Zenn の記事・お知らせを載せる、mosida のポートフォリオサイト。

## 開発

1. Node.js 24.2 以上と betterleaks をインストールする。betterleaks は、コミットの前に秘密情報を検出する hook が使う。
2. リポジトリのルートで `npm ci` を実行する。git の hook が有効になる。

開発サーバー、lint、テストは次のコマンドで実行する。

```sh
npm run dev
npm run lint
npm test
```

本番のビルド(`npm run build`)とデプロイは、main への push を受けて Cloudflare が実行する。ビルドとデプロイの設定を変えるときは、[検証の記録](docs/verification.md) の「Git 連携の手順」に従う。
