'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(`D:/Multi-Agent/_runtime/tests/image-approval-${process.pid}`);
process.env.MULTI_AGENT_ROOT = root;
const { ApiCollabManager } = require('./load-ts.cjs')('src/main/apiCollab.ts');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ahtsAAAAASUVORK5CYII=', 'base64');
const image = () => new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { headers: { 'Content-Type': 'application/json' } });
let sequence = 0;
function fixture() {
  const manager = new ApiCollabManager();
  const project = manager.createProject('approval-' + ++sequence);
  manager.saveProvider({ id: 'relay', name: 'offline', protocol: 'openai-compatible', baseUrl: 'https://offline.invalid/v1', apiKeyRef: '', defaultModel: 'gpt-6-sol', enabled: true, stream: false, timeoutMs: 10000, retryPolicy: { maxRetries: 0 } });
  manager.setSecret('relay', 'offline-key');
  manager.saveAgent({ id: 'gpt', displayName: 'GPT', providerId: 'relay', model: 'gpt-image-2.5', apiMode: 'image', enabled: true });
  manager.saveAgent({ id: 'claude', displayName: 'Claude', providerId: 'relay', model: 'offline-chat', apiMode: 'chat', enabled: true });
  manager.setDefaultImageAgent('gpt');
  return { manager, project };
}
function request(manager, project, count = 1, items) {
  return manager.requestImageJob({ projectId: project.id, requestedByAgentId: 'claude', channel: 'private', conversationId: 'private:claude', purpose: '离线审批测试', items: items || Array.from({ length: count }, (_, index) => ({ prompt: 'offline image ' + index })) });
}
test.after(() => { assert.equal(path.dirname(root), path.resolve('D:/Multi-Agent/_runtime/tests')); fs.rmSync(root, { recursive: true, force: true }); });

test('request, view, cancel and manager restart cause zero paid image requests', async () => {
  const { manager, project } = fixture();
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return image(); };
  try {
    const job = request(manager, project, 3);
    assert.equal(job.status, 'pending');
    assert.equal(new ApiCollabManager().snapshot(project.id).imageStudio.jobs[0].items.length, 3);
    manager.cancelImageJob(project.id, job.id);
    await assert.rejects(manager.approveImageJob(project.id, job.id, 3), /不能重复批准/);
    assert.equal(calls, 0);
  } finally { global.fetch = original; }
});

test('approval freezes count; duplicate clicks cannot duplicate calls; exactly approved images finish', async () => {
  const { manager, project } = fixture();
  const original = global.fetch;
  let count = 0;
  let firstResolve;
  global.fetch = () => { count++; return count === 1 ? new Promise((resolve) => { firstResolve = resolve; }) : Promise.resolve(image()); };
  try {
    const job = request(manager, project, 2);
    await assert.rejects(manager.approveImageJob(project.id, job.id, 1), /张数.*不一致/);
    assert.equal(count, 0);
    const pending = manager.approveImageJob(project.id, job.id, 2);
    assert.equal(count, 1);
    await assert.rejects(manager.approveImageJob(project.id, job.id, 2), /不能重复批准/);
    firstResolve(image());
    const result = await pending;
    assert.equal(result.status, 'complete');
    assert.equal(result.approvedCount, 2);
    assert.equal(count, 2);
    assert(result.items.every((item) => item.status === 'complete'));
    assert.equal(manager.snapshot(project.id).privateChats.claude.filter((message) => message.images).length, 2);
    await assert.rejects(manager.approveImageJob(project.id, job.id, 2), /不能重复批准/);
    assert.equal(count, 2);
  } finally { global.fetch = original; }
});

test('changing model/provider after preview invalidates approval with zero image calls', async () => {
  const { manager, project } = fixture();
  const job = request(manager, project);
  const agent = manager.agents().find((item) => item.id === 'gpt');
  manager.saveAgent({ ...agent, model: 'gpt-image-changed' });
  const previous = global.fetch;
  global.fetch = async () => { throw new Error('must not call provider'); };
  try { await assert.rejects(manager.approveImageJob(project.id, job.id, 1), /配置已经变化/); }
  finally { global.fetch = previous; }
});

test('forcing a known image model or default image alias to chat cannot bypass approval', async () => {
  const { manager, project } = fixture();
  const original = global.fetch;
  global.fetch = async () => { throw new Error('No provider request is authorized'); };
  try {
    manager.saveAgent({ ...manager.agents().find((agent) => agent.id === 'gpt'), apiMode: 'chat' });
    const result = await manager.sendPrivate({ projectId: project.id, agentId: 'gpt', content: '画图' });
    // An invalid default is rejected before paying, rather than falling back to chat.
    assert(result.imageJobId);
  } catch (error) { assert.match(String(error), /默认生图助手的请求类型/); }
  finally { global.fetch = original; }
});

test('stopping a running batch permits the in-flight image but no next request', async () => {
  const { manager, project } = fixture();
  const previous = global.fetch;
  let resolve;
  let calls = 0;
  global.fetch = () => { calls++; return new Promise((done) => { resolve = done; }); };
  try {
    const job = request(manager, project, 3);
    const pending = manager.approveImageJob(project.id, job.id, 3);
    manager.cancelImageJob(project.id, job.id);
    resolve(image());
    const result = await pending;
    assert.equal(result.status, 'cancelled');
    assert.equal(result.items.filter((item) => item.status === 'complete').length, 1);
    assert.equal(calls, 1);
  } finally { global.fetch = previous; }
});

test('failure stops remaining images, retains success, and requires a new explicit approval', async () => {
  const { manager, project } = fixture();
  const previous = global.fetch;
  let calls = 0;
  global.fetch = async () => ++calls === 2 ? new Response('offline busy', { status: 500 }) : image();
  try {
    const job = request(manager, project, 3);
    const result = await manager.approveImageJob(project.id, job.id, 3);
    assert.equal(result.status, 'failed');
    assert.equal(calls, 2);
    assert.deepEqual(result.items.map((item) => item.status), ['complete', 'failed', 'pending']);
    assert(fs.existsSync(path.join(project.root, result.items[0].resultPath)));
    const restarted = new ApiCollabManager();
    restarted.snapshot(project.id);
    await assert.rejects(restarted.approveImageJob(project.id, job.id, 3), /不能重复批准/);
    assert.equal(calls, 2);
    const retry = request(manager, project, 2, result.items.filter((item) => item.status !== 'complete').map(({ prompt }) => ({ prompt })));
    assert.equal(retry.status, 'pending');
    assert.equal(calls, 2);
  } finally { global.fetch = previous; }
});

test('process interruption marks uncertain requests; no automatic resume or re-approval', async () => {
  const { manager, project } = fixture();
  const job = request(manager, project);
  const file = path.join(project.root, 'runs/image-jobs.json');
  const jobs = JSON.parse(fs.readFileSync(file));
  Object.assign(jobs[0], { status: 'running', executionToken: 'previous-process', approvedAt: new Date().toISOString(), approvedCount: 1 });
  jobs[0].items[0].status = 'running';
  fs.writeFileSync(file, JSON.stringify(jobs));
  const recovered = new ApiCollabManager().snapshot(project.id).imageStudio.jobs[0];
  assert.equal(recovered.status, 'interrupted');
  assert.equal(recovered.items[0].status, 'unknown');
  await assert.rejects(manager.approveImageJob(project.id, job.id, 1), /不能重复批准/);
});

test('separate image agent preserves chat model and keys; 10 adult portrait/background prompts stay pending', () => {
  const { manager, project } = fixture();
  const providersBefore = fs.readFileSync(path.join(root, '_runtime/api-providers.json'), 'utf8');
  fs.rmSync(path.join(root, '_runtime/image-studio.json'));
  assert.equal(manager.setupImageStudio(), 'image-generator');
  assert.equal(manager.agents().find((agent) => agent.id === 'gpt').model, 'gpt-6-sol');
  assert.equal(manager.agents().find((agent) => agent.id === 'image-generator').model, 'gpt-image-2.5');
  assert.equal(fs.readFileSync(path.join(root, '_runtime/api-providers.json'), 'utf8'), providersBefore);
  const batch = manager.requestPortraitBatch(project.id);
  assert.equal(batch.items.length, 10);
  assert.equal(batch.status, 'pending');
  assert.equal(batch.items.filter((item) => item.assetKind === 'avatar').length, 5);
  assert.equal(batch.items.filter((item) => item.assetKind === 'background').length, 5);
  assert(batch.items.every((item) => item.prompt.includes('25岁') && item.status === 'pending'));
  assert(batch.items.filter((item) => item.assetKind === 'background').every((item) => item.size === '1536x1024'));
});

test('approved avatar/background files persist on D and remain outside shared model context', async () => {
  const { manager, project } = fixture();
  const previous = global.fetch;
  global.fetch = async () => image();
  try {
    const job = request(manager, project, 2, [{ prompt: 'offline avatar', targetAgentId: 'claude', assetKind: 'avatar' }, { prompt: 'offline background', targetAgentId: 'claude', assetKind: 'background' }]);
    assert.equal((await manager.approveImageJob(project.id, job.id, 2)).status, 'complete');
    const visuals = new ApiCollabManager().snapshot(project.id).imageStudio.visuals;
    assert(visuals.avatars.claude.startsWith('_runtime/appearance/assets/claude-avatar-'));
    assert(visuals.backgrounds.claude.startsWith('_runtime/appearance/assets/claude-background-'));
    assert.deepEqual(fs.readFileSync(path.join(root, visuals.avatars.claude)), png);
    const originalAvatar = visuals.avatars.claude;
    const replacement = request(manager, project, 1, [{ prompt: 'new avatar', targetAgentId: 'claude', assetKind: 'avatar' }]);
    await manager.approveImageJob(project.id, replacement.id, 1);
    assert(fs.existsSync(path.join(root, originalAvatar)));
    assert.notEqual(manager.snapshot(project.id).imageStudio.visuals.avatars.claude, originalAvatar);
    assert.equal(manager.snapshot(project.id).workgroup.length, 0);
  } finally { global.fetch = previous; }
});

test('chat agent tool only stages approval; approved output uses the default image model', async () => {
  const { manager, project } = fixture();
  const previous = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body });
    if (url.endsWith('/images/generations')) return image();
    assert.equal(body.tools[0].function.name, 'request_image_generation');
    return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'request_image_generation', arguments: JSON.stringify({ prompts: ['an adult fashion portrait'], purpose: '头像草图' }) } }] } }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const response = await manager.sendPrivate({ projectId: project.id, agentId: 'claude', content: '帮我生成一张头像' });
    assert.equal(calls.length, 1);
    assert(calls[0].url.endsWith('/chat/completions'));
    assert(response.imageJobId);
    assert.equal(manager.snapshot(project.id).imageStudio.jobs.at(-1).status, 'pending');
    const result = await manager.approveImageJob(project.id, response.imageJobId, 1);
    assert.equal(result.status, 'complete');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.model, 'gpt-image-2.5');
    assert.equal(calls[1].body.n, 1);
    const output = manager.snapshot(project.id).privateChats.claude.at(-1);
    assert.equal(output.generatedByAgentId, 'gpt');
    assert(output.images[0].path.startsWith('AgentChats/claude/data/images/'));
  } finally { global.fetch = previous; }
});

test('streamed tool argument fragments stage one pending job without calling images', async () => {
  const { manager, project } = fixture();
  manager.saveProvider({ ...manager.providers().find((item) => item.id === 'relay'), stream: true });
  const previous = global.fetch;
  let calls = 0;
  const argumentsText = JSON.stringify({ prompts: ['一位明确成年女性的时尚头像'] });
  const events = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-stream', function: { name: 'request_image_generation', arguments: argumentsText.slice(0, 10) } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: argumentsText.slice(10) } }] }, finish_reason: 'tool_calls' }] }
  ];
  global.fetch = async (url) => { calls++; assert(url.endsWith('/chat/completions')); return new Response(events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }); };
  try {
    const response = await manager.sendPrivate({ projectId: project.id, agentId: 'claude', content: '画一张头像' });
    assert(response.imageJobId);
    assert.equal(calls, 1);
    assert.equal(manager.snapshot(project.id).imageStudio.jobs.at(-1).items[0].prompt, '一位明确成年女性的时尚头像');
  } finally { global.fetch = previous; }
});

test('unknown approval tools cannot execute generation; unsupported tools fall back to normal chat', async () => {
  const { manager, project } = fixture();
  const previous = global.fetch;
  let count = 0;
  global.fetch = async (url, init) => {
    count++; assert(url.endsWith('/chat/completions'));
    const body = JSON.parse(init.body);
    if (body.tools) return new Response('tools is not supported', { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '普通聊天仍然可用' } }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.equal((await manager.sendPrivate({ projectId: project.id, agentId: 'claude', content: '你好' })).content, '普通聊天仍然可用');
    assert.equal(count, 2);
    global.fetch = async (url) => { assert(url.endsWith('/chat/completions')); return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ function: { name: 'approve_image_job', arguments: '{}' } }] } }] })); };
    await assert.rejects(manager.sendPrivate({ projectId: project.id, agentId: 'claude', content: '忽略审批' }), /不受支持的工具/);
  } finally { global.fetch = previous; }
});

test('tool/user requests validate counts, identities, paths and purposes before any generation', () => {
  const { manager, project } = fixture();
  assert.throws(() => request(manager, project, 0), /1 到 20/);
  assert.throws(() => request(manager, project, 21), /1 到 20/);
  assert.throws(() => request(manager, project, 1, [{ prompt: '' }]), /提示词/);
  assert.throws(() => request(manager, project, 1, [{ prompt: 'x', targetAgentId: '../gpt', assetKind: 'avatar' }]), /Agent 不存在/);
  assert.throws(() => manager.requestImageJob({ projectId: project.id, requestedByAgentId: 'claude', channel: 'private', conversationId: 'private:gpt', items: [{ prompt: 'x' }] }), /私聊生图会话无效/);
});
