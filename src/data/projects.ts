export type Project = { name: string; description: string; url: string };

export const projects: Project[] = [
  {
    name: 'launchpad-lite',
    description:
      'アプリの検索と起動、ウィンドウの配置、スクリーンショットをホットキーで行う macOS 用の小さなランチャー。Swift 製で、外付けマウスのボタンやファンクションキーの割り当ても設定できる。',
    url: 'https://github.com/mosidas/launchpad-lite',
  },
  {
    name: 'dev-skills',
    description:
      'Claude Code・Codex CLI・Antigravity CLI に、開発作業の手順と規範をスキルとサブエージェントとして提供するプラグイン。計画・実装・レビューのループと、日本語文書の自動検査を含む。',
    url: 'https://github.com/mosidas/dev-skills',
  },
  {
    name: 'recognizer',
    description:
      'YOLO 形式の ONNX モデルで顔検出・顔認証・物体検出を行う C# / .NET 10 のライブラリ。端末から呼び出す CLI と、検出結果を画像に重ねて確かめるデスクトップ GUI を同梱する。',
    url: 'https://github.com/mosidas/recognizer',
  },
  {
    name: 'lazy-finder',
    description:
      'macOS の Finder のカラムビューを、lazygit 風の枠線 UI で操作できるようにした TUI ファイラ。Go と Bubble Tea で作り、削除はゴミ箱への移動で行う。',
    url: 'https://github.com/mosidas/lazy-finder',
  },
  {
    name: 'nullops',
    description:
      '擬似的な作業ログとグラフなどの可視化パネルを 1 画面に並べて表示するデスクトップアプリ。見た目だけで、実際の処理は何も実行しない。',
    url: 'https://github.com/mosidas/nullops',
  },
  {
    name: 'rename',
    description: 'macOS 用のファイル一括リネームアプリ。Go と Wails で作り、DMG で配布している。',
    url: 'https://github.com/mosidas/rename',
  },
];
