export type Project = { name: string; description: string; stack: string[]; url: string };

// description は「何をするものか」の 1 文と、特徴の 1 文で書く。技術スタックは stack に書き、description には書かない。
export const projects: Project[] = [
  {
    name: 'launchpad-lite',
    description:
      'アプリの検索と起動、ウィンドウの配置、スクリーンショットをホットキーで行う macOS 用のランチャー。外付けマウスのボタンとファンクションキーにも操作を割り当てられる。',
    stack: ['Swift', 'SwiftPM', 'macOS'],
    url: 'https://github.com/mosidas/launchpad-lite',
  },
  {
    name: 'dev-skills',
    description:
      'Claude Code・Codex CLI・Antigravity CLI に、開発の手順と文書の規範をスキルとサブエージェントとして提供するプラグイン。計画・実装・レビューのループと、日本語文書の自動検査を含む。',
    stack: ['Markdown', 'Python'],
    url: 'https://github.com/mosidas/dev-skills',
  },
  {
    name: 'recognizer',
    description:
      'YOLO 形式の ONNX モデルで顔検出・顔認証・物体検出を行うライブラリ。端末から呼び出す CLI と、検出結果を画像に重ねて確かめるデスクトップ GUI を同梱する。',
    stack: ['C#', '.NET 10', 'ONNX Runtime', 'Avalonia'],
    url: 'https://github.com/mosidas/recognizer',
  },
  {
    name: 'lazy-finder',
    description:
      'macOS の Finder のカラムビューを、lazygit 風の枠線 UI で操作する TUI ファイラ。削除はゴミ箱への移動で行う。',
    stack: ['Go', 'Bubble Tea'],
    url: 'https://github.com/mosidas/lazy-finder',
  },
  {
    name: 'nullops',
    description:
      '擬似的な作業ログと可視化パネルを 1 画面に並べて表示するデスクトップアプリ。見た目だけで、実際の処理は何も実行しない。',
    stack: ['Go', 'Wails', 'TypeScript'],
    url: 'https://github.com/mosidas/nullops',
  },
  {
    name: 'rename',
    description: 'ファイルをまとめてリネームする macOS 用のデスクトップアプリ。DMG で配布している。',
    stack: ['Go', 'Wails', 'Next.js', 'React'],
    url: 'https://github.com/mosidas/rename',
  },
];
