import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, MAX_INPUT } from '../src/terminal.ts';

const data = {
  projects: [
    { name: 'netdiver', date: '2026-09-26', short: 'ネットワークを潜るゲーム' },
    { name: 'recognizer', date: '2026-07-30', short: '画像の認識' },
  ],
  articles: [{ title: 'Astro で作る', date: '2026-10-01T15:30:00.000Z' }],
  news: [{ title: 'サイトを公開した', publishedAt: '2026-09-30T16:00:00.000Z' }],
};
const empty = { projects: [], articles: [], news: [] };
const ctx = { path: '/works/', now: new Date('2026-10-18T03:04:05Z') };
const lines = (input, d = data, c = ctx) => {
  const r = run(input, d, c);
  assert.equal(r.kind, 'output');
  return r.lines;
};

test('help は 13 コマンドの名前を含む一覧を返す', () => {
  const out = lines('help');
  assert.equal(out.length, 13);
  for (const name of ['help', 'whoami', 'cat about.txt', 'cat stack.txt', 'ls', 'tail works.log', 'tail articles.log', 'tail news.log', 'cd <dir>', 'clear', 'echo <text>', 'date', 'pwd']) {
    assert.ok(out.some((l) => l.startsWith(name + ' ')), name);
  }
  // 説明の列がそろう
  assert.equal(new Set(out.map((l) => l.search(/\S+$/))).size, 1);
});

test('未知のコマンドと大文字のコマンドは command not found を返す', () => {
  assert.deepEqual(lines('foo'), ['foo: command not found']);
  assert.deepEqual(lines('Help'), ['Help: command not found']);
});

test('HTML のような入力は command not found の文字列としてそのまま返る', () => {
  assert.deepEqual(lines('<img src=x onerror=alert(1)>'), ['<img: command not found']);
});

test('cd はページへの移動を返す', () => {
  for (const [input, href] of [
    ['cd works', '/works/'],
    ['cd articles', '/articles/'],
    ['cd contact', '/contact/'],
    ['cd works/', '/works/'],
    ['cd ~', '/'],
    ['cd', '/'],
  ]) {
    assert.deepEqual(run(input, data, ctx), { kind: 'navigate', href }, input);
  }
});

test('cd は未知の引数と 2 つ以上の引数をエラーにする', () => {
  assert.deepEqual(lines('cd foo'), ['cd: no such file or directory: foo']);
  assert.deepEqual(lines('cd works articles'), ['cd: too many arguments']);
});

test('whoami・cat・ls・echo・pwd・date が期待どおりの行を返す', () => {
  assert.deepEqual(lines('whoami'), ['mosida']);
  assert.deepEqual(lines('cat about.txt'), ['名古屋でソフトウェアエンジニアをしています。']);
  assert.deepEqual(lines('cat stack.txt about.txt'), ['Swift / Go / C# / TypeScript', '名古屋でソフトウェアエンジニアをしています。']);
  assert.deepEqual(lines('ls'), ['about.txt  stack.txt  works.log  articles.log  news.log  works/  articles/  contact/']);
  assert.deepEqual(lines('echo  hello   world '), ['hello world']);
  assert.deepEqual(lines('echo'), ['']);
  assert.deepEqual(lines('pwd'), ['/home/mosida/works']);
  assert.deepEqual(lines('pwd', data, { ...ctx, path: '/' }), ['/home/mosida']);
  assert.match(lines('date')[0], /^2026年10月18日日曜日 12:04:05/);
});

test('clear は clear を返す', () => {
  assert.deepEqual(run('clear', data, ctx), { kind: 'clear' });
});

test('tail は 3 つのログを日本時間の日付で返す', () => {
  assert.deepEqual(lines('tail works.log'), ['2026-09-26 [netdiver] ネットワークを潜るゲーム', '2026-07-30 [recognizer] 画像の認識']);
  assert.deepEqual(lines('tail articles.log'), ['2026-10-02 [zenn] Astro で作る']);
  assert.deepEqual(lines('tail news.log'), ['2026-10-01 サイトを公開した']);
});

test('tail は記事とお知らせが 0 件のときにその旨を返す', () => {
  assert.deepEqual(lines('tail articles.log', empty), ['記事はまだない。']);
  assert.deepEqual(lines('tail news.log', empty), ['お知らせはまだない。']);
});

test('cat と tail は引数の不備をエラーの行にする', () => {
  assert.deepEqual(lines('cat'), ['cat: ファイル名を指定してください']);
  assert.deepEqual(lines('cat nope.txt about.txt'), ['cat: nope.txt: No such file or directory', '名古屋でソフトウェアエンジニアをしています。']);
  assert.deepEqual(lines('cat toString'), ['cat: toString: No such file or directory']);
  assert.deepEqual(lines('tail'), ['tail: ファイル名を指定してください']);
  assert.deepEqual(lines('tail nope.log'), ['tail: nope.log: No such file or directory']);
});

test('上限ちょうどの日本語の入力を受理し、1 文字超えると上限の文だけを返す', () => {
  const ok = 'echo ' + 'あ'.repeat(MAX_INPUT - 5);
  assert.equal(ok.length, 200);
  assert.deepEqual(lines(ok), ['あ'.repeat(195)]);
  assert.deepEqual(lines(ok + 'あ'), ['入力は 200 文字までです。']);
});

test('空文字と空白だけの入力は何も出さない', () => {
  assert.deepEqual(run('', data, ctx), { kind: 'output', lines: [] });
  assert.deepEqual(run('   \t ', data, ctx), { kind: 'output', lines: [] });
});

test('sudo・rm・exit の小ネタを返す', () => {
  assert.deepEqual(lines('sudo rm -rf /'), ['mosida is not in the sudoers file. This incident will be reported.']);
  assert.deepEqual(lines('sudo'), ['mosida is not in the sudoers file. This incident will be reported.']);
  for (const flag of ['-rf', '-fr', '-Rf']) {
    assert.deepEqual(lines(`rm ${flag} /`), ['rm: 読み取り専用のサイトです。何も消えていません。'], flag);
  }
  assert.deepEqual(lines('rm about.txt'), ['rm: 読み取り専用のサイトです。']);
  assert.deepEqual(lines('rm -r about.txt'), ['rm: 読み取り専用のサイトです。']);
  assert.deepEqual(lines('exit'), ['exit: 終了するには、タブを閉じてください。']);
});
