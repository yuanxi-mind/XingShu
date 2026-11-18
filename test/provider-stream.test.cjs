const test = require('node:test');
const assert = require('node:assert/strict');
const { readProviderStream } = require('./load-ts.cjs')('src/main/providerStream.ts');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const encoder = new TextEncoder();
const event = (content) => 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\r\n\r\n';

test('SSE emits partial Chinese text before completion and handles split UTF-8', async () => {
  let controller;
  const response = new Response(new ReadableStream({ start(value) { controller = value; } }));
  const updates = [];
  const pending = readProviderStream(response, (value) => updates.push(value));
  const bytes = encoder.encode(event('正在检查遥感 baseline。'));
  for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
  await tick();
  assert.deepEqual(updates, ['正在检查遥感 baseline。']);
  controller.enqueue(encoder.encode(event('下一步做实验。') + 'data: [DONE]\n\n'));
  assert.equal(await pending, '正在检查遥感 baseline。下一步做实验。');
});

test('finish_reason without DONE is accepted; incomplete streams and invalid JSON fail', async () => {
  const success = new Response(event('完成') + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
  assert.equal(await readProviderStream(success, () => {}), '完成');
  await assert.rejects(readProviderStream(new Response(event('半截内容')), () => {}), /提前断开/);
  await assert.rejects(readProviderStream(new Response('data: {invalid}\n\n'), () => {}), /无效的流式 JSON/);
  await assert.rejects(readProviderStream(new Response('data: {"error":{"message":"无权限"}}\n\n'), () => {}), /无权限/);
});
