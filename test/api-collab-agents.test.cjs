'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = `D:\\Multi-Agent\\_runtime\\tests\\agent-management-${process.pid}`;
process.env.MULTI_AGENT_ROOT = root;
const { ApiCollabManager } = require('./load-ts.cjs')('src/main/apiCollab.ts');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const make = (manager, id) => manager.saveAgent({ id, displayName: id, providerId: 'gpt', enabled: true });

test('deleting an Agent removes routing but preserves private history, files, provider and keys', () => {
  const manager = new ApiCollabManager();
  make(manager, 'disposable');
  const before = manager.snapshot('Project1');
  const folder = path.join(before.projectRoot, 'AgentChats/disposable');
  fs.mkdirSync(path.join(folder, 'data'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'data/private.md'), 'keep-private-memory');
  fs.writeFileSync(path.join(folder, 'messages.jsonl'), JSON.stringify({ id: 'old', senderId: 'disposable', content: 'keep history' }) + '\n');
  const group = manager.createGroup({ projectId: 'Project1', name: 'test group', memberAgentIds: ['gpt', 'disposable'] });
  const providerConfig = fs.readFileSync(path.join(root, '_runtime/api-providers.json'), 'utf8');
  const next = manager.deleteAgent('disposable');
  assert(!next.some((agent) => agent.id === 'disposable'));
  const restarted = new ApiCollabManager();
  const state = restarted.snapshot('Project1');
  assert(!state.agents.some((agent) => agent.id === 'disposable'));
  assert(!state.groups.find((item) => item.id === group.id).memberAgentIds.includes('disposable'));
  assert(!state.groups.find((item) => item.id === 'workgroup').memberAgentIds.includes('disposable'));
  assert.equal(fs.readFileSync(path.join(folder, 'data/private.md'), 'utf8'), 'keep-private-memory');
  assert(fs.readFileSync(path.join(folder, 'messages.jsonl'), 'utf8').includes('keep history'));
  assert.equal(fs.readFileSync(path.join(root, '_runtime/api-providers.json'), 'utf8'), providerConfig);
  assert.throws(() => make(restarted, 'disposable'), /身份已删除/);
  assert.throws(() => make(restarted, 'DISPOSABLE'), /身份已删除/);
  assert.throws(() => restarted.deleteAgent('../gpt'), /ID 无效/);
  assert.throws(() => restarted.deleteAgent('disposable'), /不存在或已删除/);
});

test('new Agents join the existing workgroup without a fixed member list', () => {
  const manager = new ApiCollabManager();
  manager.snapshot('Project1');
  make(manager, 'new-member');
  assert(manager.snapshot('Project1').groups.find((group) => group.id === 'workgroup').memberAgentIds.includes('new-member'));
  manager.deleteAgent('new-member');
});

test('unfinished tasks protect assignee and reviewer across projects', () => {
  const manager = new ApiCollabManager();
  make(manager, 'task-worker'); make(manager, 'task-checker');
  const project = manager.createProject('pending-tasks');
  manager.createTask({ projectId: project.id, description: 'keep assignment', assignedAgentId: 'task-worker', reviewerAgentId: 'task-checker' });
  assert.throws(() => manager.deleteAgent('task-worker'), /未完成任务/);
  assert.throws(() => manager.deleteAgent('task-checker'), /未完成任务/);
  assert(manager.agents().some((agent) => agent.id === 'task-worker'));
});

test('an in-flight reply prevents deletion and releases its guard after completion', async () => {
  const manager = new ApiCollabManager();
  manager.saveProvider({ id: 'offline', name: 'offline', protocol: 'openai-compatible', baseUrl: 'https://offline.invalid/v1', apiKeyRef: 'AGENT_DELETE_TEST_KEY', defaultModel: 'offline', enabled: true, timeoutMs: 3000, retryPolicy: { maxRetries: 0 } });
  process.env.AGENT_DELETE_TEST_KEY = 'not-real';
  manager.saveAgent({ id: 'busy-agent', displayName: 'Busy', providerId: 'offline', enabled: true });
  const original = global.fetch;
  let finish;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  global.fetch = async () => { entered(); await new Promise((resolve) => { finish = resolve; }); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'done' } }] }) }; };
  try {
    const pending = manager.sendPrivate({ projectId: 'Project1', agentId: 'busy-agent', content: 'hello' });
    await started;
    assert.throws(() => manager.deleteAgent('busy-agent'), /正在回复/);
    finish(); await pending;
    assert(!manager.deleteAgent('busy-agent').some((agent) => agent.id === 'busy-agent'));
  } finally { global.fetch = original; delete process.env.AGENT_DELETE_TEST_KEY; }
});

test('deleting an idle default image Agent clears its selection without deleting assets', () => {
  const manager = new ApiCollabManager();
  manager.saveProvider({ id: 'offline-image', name: 'offline', protocol: 'openai-compatible', baseUrl: 'https://offline.invalid/v1', apiKeyRef: '', defaultModel: 'image-model', enabled: true, timeoutMs: 1000 });
  manager.saveAgent({ id: 'image-delete', displayName: 'Image', providerId: 'offline-image', model: 'image-model', apiMode: 'image', enabled: true });
  manager.setDefaultImageAgent('image-delete');
  assert.equal(manager.snapshot('Project1').imageStudio.defaultAgentId, 'image-delete');
  manager.deleteAgent('image-delete');
  assert.equal(manager.snapshot('Project1').imageStudio.defaultAgentId, undefined);
});
