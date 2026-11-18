const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(`D:/Multi-Agent/_runtime/tests/project-workspaces-${process.pid}`);
process.env.MULTI_AGENT_ROOT = root;
const load = require('./load-ts.cjs');
const { ApiCollabManager } = load('src/main/apiCollab.ts');
const { relayModels, modeForModel } = load('src/shared/relayModels.ts');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ahtsAAAAASUVORK5CYII=', 'base64');
const app = new ApiCollabManager();
const provider = { id: 'relay', name: '连接库', protocol: 'openai-compatible', baseUrl: 'https://offline.invalid/v1', apiKeyRef: '', defaultModel: 'text-default', models: ['text-one', 'gpt-image-2.5'], enabled: true, stream: false, timeoutMs: 10000, retryPolicy: { maxRetries: 0 } };
app.saveProvider(provider); app.setSecret('relay', 'not-a-real-key');
test.after(() => { assert.equal(path.dirname(root), path.resolve('D:/Multi-Agent/_runtime/tests')); fs.rmSync(root, { recursive: true, force: true }); });

test('new projects share the connection library but never agents, configuration, messages, files or image state', async () => {
  const a = app.createProject('隔离A'); const wa = app.forProject(a.id);
  wa.saveAgent({ id: 'same', displayName: 'A员工', providerId: 'relay', model: 'text-one', systemPrompt: 'A私有指令不可泄漏', avatarPreset: 'gpt', enabled: true });
  fs.writeFileSync(path.join(a.root, 'WorkGroup/data/private-a.md'), 'A独有资料不可泄漏');
  fs.writeFileSync(path.join(a.root, 'WorkGroup/data/portrait.png'), png);
  wa.importAgentAvatar(a.id, 'same', path.join(a.root, 'WorkGroup/data/portrait.png'));
  const task = wa.createTask({ projectId: a.id, description: 'A独有任务', assignedAgentId: 'same' });
  assert(task.id);
  const b = app.createProject('隔离B'); const wb = app.forProject(b.id);
  const blank = wb.snapshot(b.id);
  assert.deepEqual(blank.agents, []); assert.deepEqual(blank.tasks, []); assert.deepEqual(blank.workgroup, []);
  assert.deepEqual(blank.imageStudio.visuals, { avatars: {}, backgrounds: {} }); assert.deepEqual(blank.imageStudio.jobs, []); assert.equal(blank.imageStudio.defaultAgentId, undefined);
  assert.equal(blank.imageStudio.assetRoot, b.root);
  assert.equal(wb.providers().find((entry) => entry.id === 'relay').hasSecret, true);
  assert.equal(fs.existsSync(path.join(b.root, 'WorkGroup/data/private-a.md')), false);
  wb.saveAgent({ id: 'same', displayName: 'B员工', providerId: 'relay', model: 'text-other', systemPrompt: 'B自己的指令', avatarPreset: 'claude', enabled: true });
  assert.equal(wa.snapshot(a.id).agents[0].model, 'text-one'); assert.equal(wb.snapshot(b.id).agents[0].model, 'text-other');
  let body; const previous = global.fetch;
  global.fetch = async (url, init) => { assert.equal(url, 'https://offline.invalid/v1/chat/completions'); body = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'B测试回复' } }] })); };
  try { await wb.sendPrivate({ projectId: b.id, agentId: 'same', content: '总结当前项目' }); } finally { global.fetch = previous; }
  assert.equal(body.model, 'text-other'); assert(!JSON.stringify(body).includes('A独有')); assert(!JSON.stringify(body).includes('A私有'));
  assert.equal(wa.snapshot(a.id).privateChats.same?.length ?? 0, 0);
  assert.equal(wb.snapshot(b.id).privateChats.same.length, 2);
  assert.throws(() => wa.snapshot(b.id), /跨项目/);
  wb.deleteAgent('same'); assert.equal(wa.snapshot(a.id).agents.length, 1);
  const restarted = new ApiCollabManager();
  assert.equal(restarted.forProject(a.id).snapshot(a.id).agents[0].avatarPreset, 'custom');
  assert.deepEqual(restarted.forProject(b.id).snapshot(b.id).agents, []);
  const c = restarted.createProject('隔离C'); assert.deepEqual(restarted.forProject(c.id).snapshot(c.id).agents, []);
});

test('legacy project data is copied once, then frozen independently; global files and originals survive', () => {
  app.saveAgent({ id: 'legacy-only', displayName: '旧员工', providerId: 'relay', model: 'legacy-model', enabled: true });
  const legacyRoot = path.join(root, '旧项目'); fs.mkdirSync(path.join(legacyRoot, 'WorkGroup/data'), { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, 'project.json'), JSON.stringify({ name: '旧项目' }));
  fs.mkdirSync(path.join(root, '_runtime/appearance/assets'), { recursive: true });
  const source = '_runtime/appearance/assets/legacy.png'; fs.writeFileSync(path.join(root, source), png);
  fs.writeFileSync(path.join(root, '_runtime/agent-visuals.json'), JSON.stringify({ avatars: { 'legacy-only': source, 'missing-image': '_runtime/appearance/assets/missing.png' }, backgrounds: {} }));
  const globalAgents = fs.readFileSync(path.join(root, '_runtime/api-agents.json'), 'utf8');
  const migrated = new ApiCollabManager(); const workspace = migrated.forProject('旧项目');
  const state = workspace.snapshot('旧项目'); const avatar = state.imageStudio.visuals.avatars['legacy-only'];
  assert(avatar.startsWith('runs/appearance/assets/')); assert.deepEqual(fs.readFileSync(path.join(legacyRoot, avatar)), png);
  assert.equal(state.imageStudio.visuals.avatars['missing-image'], undefined);
  assert(fs.existsSync(path.join(root, source))); assert.equal(state.agents.find((agent) => agent.id === 'legacy-only').model, 'legacy-model');
  workspace.saveAgent({ ...state.agents.find((agent) => agent.id === 'legacy-only'), model: 'changed-only-here' });
  assert.equal(fs.readFileSync(path.join(root, '_runtime/api-agents.json'), 'utf8'), globalAgents);
  assert.equal(new ApiCollabManager().forProject('旧项目').snapshot('旧项目').agents.find((agent) => agent.id === 'legacy-only').model, 'changed-only-here');
  const fresh = migrated.createProject('迁移后新项目'); assert.deepEqual(migrated.forProject(fresh.id).snapshot(fresh.id).agents, []);
  fs.unlinkSync(path.join(fresh.root, 'runs/agents.json'));
  assert.deepEqual(new ApiCollabManager().forProject(fresh.id).snapshot(fresh.id).agents, [], 'A missing new-project config must never revive legacy agents');
});

test('relay model choices deduplicate, stay within the selected connection and choose the correct request mode', () => {
  assert.deepEqual(relayModels(provider, [{ providerId: 'other', model: 'private-other' }, { providerId: 'relay', model: 'text-one' }], ['remote-model', 'text-one']), ['gpt-image-2.5', 'remote-model', 'text-default', 'text-one']);
  assert.deepEqual(relayModels(undefined, [], ['other']), []);
  assert.equal(modeForModel('gpt-image-2.5'), 'image'); assert.equal(modeForModel('gpt-6.1-sol', 'image'), 'agent');
  assert.equal(modeForModel('gpt-6.1-sol', 'chat'), 'chat');
  assert.throws(() => app.saveProvider({ ...provider, models: [123] }), /模型/);
  assert.throws(() => app.forProject('隔离A').saveAgent({ id: 'invalid-avatar', avatarPreset: '../x' }), /头像/);
});
