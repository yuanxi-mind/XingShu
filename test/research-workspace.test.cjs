'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const load = require('./load-ts.cjs');
const { ResearchWorkspaceStore } = load('src/main/researchWorkspace.ts');
const { ResearchRuntime } = load('src/main/researchRuntime.ts');
const testRoot = `D:\\Multi-Agent\\_runtime\\tests\\research-${process.pid}`;
fs.mkdirSync(testRoot, { recursive: true });
test.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
let counter = 0;
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture() {
  const root = path.join(testRoot, `project-${++counter}`); const source = path.join(testRoot, `source-${counter}`);
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'model.py'), 'def predict(x):\n    return x\n');
  fs.writeFileSync(path.join(source, 'baseline.md'), '# Baseline\nA reproducible optical and SAR change detection baseline. Metric is F1.');
  fs.writeFileSync(path.join(source, '__proto__'), 'important unusual filename');
  const agents = ['a', 'b', 'c', 'd']; const store = new ResearchWorkspaceStore(root, () => agents);
  agents.forEach(agent => store.initializeAgent(agent));
  const version = store.importBaseline(source);
  const proposal = (agent = 'a', title = `创新-${counter}`) => store.saveProposal(agent, { title, summary: '增加一个可验证的创新，尚未跑实验', steps: ['将 predict 的输出改成 x + 1'], evidence: [{ reference: `${version.codeRef}/model.py`, reason: '基线代码当前直接返回 x' }] });
  return { root, source, agents, store, version, proposal };
}
const access = (p, mode = 'implement', agentId = p.approval.implementerId) => ({ agentId, mode, proposalId: p.id });
function implement(f, p) {
  f.store.approveProposal(p.id, 'b', 'c'); p = f.store.snapshot().proposals.find(x => x.id === p.id);
  const file = path.join(f.root, p.approval.workspaceRef, 'model.py');
  f.store.edit(access(p), { path: 'model.py', operation: 'replace', oldText: 'return x', newText: 'return x + 1', expectedHash: sha(file) });
  f.store.finishImplementation(p.id, '实际修改 model.py；命令 python train.py');
  f.store.saveReview(p.id, 'c', { passed: true, summary: '符合实施清单，实验仍待用户执行', checks: [{ stepIndex: 0, passed: true, evidence: 'model.py 的 predict 已增加一', files: ['model.py'] }] });
  return f.store.snapshot().proposals.find(x => x.id === p.id);
}
function experiment(f, p, outcome = 'success') {
  const log = path.join(f.source, 'server.log'); fs.writeFileSync(log, outcome === 'success' ? 'F1=91.2, seed=42' : 'OOM on seed=42');
  const exp = f.store.recordExperiment(p.id, { outcome, metricName: 'F1', metricValue: outcome === 'success' ? '91.2' : '', dataset: 'LEVIR-CD / test / seed=42', command: 'python train.py --seed 42', note: outcome === 'success' ? '相同划分' : '显存不足，未取得有效分数' }, [log]);
  return exp;
}

test('baseline import creates no invented experiment; personal three boxes exist and original files remain byte identical', () => {
  const f = fixture(); assert.equal(f.store.snapshot().versions.length, 1); assert.equal(f.store.snapshot().proposals.length, 0);
  assert.deepEqual(f.store.files('facts', 'a'), []); assert.deepEqual(f.store.files('hypotheses', 'b'), []);
  assert(f.version.manifest['code/__proto__']); assert.equal(sha(path.join(f.source, 'model.py')), sha(path.join(f.root, f.version.codeRef, 'model.py')));
  const personal = f.store.prepareAgentBaseline('a'); assert(fs.existsSync(path.join(f.root, personal, 'code/model.py')));
  assert.throws(() => f.store.importBaseline(f.source), /baseline 已导入/);
  const root = path.join(testRoot, 'recursive'); fs.mkdirSync(path.join(root, 'WorkGroup/research/versions'), { recursive: true });
  const s = new ResearchWorkspaceStore(root, () => ['a']);
  assert.throws(() => s.importBaseline(path.join(root, 'WorkGroup/research/versions')), /下级目录/);
});

test('proposals remain independent; meeting grants one frozen proposal and its own cited attachment only', async () => {
  const f = fixture(); const secret = path.join(f.root, 'AgentChats/b/boxes/materials/secret.txt'); fs.writeFileSync(secret, 'TOP-SECRET-B');
  const sourceRef = f.store.archiveSource('a', 'offline-run', { url: 'https://example.org/paper', text: 'selected-public-paper' });
  const p = f.store.saveProposal('a', { title: '只公开这一份', summary: 'selected idea', steps: ['step'], evidence: [{ reference: sourceRef, reason: '来源已缓存' }] });
  const other = f.proposal('a', '另一份私人猜想'); f.proposal('b', 'B私人猜想');
  await assert.rejects(f.store.preview(sourceRef, 0, { agentId: 'b', mode: 'group' }), /没有/);
  await assert.rejects(f.store.preview('AgentChats/b/boxes/materials/secret.txt', 0, { agentId: 'a', mode: 'private' }), /没有/);
  const share = f.store.shareProposal(p.id); assert(share.evidence[0].reference.startsWith(`WorkGroup/research/shared-proposals/${share.id}/evidence/`));
  assert((await f.store.preview(share.evidence[0].reference, 0, { agentId: 'b', mode: 'group' })).text.includes('selected-public-paper'));
  assert(!f.store.context('c', false).includes(other.title));
  assert.throws(() => f.store.saveProposal('a', { title: '任意路径不应提权', summary: 'bad', steps: ['step'], evidence: [{ reference: 'runs/research/state.json', reason: 'untrusted' }] }), /没有/);
  await assert.rejects(f.store.preview('runs/research/state.json', 0, { agentId: 'b', mode: 'group' }), /没有/);
  assert.throws(() => f.store.saveProposal('a', { title: '不能替B授权', summary: 'bad', steps: ['step'], evidence: [{ reference: 'AgentChats/b/boxes/materials/secret.txt', reason: 'untrusted' }] }), /没有/);
  assert(!JSON.stringify(f.store.context('c', false)).includes('TOP-SECRET-B'));
});

test('dynamic implementer/reviewer use isolated versioned copies; exact patches have backups and fail closed', async () => {
  const f = fixture(); const p = f.proposal();
  assert.throws(() => f.store.approveProposal(p.id, 'b', 'b'), /不同/);
  f.store.approveProposal(p.id, 'b', 'c'); const approved = f.store.snapshot().proposals[0]; const a = access(approved);
  assert.throws(() => f.store.modelFiles({ ...a, agentId: 'd' }, 'workspace'), /授权无效/);
  assert.throws(() => f.store.modelFiles({ ...a, mode: 'review', agentId: 'b' }, 'workspace'), /核查授权/);
  assert.throws(() => f.store.edit(a, { path: '../oops', operation: 'create', newText: 'no' }), /越界/);
  assert.throws(() => f.store.edit(a, { path: 'C:/oops', operation: 'create', newText: 'no' }), /路径/);
  const file = path.join(f.root, approved.approval.workspaceRef, 'model.py');
  assert.throws(() => f.store.edit(a, { path: 'model.py', operation: 'replace', oldText: 'return x', newText: 'return 2', expectedHash: 'stale' }), /版本已变化/);
  f.store.edit(a, { path: 'model.py', operation: 'replace', oldText: 'return x', newText: 'return x + 1', expectedHash: sha(file) });
  assert.equal(fs.readFileSync(path.join(f.root, f.version.codeRef, 'model.py'), 'utf8'), 'def predict(x):\n    return x\n');
  assert(f.store.files('materials', 'b').some(file => file.path.includes('/edit-backups/') && file.path.endsWith('model.py')));
  assert.equal(f.store.changes(p.id)[0].path, 'model.py');
  assert.throws(() => f.store.edit({ ...a, mode: 'review', agentId: 'c' }, { path: 'model.py', operation: 'delete', expectedHash: sha(file) }), /不是/);
  f.agents.splice(f.agents.indexOf('b'), 1);
  assert.throws(() => f.store.edit(a, { path: 'model.py', operation: 'delete', expectedHash: sha(file) }), /Agent/);
});

test('review cannot omit requirements/files; unconfirmed experiments never become facts or a public code version', () => {
  const f = fixture(); const p = implement(f, f.proposal());
  assert.throws(() => f.store.saveReview(p.id, 'b', { passed: true, summary: 'self', checks: [] }), /核查授权/);
  assert.throws(() => f.store.saveReview(p.id, 'c', { passed: true, summary: 'none', checks: [] }), /逐条覆盖/);
  assert.throws(() => f.store.saveReview(p.id, 'c', { passed: true, summary: 'missing file', checks: [{ stepIndex: 0, passed: true, evidence: 'fake', files: [] }] }), /所有实际变更/);
  assert.throws(() => f.store.recordExperiment(p.id, { outcome: 'success', metricName: 'F1', metricValue: '91', dataset: 'test', command: 'python train.py', note: '' }, []), /至少/);
  const exp = experiment(f, p);
  assert.deepEqual(f.store.files('facts', 'b'), []);
  assert.throws(() => f.store.publish(p.id, 'd', 'cannot skip'), /发布需要/);
  f.store.confirmExperiment(p.id, exp.id);
  assert.equal(f.store.files('facts', 'b').length, 1);
  const release = f.store.publish(p.id, 'd', '用户授权发布，提高 F1 至 91.2，仅适用于所附实验条件');
  assert.equal(f.store.snapshot().currentVersionId, release.id); assert.equal(f.store.snapshot().versions.length, 2);
  assert(f.store.files('public').some(file => file.path.endsWith('server.log')));
  assert.equal(fs.readFileSync(path.join(f.root, f.version.codeRef, 'model.py'), 'utf8'), 'def predict(x):\n    return x\n');
  assert.equal(f.store.publish(p.id, 'd', 'idempotent').id, release.id);
});

test('failed experiments are confirmed and publishable as negative knowledge without replacing current code', () => {
  const f = fixture(); const p = implement(f, f.proposal()); const exp = experiment(f, p, 'failure');
  f.store.confirmExperiment(p.id, exp.id); const release = f.store.publish(p.id, 'a', '失败记录：显存不足，避免相同条件重复尝试');
  assert.equal(release.kind, 'negative-result'); assert.equal(f.store.snapshot().currentVersionId, f.version.id);
  assert(f.store.context('d', false).includes('失败记录'));
});

test('changed code or evidence invalidates old review/confirmation; stale branches cannot overwrite a later release', () => {
  const f = fixture(); const pa = implement(f, f.proposal('a')); const pb = implement(f, f.proposal('d'));
  const ea = experiment(f, pa); f.store.confirmExperiment(pa.id, ea.id); f.store.publish(pa.id, 'd', 'new current');
  const eb = experiment(f, pb); f.store.confirmExperiment(pb.id, eb.id);
  assert.throws(() => f.store.publish(pb.id, 'a', 'stale overwrite'), /公共版本已经更新/);
  const g = fixture(); const p = implement(g, g.proposal()); const e = experiment(g, p);
  fs.appendFileSync(path.join(g.root, e.evidenceRef, 'results/server.log'), '\ntampered');
  assert.throws(() => g.store.confirmExperiment(p.id, e.id), /发生变化/);
  const h = fixture(); const q = implement(h, h.proposal());
  h.store.edit(access(q), { path: 'new.py', operation: 'create', newText: 'print(1)' });
  assert.throws(() => experiment(h, q), /没有再变化/);
});

test('hash protection includes __proto__ and rejects edited baseline, junction escapes and interrupted action replay', async () => {
  const f = fixture(); const p = f.proposal(); const run = f.store.beginRun('propose', 'a', 'interrupted');
  const restarted = new ResearchWorkspaceStore(f.root, () => f.agents); assert.equal(restarted.snapshot().runs.find(r => r.id === run.id).status, 'interrupted');
  assert.equal(restarted.snapshot().proposals[0].id, p.id);
  const outside = path.join(testRoot, 'outside-secret'); fs.mkdirSync(outside, { recursive: true }); fs.writeFileSync(path.join(outside, 'secret'), 'hidden');
  const link = path.join(f.root, 'AgentChats/a/boxes/materials/escape'); fs.symlinkSync(outside, link, 'junction');
  await assert.rejects(restarted.preview('AgentChats/a/boxes/materials/escape/secret', 0, { agentId: 'a', mode: 'private' }), /链接/);
  fs.unlinkSync(link);
  fs.writeFileSync(path.join(f.root, f.version.codeRef, '__proto__'), 'tampered');
  assert.throws(() => restarted.approveProposal(p.id, 'a', 'c'), /公共版本.*外部修改/);
});

test('real provider tool protocol drives separate private proposals, actual edits, independent checks and authorized publication offline', async () => {
  const f = fixture(); const messages = []; const active = new Map(); const providers = [{ id: 'offline', name: 'offline', baseUrl: 'https://research.invalid/v1', protocol: 'openai-compatible', apiKeyRef: 'OFFLINE', defaultModel: 'offline', enabled: true, timeoutMs: 2000, retryPolicy: { maxRetries: 0 } }];
  const agents = f.agents.map(id => ({ id, displayName: id, model: id, providerId: 'offline', enabled: true, apiMode: 'agent' }));
  const runtime = new ResearchRuntime({ projectId: 'offline', store: f.store, agents: () => agents, providers: () => providers, apiKey: () => 'FAKE-NOT-A-REAL-KEY', message: message => messages.push(message), active: (id, delta) => active.set(id, (active.get(id) ?? 0) + delta) });
  const original = global.fetch; let sequence = 0; const seenSystems = []; const tool = (name, args) => ({ tool_calls: [{ id: `call-${++sequence}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  global.fetch = async (url, options) => {
    assert.equal(String(url), 'https://research.invalid/v1/chat/completions'); const body = JSON.parse(options.body); const system = body.messages[0].content; seenSystems.push(system);
    const count = body.messages.filter(m => m.role === 'assistant').length; const action = system.match(/当前权限：(propose|implement|review|publish)/)[1]; let output;
    if (action === 'propose') {
      if (count === 0) output = tool('read_research_file', { reference: `${f.version.codeRef}/model.py` });
      else if (count === 1) output = tool('read_research_file', { reference: `${f.version.codeRef}/baseline.md` });
      else if (count === 2) output = tool('save_private_proposal', { title: `private-${body.model}`, summary: `idea ${body.model}`, steps: ['返回 x + 1'], evidence: [{ reference: `${f.version.codeRef}/model.py`, reason: '实际基线当前返回 x' }] });
      else output = { content: 'saved' };
    } else {
      const p = f.store.snapshot().proposals.find(p => p.agentId === 'a'); const ref = `${p.approval.workspaceRef}/model.py`;
      if (action === 'implement') {
        if (count === 0) output = tool('read_research_file', { reference: ref });
        else if (count === 1) { const read = JSON.parse(body.messages.at(-1).content); output = tool('edit_workspace_file', { path: 'model.py', operation: 'replace', oldText: 'return x', newText: 'return x + 1', expectedHash: read.hash }); }
        else if (count === 2) output = tool('complete_implementation', { summary: '已改 model.py。服务器执行 python train.py --seed 42；未执行实验。' });
        else output = { content: 'implemented' };
      } else if (action === 'review') {
        if (count === 0) output = tool('read_research_file', { reference: ref });
        else if (count === 1) output = tool('submit_implementation_review', { passed: true, summary: '逐条符合', checks: [{ stepIndex: 0, passed: true, evidence: '返回 x + 1', files: ['model.py'] }] });
        else output = { content: 'reviewed' };
      } else output = count === 0 ? tool('publish_confirmed_version', { summary: '用户确认的成功实验已发布' }) : { content: 'published' };
    }
    return new Response(JSON.stringify({ choices: [{ message: output }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const runs = await runtime.run({ action: 'propose', agentIds: ['a', 'd'], instruction: '每个人独立提出一个创新' }); assert(runs.every(r => r.status === 'complete'), JSON.stringify(runs));
    assert.equal(f.store.snapshot().proposals.length, 2); assert(seenSystems.every(s => !s.includes('private-a') && !s.includes('private-d')));
    const p = f.store.snapshot().proposals.find(p => p.agentId === 'a'); f.store.approveProposal(p.id, 'b', 'c');
    assert.equal((await runtime.run({ action: 'implement', proposalId: p.id, agentId: 'b' }))[0].status, 'complete');
    assert.equal((await runtime.run({ action: 'review', proposalId: p.id, agentId: 'c' }))[0].status, 'complete');
    const e = experiment(f, p); f.store.confirmExperiment(p.id, e.id);
    assert.equal((await runtime.run({ action: 'publish', proposalId: p.id, agentId: 'd' }))[0].status, 'complete');
    assert(messages.some(m => m.channel === 'workgroup')); assert([...active.values()].every(n => n === 0));
  } finally { global.fetch = original; }
});

test('a plain model claim is not accepted as implementation and provider tools rejection cannot silently downgrade', async () => {
  const f = fixture(); const p = f.proposal(); f.store.approveProposal(p.id, 'b', 'c');
  const provider = { id: 'p', baseUrl: 'https://offline.invalid/v1', defaultModel: 'm', enabled: true, retryPolicy: { maxRetries: 0 } };
  const runtime = new ResearchRuntime({ projectId: 'offline', store: f.store, agents: () => f.agents.map(id => ({ id, displayName: id, providerId: 'p', enabled: true })), providers: () => [provider], apiKey: () => 'fake', message: () => {}, active: () => {} });
  const original = global.fetch;
  try {
    global.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '我已经改好了，实验提高5分！' } }] }), { status: 200 });
    const failed = await runtime.run({ action: 'implement', proposalId: p.id, agentId: 'b' }); assert.equal(failed[0].status, 'failed'); assert.match(failed[0].error, /只返回了文字/); assert.equal(f.store.changes(p.id).length, 0);
    global.fetch = async () => new Response('tools unsupported', { status: 400 });
    assert.match((await runtime.run({ action: 'implement', proposalId: p.id, agentId: 'b' }))[0].error, /不支持研究工具/);
  } finally { global.fetch = original; }
});

test('a busy member rejects the whole brainstorm selection without leaving idle peers stuck in running', async () => {
  const f = fixture(); const busy = f.store.beginRun('propose', 'b', 'busy');
  const p = { id: 'p', baseUrl: 'https://offline.invalid/v1', defaultModel: 'm', enabled: true };
  const runtime = new ResearchRuntime({ projectId: 'offline', store: f.store, agents: () => f.agents.map(id => ({ id, displayName: id, providerId: 'p', enabled: true })), providers: () => [p], apiKey: () => 'fake', message: () => {}, active: () => {} });
  await assert.rejects(runtime.run({ action: 'propose', agentIds: ['a', 'b'], instruction: 'batch' }), /正在执行/);
  assert.equal(f.store.snapshot().runs.length, 1); assert.equal(f.store.snapshot().runs[0].id, busy.id);
});

test('managed ordinary chat retains research tools, current version and native image content with a legacy image present', async () => {
  process.env.MULTI_AGENT_ROOT = path.join(testRoot, 'manager');
  const { ApiCollabManager } = load('src/main/apiCollab.ts'); const root = new ApiCollabManager(); const project = root.createProject('managed'); const manager = root.forProject(project.id);
  root.saveProvider({ id: 'offline', name: 'mock', baseUrl: 'https://offline-managed.invalid/v1', defaultModel: 'custom-model', apiKeyRef: '', enabled: true, retryPolicy: { maxRetries: 0 } }); root.setSecret('offline', 'not-real');
  manager.saveAgent({ id: 'agent', displayName: '任意伙伴', model: 'custom-model', providerId: 'offline', enabled: true, apiMode: 'agent' });
  const source = path.join(testRoot, 'manager-source'); fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'model.py'), 'return 1'); fs.writeFileSync(path.join(source, 'paper.md'), 'baseline');
  manager.researchImportBaseline(project.id, source); const state = manager.researchSnapshot(project.id);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yX4sAAAAASUVORK5CYII=', 'base64'); fs.writeFileSync(path.join(project.root, 'WorkGroup/data/image.png'), png);
  const original = global.fetch; let calls = 0;
  global.fetch = async (url, options) => {
    calls++; assert.equal(String(url), 'https://offline-managed.invalid/v1/chat/completions'); const body = JSON.parse(options.body);
    assert(body.tools.some(t => t.function.name === 'read_research_file'));
    assert(body.messages[0].content.includes(state.currentVersionId));
    if (calls === 1) assert(Array.isArray(body.messages[1].content) && body.messages[1].content.some(p => p.type === 'image_url'));
    return new Response(JSON.stringify({ choices: [{ message: { content: '当前公共版本明确，图片与资料工具均可用' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const reply = await manager.sendPrivate({ projectId: project.id, agentId: 'agent', content: '请看图片 image.png，并说明当前公共版本' }); assert.equal(reply.status, 'complete');
    await manager.sendPrivate({ projectId: project.id, agentId: 'agent', content: '只说明当前版本，不需要图片' }); assert.equal(calls, 2);
  } finally { global.fetch = original; }
});
