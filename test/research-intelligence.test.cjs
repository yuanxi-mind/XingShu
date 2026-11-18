'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto'); const cp = require('node:child_process'); const zlib = require('node:zlib');
const load = require('./load-ts.cjs');
const { ResearchWorkspaceStore } = load('src/main/researchWorkspace.ts');
const { ResearchMemory } = load('src/main/researchMemory.ts');
const { ResearchJournal } = load('src/main/researchJournal.ts');
const { runResearchProvider } = load('src/main/researchProvider.ts');
const { ResearchExperiments, validateExperimentPlan } = load('src/main/researchExperiments.ts');
const { ResearchSshTransport, validateResearchServer } = load('src/main/researchSsh.ts');
const { ResearchBenchmark } = load('src/main/researchBenchmark.ts');
const { BENCHMARK_TASKS } = load('src/shared/researchBenchmark.ts');
const base = path.join('D:/Multi-Agent/_runtime/benchmark-0.4.14/tests', crypto.randomUUID()); fs.mkdirSync(base, { recursive: true });
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function fixture(staleMetrics = false) {
  const root = path.join(base, crypto.randomUUID()); const src = path.join(root, 'source'); fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'train.py'), 'def predict(x):\n    return x\n'); fs.writeFileSync(path.join(src, 'paper.md'), '# Baseline\n真实读取测试用说明，不是科研结论。');
  fs.writeFileSync(path.join(src, 'requirements.txt'), 'torch==2.5.1\n'); fs.writeFileSync(path.join(src, 'splits.json'), '["sample-a","sample-b"]\n');
  if (staleMetrics) fs.writeFileSync(path.join(src, 'metrics.json'), '{"F1":100}');
  const store = new ResearchWorkspaceStore(root, () => ['a', 'b', 'c']); const version = store.importBaseline(src);
  for (const id of ['a', 'b', 'c']) store.initializeAgent(id);
  const propose = (agent = 'a', title = '差分模块测试方案') => store.saveProposal(agent, { title, summary: '仍待实验验证', steps: ['将返回值增加1'], evidence: [{ reference: version.codeRef + '/train.py', reason: '已读实际代码' }] });
  const implement = () => {
    const p = propose(); store.approveProposal(p.id, 'a', 'b'); const approved = store.snapshot().proposals.find(q => q.id === p.id);
    const file = path.join(root, approved.approval.workspaceRef, 'train.py'); store.edit({ agentId: 'a', mode: 'implement', proposalId: p.id }, { path: 'train.py', operation: 'replace', oldText: 'return x', newText: 'return x + 1', expectedHash: sha(fs.readFileSync(file)) });
    store.finishImplementation(p.id, '增加1'); store.saveReview(p.id, 'b', { passed: true, summary: '核对代码实际变更', checks: [{ stepIndex: 0, passed: true, evidence: '返回x+1', files: ['train.py'] }] }); return p;
  };
  return { root, store, version, propose, implement };
}
const provider = { id: 'relay', name: '隔离中转', baseUrl: 'https://benchmark.invalid/v1', defaultModel: 'configured-model', enabled: true, protocol: 'openai-compatible', timeoutMs: 1000, stream: true, retryPolicy: { maxRetries: 2 } };
const agent = { id: 'a', displayName: '测试伙伴', providerId: 'relay', model: 'chosen-model', enabled: true, reasoningEffort: 'high' };
const input = p => ({ mode: 'offline', taskIds: BENCHMARK_TASKS.map(t => t.id), agentIds: [], repetitions: 1, maxRequests: 24, maxOutputTokens: 1024, maxDurationSeconds: 30, ...p });
const deps = () => ({ agents: () => [agent], providers: () => [provider], apiKey: () => 'TEST-SECRET-DO-NOT-EXPORT' });
async function done(b, id) { for (let i = 0; i < 300; i++) { const r = b.read(id); if (r.status !== 'running' && r.finishedAt) return r; await new Promise(r => setTimeout(r, 10)); } throw new Error('benchmark did not finish'); }
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (message, usage = { prompt_tokens: 100, completion_tokens: 20 }) => new Response(JSON.stringify({ choices: [{ message }], ...(usage ? { usage } : {}) }), { headers: { 'content-type': 'application/json' } });

test('offline calibration verifies all six graders with positive and negative answers without using providers', async t => {
  const f = fixture(); t.mock.method(globalThis, 'fetch', async () => { throw new Error('NETWORK MUST NOT RUN'); });
  const benchmark = new ResearchBenchmark(f.root, deps()); const r = await done(benchmark, benchmark.start(input()).id);
  assert.equal(r.attempts.length, 12); assert.equal(r.attempts.filter(a => a.status === 'passed').length, 6); assert.equal(r.attempts.filter(a => a.status === 'failed').length, 6); assert.equal(r.requests, 0);
  assert(r.attempts.every(a => a.estimatedCost === 0)); assert(!JSON.stringify(r).includes('TEST-SECRET'));
  assert(fs.readFileSync(path.join(f.root, r.reportReference), 'utf8').includes('不代表模型能力'));
  assert.equal(f.store.snapshot().proposals.length, 0); assert.equal(f.store.files('facts', 'a').length, 0);
});
test('real calibration uses configured endpoint/model, actual reads, snapshots settings, and complete usage estimates', async t => {
  const f = fixture(); const b = new ResearchBenchmark(f.root, deps()); let count = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), provider.baseUrl + '/chat/completions'); const body = JSON.parse(init.body); assert.equal(body.model, agent.model); assert.equal(body.stream, false); assert.equal(body.max_tokens, 1024); assert.equal(body.reasoning_effort, 'high'); count++;
    if (count === 1) return reply({ tool_calls: [call('paper', 'read_benchmark_file', { path: 'paper.md' }), call('code', 'read_benchmark_file', { path: 'workspace/model.py' })] });
    const evidence = body.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content)).map(r => ({ path: r.path, quote: r.text.slice(0, 80) }));
    return reply({ tool_calls: [call('submit', 'submit_evaluation', { answer: { path: 'workspace/model.py', function: 'temporal_difference', line: 1, evidence } })] });
  });
  assert.throws(() => b.start(input({ mode: 'provider', agentIds: ['a'] })), /确认/);
  const r = await done(b, b.start(input({ mode: 'provider', agentIds: ['a'], taskIds: ['baseline-map'], consent: true, prices: { a: { inputPerMillion: 2, outputPerMillion: 4 } } })).id);
  assert.equal(r.attempts[0].status, 'passed'); assert.equal(r.requests, 2); assert.equal(r.attempts[0].estimatedCost, 0.00056);
  assert(!fs.readFileSync(path.join(f.root, r.reportReference.replace('report.md', 'run.json')), 'utf8').includes('TEST-SECRET'));
});
test('usage absent or failed HTTP stays unknown; call and duration budgets never mean a billing guarantee', async t => {
  const f = fixture(); const b = new ResearchBenchmark(f.root, deps()); let count = 0;
  t.mock.method(globalThis, 'fetch', async () => { count++; return reply({ tool_calls: [call('read', 'read_benchmark_file', { path: 'paper.md' })] }, null); });
  const r = await done(b, b.start(input({ mode: 'provider', agentIds: ['a'], taskIds: ['baseline-map'], consent: true, maxRequests: 1, prices: { a: { inputPerMillion: 1, outputPerMillion: 1 } } })).id);
  assert.equal(count, 1); assert.equal(r.status, 'limited'); assert.equal(r.attempts[0].estimatedCost, null);
});
test('cancel, duplicate start, invalid input and restart do not silently replay a paid evaluation', async () => {
  const f = fixture(); const b = new ResearchBenchmark(f.root, deps());
  assert.throws(() => b.start(input({ maxRequests: 0 })), /上限/);
  const r = b.start(input({ repetitions: 3 })); assert.throws(() => b.start(input()), /正在执行/); b.cancel(r.id); const stopped = await done(b, r.id); assert.equal(stopped.status, 'cancelled'); assert.equal(stopped.requests, 0);
  stopped.status = 'running'; stopped.attempts[0].status = 'running'; const file = path.join(f.root, stopped.reportReference.replace('report.md', 'run.json')); fs.writeFileSync(file, JSON.stringify(stopped));
  const next = new ResearchBenchmark(f.root, deps()); assert.equal(next.read(r.id).status, 'interrupted'); assert.equal(next.read(r.id).requests, 0);
  const other = fixture(); assert.equal(new ResearchBenchmark(other.root, deps()).snapshot().runs.length, 0);
});
test('memory search isolates private hypotheses, respects meeting snapshots and marks historical facts', () => {
  const f = fixture(); const a = f.propose('a', '秘密差分甲'); f.propose('b', '秘密差分乙'); const m = new ResearchMemory(f.store);
  assert(m.search('秘密', 'a', true).some(h => h.text.includes('差分甲'))); assert(!JSON.stringify(m.search('秘密', 'a', true)).includes('差分乙'));
  assert.deepEqual(m.search('秘密', 'c', false), []); f.store.shareProposal(a.id); assert(m.search('秘密', 'c', false).some(h => h.text.includes('差分甲')));
  assert(!JSON.stringify(m.search('秘密', 'c', false)).includes('差分乙'));
});
test('evidence graph binds source hashes, review, experiment, confirmation and publication without claiming reproduction', () => {
  const f = fixture(); const p = f.implement(); const log = path.join(f.root, 'result.log'); fs.writeFileSync(log, 'F1=90');
  const e = f.store.recordExperiment(p.id, { outcome: 'success', metricName: 'F1', metricValue: '90', dataset: 'A/test/seed1', command: 'python train.py', note: '单次观察' }, [log]);
  let g = new ResearchMemory(f.store).graph(); assert(g.nodes.some(n => n.id === e.id && n.assurance === 'pending')); f.store.confirmExperiment(p.id, e.id);
  g = new ResearchMemory(f.store).graph(); assert(g.nodes.some(n => n.id === e.id && n.assurance === 'human-confirmed')); assert(!g.nodes.some(n => n.assurance === 'runner-verified'));
  f.store.publish(p.id, 'c', '用户确认的单次观察'); g = new ResearchMemory(f.store).graph(); assert(g.nodes.some(n => n.kind === 'conclusion' && n.applicability === 'current'));
  fs.appendFileSync(path.join(f.root, e.evidenceRef, 'results/result.log'), 'tampered'); g = new ResearchMemory(f.store).graph(); assert(g.nodes.some(n => n.id === e.id && n.applicability === 'changed'));
});
test('source hashes bind unquoted evidence too and reject changed reads or fabricated quotes', async t => {
  const f = fixture(); const source = f.store.archiveSource('a', 'fixture', { text: 'original external source' });
  const p = f.store.saveProposal('a', { title: '有校验的来源', summary: '待验证', steps: ['检查'], evidence: [{ reference: source, reason: '真实缓存' }] });
  assert.equal(p.evidence[0].sourceHash, sha(fs.readFileSync(path.join(f.root, source))));
  fs.appendFileSync(path.join(f.root, source), 'changed'); assert(new ResearchMemory(f.store).graph().nodes.some(n => n.kind === 'source' && n.applicability === 'changed'));
  assert.throws(() => f.store.saveProposal('a', { title: '过期来源', summary: '待验证', steps: ['检查'], evidence: [{ reference: source, reason: 'changed', sourceHash: p.evidence[0].sourceHash }] }), /变化/);
  const { ResearchRuntime } = load('src/main/researchRuntime.ts'); let messages = [];
  const runtime = new ResearchRuntime({ projectId: 'fixture', store: f.store, agents: () => [agent], providers: () => [provider], apiKey: () => 'fixture', active: () => {}, message: () => {} }); let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => { requests++; const body = JSON.parse(init.body); messages = body.messages;
    if (requests === 1) return reply({ tool_calls: [call('code', 'read_research_file', { reference: f.version.codeRef + '/train.py' }), call('paper', 'read_research_file', { reference: f.version.codeRef + '/paper.md' })] });
    if (requests === 2) return reply({ tool_calls: [call('fake-quote', 'save_private_proposal', { title: '伪造原文不应保存', summary: '待验证', steps: ['检查'], evidence: [{ reference: f.version.codeRef + '/train.py', reason: 'fake', quote: 'THIS WAS NEVER IN THE FILE' }] })] });
    return reply({ content: '不能引用未读原文' });
  });
  const count = f.store.snapshot().proposals.length; const runs = await runtime.run({ action: 'propose', agentIds: ['a'], instruction: 'fixture' });
  assert.equal(runs[0].status, 'failed'); assert.equal(f.store.snapshot().proposals.length, count); assert(messages.some(m => m.role === 'tool' && m.content.includes('不能编造引文')));
});
test('provider checkpoint resumes after a completed tool without repeating the mutation or first model request', async t => {
  const f = fixture(); const p = f.propose(); f.store.approveProposal(p.id, 'a', 'b'); const approved = f.store.snapshot().proposals.find(q => q.id === p.id); const r = f.store.beginRun('implement', 'a', '', p.id);
  const journal = new ResearchJournal(f.store, r); const configuration = ResearchJournal.configuration(agent, provider); const file = path.join(f.root, approved.approval.workspaceRef, 'train.py');
  const args = { path: 'train.py', operation: 'replace', oldText: 'return x', newText: 'return x + 1', expectedHash: sha(fs.readFileSync(file)) }; let requests = 0; let mutations = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return requests === 1 ? reply({ tool_calls: [call('edit-once', 'edit_workspace_file', args)] }) : reply({ content: '继续完成' }); });
  const options = { provider: { ...provider, stream: false }, agent, apiKey: 'fixture', system: 'fixture', prompt: 'fixture', tools: [{ type: 'function', function: { name: 'edit_workspace_file', description: 'fixture', parameters: { type: 'object' } } }], execute: (_name, a, id) => journal.once(id, 'edit_workspace_file', a, async () => { mutations++; return f.store.edit({ agentId: 'a', mode: 'implement', proposalId: p.id }, a); }) };
  await assert.rejects(runResearchProvider({ ...options, continuation: { save: state => { if (state.pending?.next === 1) throw new Error('simulated crash after disk write'); journal.save(configuration, state); } } }), /simulated crash/);
  assert.equal(mutations, 1); const state = journal.load(configuration); assert.equal(state.pending.next, 0);
  assert.equal(await runResearchProvider({ ...options, continuation: { state, save: s => journal.save(configuration, s) } }), '继续完成');
  assert.equal(mutations, 1); assert.equal(requests, 2); assert(fs.readFileSync(file, 'utf8').includes('return x + 1')); assert(!fs.readFileSync(file, 'utf8').includes('+ 1 + 1'));
  assert.throws(() => journal.load('another-model'), /配置/);
  fs.appendFileSync(file, '# external'); assert.throws(() => journal.load(configuration), /变化/);
});
test('tool intent refuses conflicting ids and recovers an applied edit after receipt write was interrupted', async () => {
  const f = fixture(); const p = f.propose(); f.store.approveProposal(p.id, 'a', 'b'); const r = f.store.beginRun('implement', 'a', '', p.id); const j = new ResearchJournal(f.store, r);
  assert.deepEqual(await j.once('one', 'read_research_file', { reference: 'x' }, async () => ({ text: 'one' })), { text: 'one' });
  await assert.rejects(j.once('one', 'read_research_file', { reference: 'different' }, async () => null), /冲突/);
  const approved = f.store.snapshot().proposals.find(q => q.id === p.id); const file = path.join(f.root, approved.approval.workspaceRef, 'train.py');
  const args = { path: 'train.py', operation: 'replace', oldText: 'return x', newText: 'return x + 1', expectedHash: sha(fs.readFileSync(file)) }; let calls = 0;
  await assert.rejects(j.once('edit', 'edit_workspace_file', args, async () => { calls++; f.store.edit({ agentId: 'a', mode: 'implement', proposalId: p.id }, args); throw new Error('crash after mutation'); }), /crash/);
  const result = await j.once('edit', 'edit_workspace_file', args, async () => { calls++; throw new Error('must not replay'); }); assert(result.after); assert.equal(calls, 1);
});
const plan = () => ({ entrypoint: 'train.py', args: ['--data', '/datasets'], seedFlag: '--seed', seeds: [1, 2, 3], dataset: 'CD-fixture', split: 'official-test', dependencyFile: 'requirements.txt', splitManifest: 'splits.json', image: 'fixture/image@sha256:' + '1'.repeat(64), metricPath: 'metrics.json', metricName: 'F1', timeoutSeconds: 60, cpus: 2, memoryGb: 4, gpuDevices: '' });
function fakeResults(f, b, offset = 0, fail = false) {
  const dir = path.join(f.root, 'server-' + b.id); fs.mkdirSync(path.join(dir, 'results'), { recursive: true });
  const runs = b.plan.seeds.map((seed, index) => { const folder = path.join(dir, 'results', 'seed-' + seed); fs.mkdirSync(folder); const log = 'seed ' + seed + ' completed'; fs.writeFileSync(path.join(folder, 'train.log'), log); const metrics = JSON.stringify({ F1: 89 + index + offset }); fs.writeFileSync(path.join(folder, 'metrics.json'), metrics); return { seed, exitCode: fail && index === 2 ? 1 : 0, log: `results/seed-${seed}/train.log`, logHash: sha(log), ...(fail && index === 2 ? {} : { metric: 89 + index + offset, metrics: `results/seed-${seed}/metrics.json`, metricsHash: sha(metrics) }) }; });
  const file = path.join(dir, 'results/bundle-results.json'); fs.writeFileSync(file, JSON.stringify({ runner: 'xingshu-experiment-v1', bundleId: b.id, manifestHash: b.manifestHash, codeHash: b.codeHash, plan: b.plan, status: fail ? 'failed' : 'completed', runs })); return file;
}
test('experiment bundle includes a valid tar, immutable approved code and a working offline Python manifest check', async () => {
  const f = fixture(); const p = f.implement(); const m = new ResearchExperiments(f.store); const b = await m.prepare(p.id, plan());
  const archive = zlib.gunzipSync(fs.readFileSync(path.join(f.root, b.archiveReference))); assert.equal(archive.subarray(257, 262).toString(), 'ustar'); assert(archive.includes(Buffer.from('run_experiment.py')));
  const runner = path.join(f.root, b.reference, 'run_experiment.py'); const output = cp.execFileSync((process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')), [runner, '--manifest-sha256', b.manifestHash, '--check-only'], { encoding: 'utf8', env: { ...process.env, TEMP: base, TMP: base, PYTHONDONTWRITEBYTECODE: '1' } }); assert.equal(JSON.parse(output).checked, true);
  assert.equal(f.store.snapshot().proposals.find(q => q.id === p.id).experiments.length, 0); assert.equal(f.store.files('facts', 'a').length, 0);
  fs.appendFileSync(path.join(f.root, b.reference, 'code/train.py'), 'tamper'); assert.throws(() => cp.execFileSync((process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')), [runner, '--manifest-sha256', b.manifestHash, '--check-only'], { stdio: 'pipe', env: { ...process.env, TEMP: base, TMP: base, PYTHONDONTWRITEBYTECODE: '1' } }));
});
test('multi-seed import verifies every log/metric, stays unconfirmed, and compares only confirmed matching conditions', async () => {
  const f = fixture(); const p = f.implement(); const m = new ResearchExperiments(f.store); const baseline = await m.prepare('__baseline__', plan()); const candidate = await m.prepare(p.id, plan());
  m.importResult(baseline.id, fakeResults(f, baseline)); m.importResult(candidate.id, fakeResults(f, candidate, 0.5));
  assert.equal(f.store.files('facts', 'a').length, 0); assert.equal(m.compare(baseline.id, candidate.id).comparable, false);
  m.confirm(baseline.id, true); m.confirm(candidate.id, true); const comparison = m.compare(baseline.id, candidate.id); assert.equal(comparison.comparable, true); assert.equal(comparison.delta, 0.5);
  assert.equal(f.store.files('facts', 'a').length, 1); assert.throws(() => m.importResult(candidate.id, 'bad'), /重复/);
  assert.throws(() => m.importResult(baseline.id, 'bad'), /重复/);
  const changed = await m.prepare('__baseline__', { ...plan(), split: 'another-split' }); m.importResult(changed.id, fakeResults(f, changed)); m.confirm(changed.id, true); assert.equal(m.compare(changed.id, candidate.id).comparable, false);
});
test('result tampering and partial failures cannot become a complete success', async () => {
  const f = fixture(); const p = f.implement(); const m = new ResearchExperiments(f.store); const b = await m.prepare(p.id, plan()); const file = fakeResults(f, b, 0, true); const result = m.importResult(b.id, file);
  assert.equal(result.results.complete, false); assert.equal(f.store.snapshot().proposals.find(q => q.id === p.id).experiments[0].outcome, 'failure');
  const another = await m.prepare('__baseline__', plan()); const wrong = fakeResults(f, another); fs.appendFileSync(path.join(path.dirname(wrong), 'seed-1/train.log'), 'altered'); assert.throws(() => m.importResult(another.id, wrong), /校验/);
});
test('server execution requires approved consent, pins configuration, and never retries unknown submission', async t => {
  const f = fixture(); const m = new ResearchExperiments(f.store); const b = await m.prepare('__baseline__', plan()); const key = path.join(f.root, 'test-key'); fs.writeFileSync(key, 'not-a-real-key');
  const server = { host: 'test.invalid', port: 22, username: 'research', identityFile: key, hostFingerprint: 'SHA256:' + 'A'.repeat(43), remoteRoot: '/home/research/jobs', datasetRoot: '/home/research/data' }; m.saveServer(server);
  assert.throws(() => validateResearchServer({ ...server, username: 'root' }), /root/); assert.throws(() => validateResearchServer({ ...server, remoteRoot: '/home/../escape' }), /路径/);
  assert.throws(() => validateExperimentPlan({ ...plan(), entrypoint: '../escape' }), /路径/); assert.throws(() => validateExperimentPlan({ ...plan(), image: 'latest' }), /digest/);
  let submissions = 0; t.mock.method(ResearchSshTransport.prototype, 'submit', async () => { submissions++; throw new Error('simulated disconnect after submission'); });
  await assert.rejects(m.submit(b.id, false), /确认/); assert.equal(submissions, 0); const unknown = await m.submit(b.id, true); assert.equal(unknown.status, 'unknown'); assert(unknown.serverHash); await assert.rejects(m.submit(b.id, true), /重复提交/); assert.equal(submissions, 1);
});

test('experiment operations serialize duplicate submits and reject collection without approval', async t => {
  const f = fixture(); const m = new ResearchExperiments(f.store); const b = await m.prepare('__baseline__', plan());
  await assert.rejects(m.collect(b.id), /提交记录/);
  const key = path.join(f.root, 'fixture-key'); fs.writeFileSync(key, 'not-a-real-key');
  m.saveServer({ host: 'mock.invalid', port: 22, username: 'research', identityFile: key, hostFingerprint: 'SHA256:' + 'A'.repeat(43), remoteRoot: '/home/research/jobs', datasetRoot: '' });
  let finish; const pending = new Promise(resolve => { finish = resolve; }); let calls = 0;
  t.mock.method(ResearchSshTransport.prototype, 'submit', async () => { calls++; await pending; return { directory: '/mock', serverHash: 'mock', note: 'mock' }; });
  const first = m.submit(b.id, true); await assert.rejects(m.submit(b.id, true), /正在进行/); await assert.rejects(m.refresh(b.id), /正在进行/);
  finish(); await first; assert.equal(calls, 1);
});

test('comparison rechecks confirmed receipts and server refresh preserves imported status', async t => {
  const f = fixture(); const p = f.implement(); const m = new ResearchExperiments(f.store); const a = await m.prepare('__baseline__', plan()); const b = await m.prepare(p.id, plan());
  m.importResult(a.id, fakeResults(f, a)); m.importResult(b.id, fakeResults(f, b)); m.confirm(a.id, true); m.confirm(b.id, true);
  const file = path.join(f.root, 'runs/experiment-bundles', b.id, 'bundle.json'); const saved = JSON.parse(fs.readFileSync(file)); saved.approvedAt = new Date().toISOString(); fs.writeFileSync(file, JSON.stringify(saved));
  t.mock.method(ResearchSshTransport.prototype, 'status', async () => ({ status: 'completed', note: 'mock' }));
  assert.equal((await m.refresh(b.id)).status, 'collected'); assert.equal(m.compare(a.id, b.id).comparable, true);
  fs.appendFileSync(path.join(f.root, 'runs/experiment-bundles', a.id, 'receipts/seed-1.log'), 'tampered');
  assert.equal(m.compare(a.id, b.id).comparable, false);
});

test('the Python runner enforces container limits, separates seeds, rejects stale metrics and prevents duplicate launches', async () => {
  const f = fixture(true); const m = new ResearchExperiments(f.store);
  const b = await m.prepare('__baseline__', { ...plan(), gpuDevices: '0,1' }); const runner = path.join(f.root, b.reference, 'run_experiment.py');
  const harness = path.join(f.root, 'runner-harness.py');
  fs.writeFileSync(harness, String.raw`import importlib.util, pathlib, sys, json, subprocess, types
runner, manifest = sys.argv[1:]
spec = importlib.util.spec_from_file_location('fixture_runner', runner)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.os.getuid = lambda: 1000; m.os.getgid = lambda: 1000
calls = []
def run(command, **kw):
    calls.append(command)
    if command[:3] == ['docker','image','inspect']: return types.SimpleNamespace(returncode=0, stdout='["fixture"]')
    if command[:2] == ['docker','stop']: return types.SimpleNamespace(returncode=0)
    assert command[:2] == ['docker','run']
    for flag in ['--read-only','--cap-drop','--security-opt','--pids-limit','--cpus','--memory','--user','--tmpfs']: assert flag in command, flag
    assert command[command.index('--network')+1]=='none'
    assert command[command.index('--pull=never')]=='--pull=never'
    assert command[command.index('--gpus')+1]=='"device=0,1"'
    assert 'subprocess.run([sys.executable]+sys.argv[2:],timeout=int(sys.argv[1]))' in command[command.index('-c')+1]
    assert kw['timeout']==60
    mount = next(x for x in command if x.startswith('type=bind,src=') and x.endswith(',dst=/workspace'))
    work = pathlib.Path(mount.split('src=',1)[1].rsplit(',dst=',1)[0])
    assert not (work/'metrics.json').exists(), 'stale output survived'
    seed=int(command[-1]); assert command[-2]=='--seed'
    kw['stdout'].write(('fixture log '+str(seed)).encode())
    if seed!=3: (work/'metrics.json').write_text(json.dumps({'F1':89+seed}))
    return types.SimpleNamespace(returncode=0)
m.subprocess.run=run; sys.argv=[runner,'--manifest-sha256',manifest]
try: m.main()
except SystemExit as e: assert e.code==1
state=json.loads((m.ROOT/'results/bundle-results.json').read_text())
assert state['status']=='failed' and len(state['runs'])==3
assert [r.get('metric') for r in state['runs']]==[90,91,None]
assert len([c for c in calls if c[:2]==['docker','run']])==3
before=len(calls)
try: m.main(); raise AssertionError('duplicate launch allowed')
except RuntimeError as e: assert 'already started' in str(e)
assert len(calls)==before
print(json.dumps({'fixtureOnly':True,'seeds':3,'limitsChecked':True,'staleMetricsRejected':True,'duplicatePrevented':True}))
`);
  const output = cp.execFileSync((process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')), [harness, runner, b.manifestHash], { encoding: 'utf8', env: { ...process.env, TEMP: base, TMP: base, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(JSON.parse(output).duplicatePrevented, true);
  fs.writeFileSync(path.join(f.root, b.reference, 'code/unlisted.py'), '# not in manifest');
  assert.throws(() => cp.execFileSync((process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')), [runner, '--manifest-sha256', b.manifestHash, '--check-only'], { stdio: 'pipe', env: { ...process.env, TEMP: base, TMP: base, PYTHONDONTWRITEBYTECODE: '1' } }));
});

test('SSH uses isolated configuration and treats a dead runner as unknown instead of running', async t => {
  const f = fixture(); const m = new ResearchExperiments(f.store); const b = await m.prepare('__baseline__', plan()); const key = path.join(f.root, 'fixture-key'); fs.writeFileSync(key, 'not-a-real-key');
  const transport = new ResearchSshTransport(f.root); transport.saveServer({ host: 'mock.invalid', port: 2222, username: 'research', identityFile: key, hostFingerprint: 'SHA256:' + 'A'.repeat(43), remoteRoot: '/home/research/jobs', datasetRoot: '' });
  fs.writeFileSync(path.join(f.root, 'runs/remote-experiment/known_hosts'), 'fixture-only'); b.approvedAt = new Date().toISOString(); b.serverHash = transport.configurationHash();
  const remote = path.join(f.root, 'mock-remote'); fs.mkdirSync(path.join(remote, 'results'), { recursive: true }); fs.writeFileSync(path.join(remote, 'results/bundle-results.json'), JSON.stringify({ bundleId: b.id, manifestHash: b.manifestHash, status: 'running' })); fs.writeFileSync(path.join(remote, 'runner.pid'), '999999999');
  const { EventEmitter } = require('node:events'); const { PassThrough } = require('node:stream'); const requests = [];
  t.mock.method(cp, 'spawn', (executable, args, options) => {
    assert.equal(executable, 'ssh'); assert.equal(options.windowsHide, true); assert(args.includes('StrictHostKeyChecking=yes')); assert(args.includes('GlobalKnownHostsFile=NUL')); assert(args.includes(key));
    assert(path.isAbsolute(args[args.indexOf('-F') + 1]) && args[args.indexOf('-F') + 1].startsWith(f.root)); requests.push(args);
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    const command = args.at(-1); assert(command.startsWith("python3 -c '") && command.endsWith("'"));
    const script = command.slice(12, -1).replaceAll("'\\''", "'").replace(JSON.stringify('/home/research/jobs/' + b.id), JSON.stringify(remote));
    const output = cp.execFileSync((process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')), ['-c', script], { encoding: 'utf8', env: { ...process.env, TEMP: base, TMP: base, PYTHONDONTWRITEBYTECODE: '1' } });
    setImmediate(() => { child.stdout.end(output); child.emit('close', 0); }); return child;
  });
  const status = await transport.status(b); assert.equal(status.status, 'unknown'); assert(status.note.includes('未找到本实验进程')); assert(requests[0].at(-1).includes('runner.pid')); assert(requests[0].at(-1).includes('/proc')); assert(requests[0].at(-1).includes(b.manifestHash));
  await assert.rejects(transport.collect({ ...b, approvedAt: undefined }), /批准/);
});
