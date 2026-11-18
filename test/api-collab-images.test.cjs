'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const root = path.resolve(`D:/Multi-Agent/_runtime/tests/image-routing-${process.pid}`);
process.env.MULTI_AGENT_ROOT = root;
const loadTs = require('./load-ts.cjs');
const { ApiCollabManager } = loadTs('src/main/apiCollab.ts');
const { agentApiMode } = loadTs('src/shared/apiCollab.ts');
const { readGeneratedImage } = loadTs('src/main/providerImages.ts');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ahtsAAAAASUVORK5CYII=', 'base64');
const imageResponse = (extra = {}) => new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64'), ...extra }] }), { headers: { 'Content-Type': 'application/json' } });
function fixture(name, model = 'gpt-image-2.5-sunburst', apiMode) {
  const manager = new ApiCollabManager();
  const project = manager.createProject(name);
  manager.saveProvider({ id: 'images', name: 'offline', protocol: 'openai-compatible', baseUrl: 'https://offline.invalid/v1', apiKeyRef: '', defaultModel: 'gpt-6-sol', enabled: true, timeoutMs: 1000, stream: true, retryPolicy: { maxRetries: 3, backoffMs: 0 } });
  manager.setSecret('images', 'offline-only-key');
  manager.saveAgent({ id: 'gpt', displayName: 'GPT', providerId: 'images', model, apiMode, reasoningEffort: 'max', enabled: true });
  if (agentApiMode(model, apiMode) === 'image') manager.setDefaultImageAgent('gpt');
  return { manager, project };
}
test.after(() => {
  assert.equal(path.dirname(root), path.resolve('D:/Multi-Agent/_runtime/tests'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('image families auto-route; relay aliases have explicit per-agent overrides', () => {
  for (const model of ['gpt-image-2.5', 'gpt-image-2.5-sunburst', 'vendor/gpt-image-1', 'dall-e-3']) assert.equal(agentApiMode(model), 'image');
  for (const model of ['gpt-6.1-sol', 'gemini-chat', 'some-gpt-image-model']) assert.equal(agentApiMode(model), 'chat');
  assert.equal(agentApiMode('private-image-alias', 'image'), 'image');
  assert.equal(agentApiMode('gpt-image-2.5', 'chat'), 'chat');
  assert.throws(() => fixture('bad-mode', 'model', 'invalid'), /请求接口类型无效/);
});

test('image request uses correct endpoint, excludes chat-only fields and preserves immediate human ack', async () => {
  const { manager, project } = fixture('private-image');
  const original = global.fetch;
  let resolve;
  const calls = [];
  const events = [];
  const stop = manager.onMessage((message) => events.push(message));
  global.fetch = (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return new Promise((done) => { resolve = done; }); };
  try {
    const application = await manager.sendPrivate({ projectId: project.id, agentId: 'gpt', content: '生成一张想象人物头像' });
    assert.equal(events[0].senderId, 'human');
    assert.equal(calls.length, 0);
    assert.equal(application.inReplyTo, events[0].id);
    const pending = manager.approveImageJob(project.id, application.imageJobId, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://offline.invalid/v1/images/generations');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer offline-only-key');
    assert.deepEqual(calls[0].body, { model: 'gpt-image-2.5-sunburst', prompt: '生成一张想象人物头像', n: 1 });
    resolve(imageResponse());
    const job = await pending;
    assert.equal(job.status, 'complete');
    const reply = events.at(-1);
    assert.equal(reply.imageJobId, application.imageJobId);
    assert.equal(reply.images.length, 1);
    assert.match(reply.images[0].path, /^AgentChats\/gpt\/data\/images\/.+\.png$/);
    assert.deepEqual(fs.readFileSync(path.join(project.root, reply.images[0].path)), png);
    assert.equal(events.length, 3);
    const persisted = new ApiCollabManager().snapshot(project.id).privateChats.gpt.at(-1);
    assert.deepEqual(persisted.images, reply.images);
    const history = fs.readFileSync(path.join(project.root, 'AgentChats/gpt/messages.jsonl'), 'utf8');
    assert(!history.includes(png.toString('base64')));
    assert(!history.includes('offline-only-key'));
    assert.equal(manager.snapshot(project.id).workgroup.length, 0);
  } finally { global.fetch = original; stop(); }
});

test('workgroup and custom group images save under different project-scoped folders', async () => {
  const { manager, project } = fixture('group-images');
  const previous = global.fetch;
  global.fetch = async () => imageResponse();
  try {
    manager.sendWorkgroup({ projectId: project.id, content: '@GPT 画一张图', speakerOrder: ['gpt'] });
    const shared = await manager.runCycle(project.id);
    assert.equal(shared.ok, true);
    const sharedJob = await manager.approveImageJob(project.id, shared.responses[0].imageJobId, 1);
    assert.equal(sharedJob.status, 'complete');
    assert.match(sharedJob.items[0].resultPath, /^WorkGroup\/artifacts\/images\//);
    const group = manager.createGroup({ projectId: project.id, name: '设计小组', memberAgentIds: ['gpt'] });
    manager.sendGroup({ projectId: project.id, conversationId: group.id, content: '@GPT 再画一张', speakerOrder: ['gpt'] });
    const grouped = await manager.runCycle(project.id, group.id);
    assert.equal(grouped.ok, true);
    const groupJob = await manager.approveImageJob(project.id, grouped.responses[0].imageJobId, 1);
    assert(groupJob.items[0].resultPath.startsWith(`groups/${group.id}/artifacts/images/`));
    assert.notEqual(sharedJob.items[0].resultPath, groupJob.items[0].resultPath);
  } finally { global.fetch = previous; }
});

test('manual image alias routes correctly; forced chat remains supported; DALL-E requests base64', async () => {
  const previous = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return url.endsWith('/chat/completions') ? new Response(JSON.stringify({ choices: [{ message: { content: 'chat fixture' } }] }), { headers: { 'Content-Type': 'application/json' } }) : imageResponse();
  };
  try {
    for (const [name, model, mode] of [['alias', 'custom-avatar', 'image'], ['force-chat', 'relay-chat-alias', 'chat'], ['dalle', 'dall-e-3', 'auto']]) {
      const { manager, project } = fixture(name, model, mode);
      const response = await manager.sendPrivate({ projectId: project.id, agentId: 'gpt', content: 'offline' });
      if (response.imageJobId) assert.equal((await manager.approveImageJob(project.id, response.imageJobId, 1)).status, 'complete');
    }
    assert(calls[0].url.endsWith('/images/generations'));
    assert(calls[1].url.endsWith('/chat/completions'));
    assert.equal(calls[1].body.reasoning_effort, 'max');
    assert.equal(calls[2].body.response_format, 'b64_json');
  } finally { global.fetch = previous; }
});

test('failed image requests are never automatically resubmitted or persisted as success', async () => {
  const previous = global.fetch;
  try {
    for (const status of [400, 429, 500]) {
      let count = 0;
      global.fetch = async () => { count++; return new Response('offline endpoint error', { status }); };
      const { manager, project } = fixture(`error-${status}`);
      const response = await manager.sendPrivate({ projectId: project.id, agentId: 'gpt', content: 'offline' });
      const job = await manager.approveImageJob(project.id, response.imageJobId, 1);
      assert.equal(job.status, 'failed');
      assert.match(job.error, new RegExp(`images/generations.*${status}`));
      assert.equal(count, 1);
      const messages = manager.snapshot(project.id).privateChats.gpt;
      assert.equal(messages.at(-1).imageJobId, job.id);
      assert.equal(messages.at(-1).images, undefined);
    }
  } finally { global.fetch = previous; }
});

test('network failures and timeouts explain uncertainty without repeating paid image calls', async () => {
  const previous = global.fetch;
  try {
    for (const [name, error, expected] of [['network', new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }), /ECONNRESET.*未自动重试/], ['timeout', new DOMException('timeout', 'AbortError'), /超时.*避免重复计费/]]) {
      let count = 0;
      global.fetch = async () => { count++; throw error; };
      const { manager, project } = fixture(name);
      const response = await manager.sendPrivate({ projectId: project.id, agentId: 'gpt', content: 'offline' });
      const job = await manager.approveImageJob(project.id, response.imageJobId, 1);
      assert.equal(job.status, 'failed');
      assert.match(job.error, expected);
      assert.equal(count, 1);
    }
  } finally { global.fetch = previous; }
});

test('invalid image JSON, error payloads, base64 and non-image bytes fail explicitly', async () => {
  const signal = new AbortController().signal;
  for (const [body, expected] of [['<html>502</html>', /有效 JSON/], [{ error: { message: 'model denied' } }, /model denied/], [{ data: [] }, /未返回图片/], [{ data: [{ b64_json: '<invalid>' }] }, /Base64/], [{ data: [{ b64_json: Buffer.from('<script>no</script>').toString('base64') }] }, /不是支持的/]]) {
    await assert.rejects(readGeneratedImage(new Response(typeof body === 'string' ? body : JSON.stringify(body)), signal), expected);
  }
});

test('returned public image URLs download without credentials and are validated before saving', async () => {
  const previous = https.get;
  let count = 0;
  https.get = (url, options, done) => {
    count++;
    assert.equal(url.hostname, '8.8.8.8');
    assert.equal(options.headers, undefined);
    assert.equal(options.family, 4);
    options.lookup('ignored', {}, (_err, address) => assert.equal(address, '8.8.8.8'));
    const request = new EventEmitter();
    queueMicrotask(() => {
      const response = new PassThrough();
      response.statusCode = 200; response.headers = { 'content-length': String(png.length) };
      done(response); response.end(png);
    });
    return request;
  };
  try {
    const result = await readGeneratedImage(new Response(JSON.stringify({ data: [{ url: 'https://8.8.8.8/offline-fixture.png' }] })), new AbortController().signal);
    assert.deepEqual(result.bytes, png);
    assert.equal(result.extension, 'png');
    assert.equal(count, 1);
  } finally { https.get = previous; }
});

test('image download rejects file/http/private addresses, including redirect targets', async () => {
  const signal = new AbortController().signal;
  for (const url of ['file:///C:/secret', 'http://8.8.8.8/a.png', 'https://127.0.0.1/a.png', 'https://10.1.2.3/a.png', 'https://[::ffff:127.0.0.1]/a.png', 'https://[::1]/a.png']) {
    await assert.rejects(readGeneratedImage(new Response(JSON.stringify({ data: [{ url }] })), signal), /公开 HTTPS|本机或内网/);
  }
  const previous = https.get;
  https.get = (_url, _options, done) => {
    const request = new EventEmitter();
    queueMicrotask(() => { const response = new PassThrough(); response.statusCode = 302; response.headers = { location: 'https://127.0.0.1/secret' }; done(response); response.end(); });
    return request;
  };
  try { await assert.rejects(readGeneratedImage(new Response(JSON.stringify({ data: [{ url: 'https://8.8.8.8/redirect' }] })), signal), /本机或内网/); }
  finally { https.get = previous; }
});
