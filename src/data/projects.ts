// date はリポジトリの作成日(YYYY-MM-DD)、short は一覧の 1 行の説明
export type Project = { name: string; date: string; short: string; description: string; stack: string[]; url: string };

// description は「何をするものか」の 1 文で書く。技術スタックは stack に書き、description には書かない。
// 一覧と詳細の前後は date の新しい順
export const projects: Project[] = (
  [
    {
      name: 'launchpad-lite',
      date: '2026-09-26',
      short: 'ホットキーで動く macOS ランチャー',
      description:
        'アプリの検索と起動、ウィンドウの配置、スクリーンショットをホットキーで行う macOS 用のランチャー。',
      stack: ['Swift', 'SwiftPM', 'macOS'],
      url: 'https://github.com/mosidas/launchpad-lite',
    },
    {
      name: 'dev-skills',
      date: '2026-07-30',
      short: 'AI コーディング CLI 向けのスキル集',
      description:
        'Claude Code・Codex CLI・Antigravity CLI に、開発の手順と日本語文書の規範をスキルとサブエージェントとして提供するプラグイン。',
      stack: ['Markdown', 'Python'],
      url: 'https://github.com/mosidas/dev-skills',
    },
    {
      name: 'recognizer',
      date: '2026-07-12',
      short: 'ONNX で顔・物体を検出するライブラリ',
      description:
        'YOLO 形式の ONNX モデルで顔検出・顔認証・物体検出を行うライブラリ。',
      stack: ['C#', '.NET 10', 'ONNX Runtime', 'Avalonia'],
      url: 'https://github.com/mosidas/recognizer',
    },
    {
      name: 'lazy-finder',
      date: '2026-06-19',
      short: 'lazygit 風の TUI ファイラ',
      description:
        'macOS の Finder のカラムビューを lazygit 風の枠線 UI で操作する TUI ファイラ。',
      stack: ['Go', 'Bubble Tea'],
      url: 'https://github.com/mosidas/lazy-finder',
    },
    {
      name: 'nullops',
      date: '2026-08-12',
      short: '何もしない可視化デスクトップアプリ',
      description:
        '擬似的な作業ログと可視化パネルを 1 画面に並べるだけで、実際の処理は何も実行しないデスクトップアプリ。',
      stack: ['Go', 'Wails', 'TypeScript'],
      url: 'https://github.com/mosidas/nullops',
    },
    {
      name: 'rename',
      date: '2025-09-28',
      short: '一括リネームの macOS アプリ',
      description: 'ファイルをまとめてリネームする macOS 用のデスクトップアプリ。',
      stack: ['Go', 'Wails', 'Next.js', 'React'],
      url: 'https://github.com/mosidas/rename',
    },
  ] satisfies Project[]
).sort((a, b) => b.date.localeCompare(a.date));
