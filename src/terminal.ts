export type TerminalData = {
  projects: { name: string; date: string; short: string }[];
  articles: { title: string; date: string }[];
  news: { title: string; publishedAt: string }[];
};

export type Result = { kind: 'output'; lines: string[] } | { kind: 'clear' } | { kind: 'navigate'; href: string };

// 最長の正規コマンドは 20 文字前後で、echo の遊びに余裕を持たせた値
export const MAX_INPUT = 200;

const HELP: [string, string][] = [
  ['help', 'コマンドの一覧'],
  ['whoami', '名前'],
  ['cat about.txt', '自己紹介'],
  ['cat stack.txt', '使用技術'],
  ['ls', 'ファイルの一覧'],
  ['tail works.log', '制作物'],
  ['tail articles.log', '記事'],
  ['tail news.log', 'お知らせ'],
  ['cd <works|articles|contact|~>', 'ページを移動'],
  ['clear', '画面を消去'],
  ['echo <文字列>', '文字列を表示'],
  ['date', '現在の日時'],
  ['pwd', '現在の場所'],
];
const HELP_WIDTH = Math.max(...HELP.map(([c]) => c.length)) + 2;

// src/pages/index.astro の文と同じ
const FILES: Record<string, string> = {
  'about.txt': '名古屋でソフトウェアエンジニアをしています。',
  'stack.txt': 'Swift / Go / C# / TypeScript',
};

const PAGES: Record<string, string> = { works: '/works/', articles: '/articles/', contact: '/contact/', '~': '/' };

// sv-SE は YYYY-MM-DD の形で返す
const ymd = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' });
const fullDate = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'full', timeStyle: 'long', timeZone: 'Asia/Tokyo' });

function logLines(name: string, data: TerminalData): string[] | undefined {
  switch (name) {
    case 'works.log':
      return data.projects.map((p) => `${p.date} [${p.name}] ${p.short}`);
    case 'articles.log':
      return data.articles.length > 0
        ? data.articles.map((a) => `${ymd.format(new Date(a.date))} [zenn] ${a.title}`)
        : ['記事はまだない。'];
    case 'news.log':
      return data.news.length > 0
        ? data.news.map((n) => `${ymd.format(new Date(n.publishedAt))} ${n.title}`)
        : ['お知らせはまだない。'];
    default:
      return undefined;
  }
}

// 引数のファイルを順に読み、無いものはエラーの行にする(cat と tail で共通)
function readEach(cmd: string, args: string[], read: (name: string) => string[] | undefined): string[] {
  if (args.length === 0) return [`${cmd}: ファイル名を指定してください`];
  return args.flatMap((a) => read(a) ?? [`${cmd}: ${a}: No such file or directory`]);
}

const out = (...lines: string[]): Result => ({ kind: 'output', lines });

export function run(input: string, data: TerminalData, ctx: { path: string; now: Date }): Result {
  if (input.length > MAX_INPUT) return out(`入力は ${MAX_INPUT} 文字までです。`);
  const trimmed = input.trim();
  if (trimmed === '') return out();
  const [cmd, ...args] = trimmed.split(/\s+/);

  switch (cmd) {
    case 'help':
      return out(...HELP.map(([c, d]) => c.padEnd(HELP_WIDTH) + d));
    case 'whoami':
      return out('mosida');
    case 'cat':
      return out(...readEach('cat', args, (a) => (Object.hasOwn(FILES, a) ? [FILES[a]] : undefined)));
    case 'ls':
      return out('about.txt  stack.txt  works.log  articles.log  news.log  works/  articles/  contact/');
    case 'tail':
      return out(...readEach('tail', args, (a) => logLines(a, data)));
    case 'cd': {
      if (args.length > 1) return out('cd: too many arguments');
      const target = args.length === 0 ? '~' : args[0].replace(/\/+$/, '');
      return Object.hasOwn(PAGES, target)
        ? { kind: 'navigate', href: PAGES[target] }
        : out(`cd: no such file or directory: ${args[0]}`);
    }
    case 'clear':
      return { kind: 'clear' };
    case 'echo':
      return out(args.join(' '));
    case 'date':
      return out(fullDate.format(ctx.now));
    case 'pwd':
      return out('/home/mosida' + ctx.path.replace(/\/$/, ''));
    case 'sudo':
      return out('mosida is not in the sudoers file. This incident will be reported.');
    case 'rm':
      return out(
        args.some((a) => a.startsWith('-') && /[rR]/.test(a) && a.includes('f'))
          ? 'rm: 読み取り専用のサイトです。何も消えていません。'
          : 'rm: 読み取り専用のサイトです',
      );
    case 'exit':
      return out('exit: 終了するには、タブを閉じてください。');
    default:
      return out(`${cmd}: command not found`);
  }
}
