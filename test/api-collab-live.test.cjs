'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(`D:/Multi-Agent/_runtime/tests/live-messages-${process.pid}`);
process.env.MULTI_AGENT_ROOT = root;
const { ApiCollabManager } = require('./load-ts.cjs')('src/main/apiCollab.ts');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const success = (content) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) });

test.after(() => {
  assert.equal(path.dirname(root), path.resolve('D:/Multi-Agent/_runtime/tests'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('private human persists and emits before provider finishes, with correlated reply', async () => {
  const manager = new ApiCollabManager();
  const project = manager.createProject('live-private');
  manager.saveProvider({ id: 'mock', name: 'mock', protocol: 'openai-compatible', baseUrl: 'https://mock.invalid/v1', apiKeyRef: '', defaultModel: 'mock', timeoutMs: 10000, enabled: true, retryPolicy: { maxRetries: 0 } });
  manager.setSecret('mock', 'offline-fixture');
  for (const id of ['gpt', 'claude']) manager.saveAgent({ id, displayName: id, providerId: 'mock', model: 'mock', enabled: true });
  const previous = global.fetch;
  let resolveFetch;
  global.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });
  const events = [];
  const unsubscribe = manager.onMessage((message) => events.push(message));
  try {
    const id = randomUUID();
    const pending = manager.sendPrivate({ projectId: project.id, agentId: 'gpt', messageId: id, content: 'offline delayed question' });
    await tick();
    assert.equal(events.length, 1);
    assert.equal(events[0].id, id);
    assert.equal(manager.snapshot(project.id).privateChats.gpt[0].id, id);
    resolveFetch(success('delayed reply'));
    const reply = await pending;
    assert.equal(reply.inReplyTo, id);
    assert.equal(events.length, 2);
    unsubscribe();
    manager.sendWorkgroup({ projectId: project.id, content: '@gpt after unsubscribe' });
    assert.equal(events.length, 2);
    assert.throws(() => manager.sendWorkgroup({ projectId: project.id, content: 'invalid', messageId: '../wrong' }), /消息 ID 无效/);
  } finally { global.fetch = previous; unsubscribe(); }
});

test('ordered group emits each reply while later agent is still pending', async () => {
  const manager = new ApiCollabManager();
  manager.setSecret('mock', 'offline-fixture');
  const project = manager.createProject('live-group');
  const pendingFetches = [];
  const previous = global.fetch;
  global.fetch = () => new Promise((resolve) => pendingFetches.push(resolve));
  const events = [];
  const unsubscribe = manager.onMessage((message) => events.push(message));
  try {
    const id = randomUUID();
    manager.sendWorkgroup({ projectId: project.id, messageId: id, content: '@gpt @claude answer in order', speakerOrder: ['gpt', 'claude'] });
    const pending = manager.runCycle(project.id);
    await tick();
    assert.equal(pendingFetches.length, 1);
    assert.equal(events.length, 1);
    pendingFetches[0](success('first reply'));
    await tick();
    assert.equal(pendingFetches.length, 2);
    assert.equal(events.length, 2);
    assert.equal(events[1].senderId, 'gpt');
    assert.equal(events[1].inReplyTo, id);
    pendingFetches[1](success('second reply'));
    const result = await pending;
    assert.equal(result.ok, true);
    assert.deepEqual(events.map((message) => message.senderId), ['human', 'gpt', 'claude']);
    assert(result.responses.every((message) => message.inReplyTo === id));
  } finally { global.fetch = previous; unsubscribe(); }
});

test('unordered workgroup and custom groups dispatch together and persist in completion order', async (t) => {
  for (const custom of [false, true]) await t.test(custom ? 'custom group' : 'workgroup', async () => {
    const rootManager = new ApiCollabManager();
    const project = rootManager.createProject('parallel-' + custom);
    const manager = rootManager.forProject(project.id);
    manager.saveProvider({ id: 'parallel', name: 'offline', protocol: 'openai-compatible', baseUrl: 'https://mock.invalid/v1', apiKeyRef: '', enabled: true, stream: false, retryPolicy: { maxRetries: 0 } });
    manager.setSecret('parallel', 'offline-fixture');
    for (const id of ['gpt', 'claude', 'outsider', 'disabled']) manager.saveAgent({ id, displayName: id, providerId: 'parallel', model: id, enabled: id !== 'disabled' && (id !== 'outsider' || custom) });
    const conversationId = custom ? manager.createGroup({ projectId: project.id, name: 'selected', memberAgentIds: ['gpt', 'claude', 'disabled'] }).id : 'workgroup';
    const message = { projectId: project.id, content: '@全体 independent answers', runtimeRole: '本轮各自分析' };
    const human = custom ? manager.sendGroup({ ...message, conversationId }) : manager.sendWorkgroup(message);
    const previous = global.fetch, requests = [], events = [];
    global.fetch = (_url, init) => new Promise(resolve => requests.push({ body: JSON.parse(init.body), resolve }));
    const unsubscribe = manager.onMessage(message => events.push(message));
    try {
      const pending = manager.runCycle(project.id, conversationId);
      await tick();
      assert.deepEqual(requests.map(request => request.body.model).sort(), ['claude', 'gpt']);
      assert(requests.every(request => request.body.messages.at(-1).content === human.content));
      requests.find(request => request.body.model === 'claude').resolve(success('fast claude'));
      await tick();
      assert.deepEqual(events.map(message => message.senderId), ['claude']);
      assert.equal(events[0].inReplyTo, human.id);
      requests.find(request => request.body.model === 'gpt').resolve(success('slow gpt'));
      const result = await pending;
      assert.equal(result.ok, true);
      assert.deepEqual(result.responses.map(message => message.senderId), ['claude', 'gpt']);
      const restored = new ApiCollabManager().forProject(project.id).snapshot(project.id);
      const log = custom ? restored.groupChats[conversationId] : restored.workgroup;
      assert.deepEqual(log.map(message => message.senderId), ['human', 'claude', 'gpt']);
      assert(result.responses.every(message => message.inReplyTo === human.id));
    } finally { global.fetch = previous; unsubscribe(); }
  });
});

test('one parallel provider failure does not stop or delay other replies', async () => {
  const rootManager = new ApiCollabManager();
  const project = rootManager.createProject('parallel-failure');
  const manager = rootManager.forProject(project.id);
  manager.setSecret('parallel', 'offline-fixture');
  for (const id of ['gpt', 'claude']) manager.saveAgent({ id, displayName: id, providerId: 'parallel', model: id, enabled: true });
  manager.sendWorkgroup({ projectId: project.id, content: '@gpt @claude answer' });
  const previous = global.fetch, requests = [];
  global.fetch = (_url, init) => new Promise((resolve, reject) => requests.push({ model: JSON.parse(init.body).model, resolve, reject }));
  try {
    const pending = manager.runCycle(project.id); await tick(); assert.equal(requests.length, 2);
    requests.find(request => request.model === 'claude').reject(new Error('offline relay disconnected'));
    await tick();
    assert.equal(manager.snapshot(project.id).workgroup.at(-1).status, 'error');
    requests.find(request => request.model === 'gpt').resolve(success('still finished'));
    const result = await pending; assert.equal(result.ok, true);
    assert.deepEqual(result.responses.map(message => message.status), ['error', 'complete']);
  } finally { global.fetch = previous; }
});

test('parallel history stays at the original turn even when context preparation is delayed', async () => {
  const rootManager = new ApiCollabManager();
  const project = rootManager.createProject('parallel-context');
  const manager = rootManager.forProject(project.id);
  manager.setSecret('parallel', 'offline-fixture');
  for (const id of ['gpt', 'claude']) manager.saveAgent({ id, displayName: id, providerId: 'parallel', model: id, enabled: true });
  manager.sendWorkgroup({ projectId: project.id, content: '@全体 identical current turn' });
  const originalCall = manager.performAgentCall.bind(manager);
  let releaseContext;
  const contextReady = new Promise(resolve => { releaseContext = resolve; });
  manager.performAgentCall = async (...args) => { if (args[0].id === 'claude') await contextReady; return originalCall(...args); };
  const previous = global.fetch, requests = [];
  global.fetch = async (_url, init) => { requests.push(JSON.parse(init.body)); return success('EARLY_RESPONSE_MUST_NOT_LEAK'); };
  try {
    const pending = manager.runCycle(project.id); await tick(); assert.equal(requests.length, 1);
    assert.equal(manager.snapshot(project.id).workgroup.at(-1).senderId, 'gpt');
    releaseContext(); await pending;
    assert.equal(requests.length, 2);
    assert(!JSON.stringify(requests[1].messages).includes('EARLY_RESPONSE_MUST_NOT_LEAK'));
  } finally { releaseContext(); global.fetch = previous; }
});

test('an explicitly incomplete order is rejected instead of silently becoming parallel', async () => {
  const rootManager = new ApiCollabManager();
  const project = rootManager.createProject('invalid-order');
  const manager = rootManager.forProject(project.id);
  for (const id of ['gpt', 'claude']) manager.saveAgent({ id, displayName: id, providerId: 'parallel', model: id, enabled: true });
  const previous = global.fetch; let calls = 0;
  global.fetch = async () => { calls++; throw new Error('must not call'); };
  try {
    for (const speakerOrder of [['gpt'], ['gpt', 'claude', 'gpt']]) {
      manager.sendWorkgroup({ projectId: project.id, content: '@全体 explicit order', speakerOrder });
      const result = await manager.runCycle(project.id); assert.equal(result.ok, false); assert.match(result.error, /发言顺序/);
    }
    assert.equal(calls, 0);
  } finally { global.fetch = previous; }
});

test('stream progress is transient; only final correlated reply is persisted', async () => {
  const manager = new ApiCollabManager();
  const provider = manager.providers().find((item) => item.id === 'mock');
  manager.saveProvider({ ...provider, stream: true });
  manager.setSecret('mock', 'offline-fixture');
  const project = manager.createProject('live-stream');
  const updates = [];
  const unsubscribe = manager.onStream((update) => updates.push(update));
  let controller;
  const original = global.fetch;
  global.fetch = async () => new Response(new ReadableStream({ start(value) { controller = value; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  try {
    const id = randomUUID();
    const pending = manager.sendPrivate({ projectId: project.id, agentId: 'gpt', messageId: id, content: 'stream offline' });
    await tick();
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'));
    await tick();
    assert.equal(updates[0].content, '第一段');
    assert.equal(updates[0].inReplyTo, id);
    assert.equal(manager.snapshot(project.id).privateChats.gpt.length, 1);
    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"，完成。"}}]}\n\ndata: [DONE]\n\n'));
    const reply = await pending;
    assert.equal(reply.content, '第一段，完成。');
    assert.equal(updates.at(-1).state, 'clear');
    assert.equal(manager.snapshot(project.id).privateChats.gpt.length, 2);
  } finally { global.fetch = original; unsubscribe(); }
});
