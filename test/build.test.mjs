import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projects } from '../src/data/projects.ts';

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');

test('制作物の名前が決めた 6 件と順序まで一致する', () => {
  assert.deepEqual(
    projects.map((p) => p.name),
    ['launchpad-lite', 'dev-skills', 'recognizer', 'lazy-finder', 'nullops', 'rename'],
  );
});

test('すべての url が mosidas の GitHub リポジトリを指す', () => {
  for (const { url } of projects) {
    assert.match(url, /^https:\/\/github\.com\/mosidas\/[A-Za-z0-9._-]+$/);
  }
});

test('dist/index.html が各制作物の名前とリンクを含む', () => {
  for (const { name, url } of projects) {
    assert.ok(html.includes(name), `名前がない: ${name}`);
    assert.ok(html.includes(`href="${url}"`), `リンクがない: ${url}`);
  }
});

test('dist/index.html が script とインラインの style を含まない', () => {
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<style'));
});
