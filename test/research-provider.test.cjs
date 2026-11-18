'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runResearchProvider } = require('./load-ts.cjs')('src/main/researchProvider.ts');

const tool = { type: 'function', function: { name: 'write_note', description: 'Offline fixture', parameters: { type: 'object' } } };
const call = (id = 'one', name = 'write_note', args = '{}') => ({ id, type: 'function', function: { name, arguments: args } });
const reply = (content, calls) => new Response(JSON.stringify({ choices: [{ message: { content, ...(calls ? { tool_calls: calls } : {}) } }] }), { headers: { 'content-type': 'application/json' } });
function options(overrides = {}) {
  return {
    provider: { id: 'offline', name: 'Offline fixture', protocol: 'openai-compatible', enabled: true, baseUrl: 'https://offline.invalid/v1', apiKeyRef: '', defaultModel: 'fixture-model', timeoutMs: 1000, retryPolicy: { maxRetries: 1, backoffMs: 0 } },
    agent: { id: 'fixture-agent', displayName: 'Fixture', providerId: 'offline', enabled: true, reasoningEffort: 'high' },
    apiKey: 'offline-not-a-real-key', system: 'Offline fixture only', prompt: 'Read and save a note', tools: [tool], execute: async () => ({ ok: true }), ...overrides
  };
}
function mockFetch(t, responses) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://offline.invalid/v1/chat/completions', 'never call a live provider');
    assert.equal(init.redirect, 'error');
    requests.push(JSON.parse(init.body));
    assert.ok(responses.length, 'unexpected provider request');
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return typeof response === 'function' ? response(url, init) : response;
  });
  return requests;
}
const image = (size = 40) => {
  const bytes = Buffer.alloc(size);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  return 'data:image/png;base64,' + bytes.toString('base64');
};

test('research provider follows assistant/tool protocol and retries only the followup request', async t => {
  const requests = mockFetch(t, [reply('Read first', [call()]), new Response('fixture retry', { status: 503 }), reply('Complete')]);
  let executions = 0;
  assert.equal(await runResearchProvider(options({ execute: async (name, args) => { executions++; assert.equal(name, 'write_note'); assert.deepEqual(args, {}); return { ok: true, reference: 'private/note.md' }; } })), 'Complete');
  assert.equal(executions, 1, 'a successful tool must not replay on HTTP retry');
  assert.equal(requests.length, 3);
  assert.equal(requests[0].reasoning_effort, 'high');
  assert.deepEqual(requests[1], requests[2]);
  assert.deepEqual(requests[2].messages.slice(-2).map(item => item.role), ['assistant', 'tool']);
  assert.equal(requests[2].messages.at(-1).tool_call_id, 'one');
  assert.equal(JSON.parse(requests[2].messages.at(-1).content).reference, 'private/note.md');
});

test('research provider validates the whole batch before any mutation', async t => {
  const variants = [
    ['unknown tool', [call('valid'), call('bad', 'not_available')]],
    ['invalid JSON', [call('valid'), call('bad', 'write_note', '{')]],
    ['array arguments', [call('valid'), call('bad', 'write_note', '[]')]],
    ['null arguments', [call('valid'), call('bad', 'write_note', 'null')]],
    ['oversized arguments', [call('valid'), call('bad', 'write_note', 'x'.repeat(260001))]],
    ['duplicate ID', [call('same'), call('same')]],
    ['wrong type', [call('valid'), { ...call('bad'), type: 'unsupported' }]],
    ['too many tools', Array.from({ length: 9 }, (_, index) => call(String(index)))]
  ];
  for (const [name, calls] of variants) await t.test(name, async child => {
    const requests = mockFetch(child, [reply('', calls)]);
    let executions = 0;
    await assert.rejects(runResearchProvider(options({ execute: async () => { executions++; } })), /未执行/);
    assert.equal(executions, 0); assert.equal(requests.length, 1);
  });
});

test('research provider rejects tool IDs replayed in later rounds', async t => {
  mockFetch(t, [reply('', [call()]), reply('', [call()])]);
  let executions = 0;
  await assert.rejects(runResearchProvider(options({ execute: async () => { executions++; return { ok: true }; } })), /标识重复/);
  assert.equal(executions, 1);
});

test('research provider stops on tool failure without retrying the request or tool', async t => {
  const requests = mockFetch(t, [reply('', [call()])]);
  let executions = 0;
  await assert.rejects(runResearchProvider(options({ execute: async () => { executions++; throw new Error('offline tool refused'); } })), /offline tool refused/);
  assert.equal(executions, 1); assert.equal(requests.length, 1);
});

test('research provider enforces round caps without declaring success', async t => {
  const requests = mockFetch(t, [reply('', [call('one')]), reply('', [call('two')])]);
  let executions = 0;
  await assert.rejects(runResearchProvider(options({ maxRounds: 2, execute: async () => { executions++; return { ok: true }; } })), /2 轮上限.*未确认完成/);
  assert.equal(requests.length, 2); assert.equal(executions, 2);
});

test('research provider clamps requested rounds to 32', async t => {
  const requests = mockFetch(t, Array.from({ length: 32 }, (_, index) => reply('', [call('round-' + index)])));
  let executions = 0;
  await assert.rejects(runResearchProvider(options({ maxRounds: 100, execute: async () => { executions++; return 'ok'; } })), /32 轮上限/);
  assert.equal(requests.length, 32); assert.equal(executions, 32);
});

test('research provider fails clearly when tools are rejected, without chat fallback', async t => {
  const requests = mockFetch(t, [new Response('tool_choice unsupported', { status: 422 })]);
  await assert.rejects(runResearchProvider(options()), /不支持研究工具调用/);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].tools);
});

test('research provider caps HTTP retries at two and hides the provider key', async t => {
  const base = options();
  const requests = mockFetch(t, Array.from({ length: 3 }, () => new Response('fixture ' + base.apiKey, { status: 503 })));
  await assert.rejects(runResearchProvider({ ...base, provider: { ...base.provider, retryPolicy: { maxRetries: 99, backoffMs: 0 } } }), error => {
    assert.match(error.message, /HTTP 503/); assert.ok(!error.message.includes(base.apiKey)); return true;
  });
  assert.equal(requests.length, 3);
});

test('research provider aborts timed out requests before any tool execution', async t => {
  const base = options();
  let calls = 0, executions = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://offline.invalid/v1/chat/completions'); calls++;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('fixture timeout'), { name: 'AbortError' })), { once: true }));
  });
  await assert.rejects(runResearchProvider({ ...base, provider: { ...base.provider, timeoutMs: 5 }, execute: async () => { executions++; } }), /超时/);
  assert.equal(calls, 2); assert.equal(executions, 0);
});

test('research provider supports fragmented SSE tools and onDelta resets', async t => {
  const sse = chunks => new Response(chunks.map(chunk => 'data: ' + (typeof chunk === 'string' ? chunk : JSON.stringify(chunk)) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
  const requests = mockFetch(t, [sse([
    { choices: [{ delta: { content: 'Checking', tool_calls: [{ index: 0, id: 'sse-one', function: { name: 'write_', arguments: '{"value":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'note', arguments: '1}' } }] }, finish_reason: 'tool_calls' }] }, '[DONE]'
  ]), sse([{ choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }] }, '[DONE]'])]);
  const base = options(); const deltas = []; let executions = 0;
  assert.equal(await runResearchProvider({ ...base, provider: { ...base.provider, stream: true }, onDelta: value => deltas.push(value), execute: async (name, args) => { executions++; assert.equal(name, 'write_note'); assert.deepEqual(args, { value: 1 }); return 'saved'; } }), 'Done');
  assert.equal(executions, 1); assert.equal(requests.length, 2);
  assert.deepEqual(deltas, ['', 'Checking', '', 'Done']);
});

test('research provider does not execute tools from an incomplete stream', async t => {
  const base = options(); let executions = 0;
  const requests = mockFetch(t, [new Response('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'incomplete', function: { name: 'write_note', arguments: '{}' } }] } }] }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } })]);
  await assert.rejects(runResearchProvider({ ...base, provider: { ...base.provider, stream: true }, execute: async () => { executions++; } }), /提前断开/);
  assert.equal(executions, 0); assert.equal(requests.length, 1);
});

test('research provider bounds serialized tool results', async t => {
  const requests = mockFetch(t, [reply('', [call()]), reply('Done')]);
  await runResearchProvider(options({ execute: async () => ({ text: 'x'.repeat(120000) }) }));
  const text = requests[1].messages.at(-1).content;
  assert.ok(text.length <= 100000); assert.match(text, /已截断/);
});

test('research provider appends images after all tool replies and strips imageUrl from JSON', async t => {
  const imageUrl = image();
  const requests = mockFetch(t, [reply('', [call('one'), call('two')]), reply('Vision complete')]);
  assert.equal(await runResearchProvider(options({ execute: async () => ({ reference: 'private/figure.png', text: 'fixture image', imageUrl, nextOffset: 3, hash: 'fixture-hash' }) })), 'Vision complete');
  const messages = requests[1].messages;
  assert.deepEqual(messages.slice(-4).map(message => message.role), ['assistant', 'tool', 'tool', 'user']);
  for (const message of messages.filter(message => message.role === 'tool')) {
    const value = JSON.parse(message.content);
    assert.equal(value.imageUrl, undefined); assert.equal(value.nextOffset, 3); assert.equal(value.hash, 'fixture-hash'); assert.ok(!message.content.includes('base64'));
  }
  const parts = messages.at(-1).content;
  assert.equal(parts.filter(part => part.type === 'image_url').length, 2);
  assert.equal(parts.find(part => part.type === 'image_url').image_url.url, imageUrl);
  assert.match(parts[0].text, /private\/figure\.png/);
});

test('research provider enforces image count across rounds', async t => {
  const requests = mockFetch(t, [reply('', [call('one'), call('two'), call('three')]), reply('', [call('four'), call('five')])]);
  let executions = 0;
  await assert.rejects(runResearchProvider(options({ execute: async () => { executions++; return { imageUrl: image() }; } })), /最多读取 4/);
  assert.equal(executions, 5); assert.equal(requests.length, 2);
});

test('research provider rejects oversized, remote and mislabeled images', async t => {
  const cases = [
    ['total bytes', image(8 * 1024 * 1024 + 1), /8 MB/],
    ['remote URL', 'https://must-not-fetch.invalid/image.png', /Base64/],
    ['wrong magic', 'data:image/jpeg;base64,' + Buffer.alloc(24).toString('base64'), /类型不符/]
  ];
  for (const [name, imageUrl, error] of cases) await t.test(name, async child => {
    const requests = mockFetch(child, [reply('', [call()])]);
    await assert.rejects(runResearchProvider(options({ execute: async () => ({ imageUrl }) })), error);
    assert.equal(requests.length, 1);
  });
});
