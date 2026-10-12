import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.ts';

const env = { ASSETS: { fetch: async () => new Response('asset') } };

test('http の要求を https://mosidas.dev へ 301 で転送する', async () => {
  const res = await worker.fetch(new Request('http://mosidas.dev/a?b=1'), env);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://mosidas.dev/a?b=1');
});

test('workers.dev の要求を https://mosidas.dev へ 301 で転送する', async () => {
  const res = await worker.fetch(new Request('https://mosidas-dev.example.workers.dev/a?b=1'), env);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://mosidas.dev/a?b=1');
});

test('https://mosidas.dev の要求はアセットの応答をそのまま返す', async () => {
  const res = await worker.fetch(new Request('https://mosidas.dev/'), env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'asset');
});

test('パスが // で始まっても転送先は mosidas.dev から外れない', async () => {
  const res = await worker.fetch(new Request('https://mosidas-dev.example.workers.dev//evil.example/x'), env);
  assert.equal(res.status, 301);
  assert.equal(new URL(res.headers.get('location')).hostname, 'mosidas.dev');
});

test('Host ヘッダーを偽っても転送先は mosidas.dev から外れない', async () => {
  const req = new Request('https://mosidas-dev.example.workers.dev//evil.example/x', {
    headers: { host: 'evil.example' },
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 301);
  assert.equal(new URL(res.headers.get('location')).hostname, 'mosidas.dev');
});
