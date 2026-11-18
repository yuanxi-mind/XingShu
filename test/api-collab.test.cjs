'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = `D:\\Multi-Agent-test-${process.pid}`;
process.env.MULTI_AGENT_ROOT = root;
process.env.TEST_API_KEY = 'test-key';

const loadTs = require('./load-ts.cjs');
const { ApiCollabManager } = loadTs('src/main/apiCollab.ts');
const { DEFAULT_PROJECT_ROOT, ensureProjectLayout, isDDrivePath } = loadTs('src/main/storagePaths.ts');

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('storage paths and project layout stay on D drive', () => {
  assert.equal(isDDrivePath(DEFAULT_PROJECT_ROOT), true);
  const project = ensureProjectLayout(path.join(root, 'Project1'));
  assert.equal(isDDrivePath(project), true);
  for (const relative of ['WorkGroup', 'AgentChats', 'tasks', 'runs']) {
    assert.equal(fs.existsSync(path.join(project, relative)), true);
  }
  assert.equal(project.toUpperCase().startsWith('C:'), false);
});

test('projects use their folder names and keep collaboration data isolated', () => {
  const manager = new ApiCollabManager();
  const paper = manager.createProject('写论文');
  const improve = manager.createProject('完善东西');
  manager.sendWorkgroup({ projectId: paper.id, content: 'paper-only message' });
  manager.createTask({ projectId: paper.id, description: 'paper-only task' });

  const paperSnapshot = manager.snapshot(paper.id);
  const improveSnapshot = manager.snapshot(improve.id);
  assert.equal(paper.root, path.join(root, '写论文'));
  assert.equal(improve.root, path.join(root, '完善东西'));
  assert.equal(paperSnapshot.workgroup.length, 1);
  assert.equal(paperSnapshot.workgroup[0].content, 'paper-only message');
  assert.equal(paperSnapshot.tasks.length, 1);
  assert.equal(improveSnapshot.workgroup.length, 0);
  assert.equal(improveSnapshot.tasks.length, 0);
  assert.deepEqual(manager.listProjects().map((project) => project.id).filter((id) => id !== 'Project1'), ['完善东西', '写论文']);
  assert.throws(() => manager.createProject('../outside'), /文件名禁用字符/);
  assert.equal(fs.existsSync(path.join(path.dirname(root), 'outside')), false);
});

test('provider, dynamic runtime role, chats and tasks survive manager restart', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'relay reply' } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    manager.saveProvider({
      id: 'gpt', name: 'GPT', protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1',
      apiKeyRef: 'TEST_API_KEY', defaultModel: 'gpt-test', timeoutMs: 1000, enabled: true,
      stream: false, retryPolicy: { maxRetries: 0, backoffMs: 0 }
    });
    manager.saveAgent({ id: 'gpt', displayName: 'GPT', providerId: 'gpt', enabled: true });
    for (const id of ['claude', 'deepseek', 'gemini', 'grok']) {
      manager.saveAgent({ id, displayName: id, providerId: id, enabled: false });
    }
    const workgroup = manager.sendWorkgroup({ projectId: 'Project1', content: 'Design the method', runtimeRole: 'method designer' });
    const task = manager.createTask({ projectId: 'Project1', assignedAgentId: 'gpt', runtimeRole: 'experiment lead', description: 'Run baseline' });
    await manager.sendPrivate({ projectId: 'Project1', agentId: 'gpt', content: 'Prepare a proposal', runtimeRole: 'proposal writer' });
    assert.equal(calls.length, 1);

    const restarted = new ApiCollabManager();
    const snapshot = restarted.snapshot('Project1');
    assert.equal(snapshot.workgroup.at(-1).id, workgroup.id);
    assert.equal(snapshot.workgroup.at(-1).runtimeRole, 'method designer');
    assert.equal(snapshot.tasks.at(-1).runtimeRole, 'experiment lead');
    assert.equal(snapshot.privateChats.gpt.length, 2);
    assert.equal(snapshot.privateChats.gpt.at(-1).runtimeRole, 'proposal writer');
    assert.equal(Object.hasOwn(snapshot.agents.find((agent) => agent.id === 'gpt'), 'runtimeRole'), false);
    assert.equal(snapshot.projectRoot.toUpperCase().startsWith('C:'), false);
    assert.equal(fs.existsSync(path.join(snapshot.projectRoot, 'WorkGroup', 'messages.jsonl')), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('429 is retried according to provider policy', async () => {
  let attempts = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) return { ok: false, status: 429, text: async () => 'busy' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'after retry' } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    manager.saveProvider({
      id: 'gpt', name: 'GPT', protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1',
      apiKeyRef: 'TEST_API_KEY', defaultModel: 'gpt-test', timeoutMs: 1000, enabled: true,
      retryPolicy: { maxRetries: 1, backoffMs: 0 }
    });
    await manager.sendPrivate({ projectId: 'Project1', agentId: 'gpt', content: 'retry this' });
    assert.equal(attempts, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('private Agent model and reasoning effort are sent to the relay', async () => {
  const originalFetch = global.fetch;
  let requestBody;
  global.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'done' } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    manager.saveProvider({ id: 'gpt', name: 'GPT', protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1', apiKeyRef: 'TEST_API_KEY', defaultModel: 'default-model', timeoutMs: 1000, enabled: true, retryPolicy: { maxRetries: 0 } });
    manager.saveAgent({ id: 'gpt', displayName: 'GPT', providerId: 'gpt', model: 'custom-model', reasoningEffort: 'xhigh', enabled: true });
    await manager.sendPrivate({ projectId: 'Project1', agentId: 'gpt', content: 'Think carefully' });
    assert.equal(requestBody.model, 'custom-model');
    assert.equal(requestBody.reasoning_effort, 'xhigh');
  } finally {
    global.fetch = originalFetch;
  }
});

test('provider API keys use the secret store and survive manager restarts', async () => {
  const secret = 'persisted-relay-secret';
  const secretData = new Map();
  const secretStore = {
    get: (providerId) => secretData.get(providerId),
    has: (providerId) => secretData.has(providerId),
    set: (providerId, value) => secretData.set(providerId, value)
  };
  const originalFetch = global.fetch;
  let authorization;
  global.fetch = async (_url, init) => {
    authorization = init.headers.Authorization;
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'persisted reply' } }] }) };
  };
  try {
    const firstRun = new ApiCollabManager(secretStore);
    firstRun.saveProvider({ id: 'persisted-relay', name: 'Persisted relay', protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1', apiKeyRef: 'MISSING_PERSISTED_API_KEY', defaultModel: 'test-model', timeoutMs: 1000, enabled: true, retryPolicy: { maxRetries: 0 } });
    firstRun.saveAgent({ id: 'persisted-agent', displayName: 'Persisted Agent', providerId: 'persisted-relay', enabled: true });
    firstRun.setSecret('persisted-relay', secret);
    assert.equal(firstRun.providers().find((provider) => provider.id === 'persisted-relay').hasSecret, true);
    assert.equal(JSON.stringify(firstRun.providers()).includes(secret), false);
    assert.equal(fs.readFileSync(path.join(root, '_runtime', 'api-providers.json'), 'utf8').includes(secret), false);

    const afterRestart = new ApiCollabManager(secretStore);
    await afterRestart.sendPrivate({ projectId: 'Project1', agentId: 'persisted-agent', content: 'still configured' });
    assert.equal(authorization, `Bearer ${secret}`);
    afterRestart.saveAgent({ id: 'persisted-agent', displayName: 'Persisted Agent', providerId: 'persisted-relay', enabled: false });
  } finally {
    global.fetch = originalFetch;
  }
});

test('shared project files are attached to Agent requests', async () => {
  const originalFetch = global.fetch;
  let requestBody;
  const sharedRoot = path.join(root, 'Project1', 'WorkGroup', 'data');
  fs.mkdirSync(sharedRoot, { recursive: true });
  fs.writeFileSync(path.join(sharedRoot, 'baseline.md'), '# Baseline\nShared baseline content.', 'utf8');
  global.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '已读取共享资料' } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    manager.saveProvider({ id: 'gpt', name: 'GPT', protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1', apiKeyRef: 'TEST_API_KEY', defaultModel: 'gpt-test', timeoutMs: 1000, enabled: true, retryPolicy: { maxRetries: 0 } });
    manager.saveAgent({ id: 'gpt', displayName: 'GPT', providerId: 'gpt', enabled: true });
    await manager.sendPrivate({ projectId: 'Project1', agentId: 'gpt', content: '请根据项目资料说明 baseline' });
    const finalUserMessage = requestBody.messages.at(-1).content;
    assert.match(finalUserMessage, /WorkGroup\/data\/baseline\.md/);
    assert.match(finalUserMessage, /Shared baseline content/);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(path.join(sharedRoot, 'baseline.md'), { force: true });
  }
});

test('large requested files retrieve matching tail within the context limit', async () => {
  const originalFetch = global.fetch;
  let body;
  global.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'done' } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    const project = manager.createProject('large-search');
    const shared = path.join(project.root, 'WorkGroup', 'data');
    fs.writeFileSync(path.join(shared, 'large.txt'), 'ordinary filler '.repeat(80000) + '\nquartzneedle tail finding');
    fs.writeFileSync(path.join(shared, 'oversize.txt'), Buffer.alloc(20_000_001, 97));
    const privateDir = path.join(project.root, 'AgentChats', 'claude', 'data');
    fs.mkdirSync(privateDir, { recursive: true });
    fs.writeFileSync(path.join(privateDir, 'secret.txt'), 'quartzneedle private secret');
    await manager.sendPrivate({ projectId: project.id, agentId: 'gpt', content: 'large.txt quartzneedle oversize.txt' });
    const content = body.messages.at(-1).content;
    assert.match(content, /quartzneedle tail finding/);
    assert.match(content, /已按查询选取片段/);
    assert.match(content, /超过 20 MB/);
    assert.doesNotMatch(content, /private secret/);
    assert.ok(content.length < 125_000);
  } finally { global.fetch = originalFetch; }
});

test('private files stay with their owner, handoff is targeted, and versions preserve content', async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  global.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'done' } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    manager.saveProvider({ id: 'gpt', name: 'GPT', protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1', apiKeyRef: 'TEST_API_KEY', defaultModel: 'test', timeoutMs: 1000, enabled: true, retryPolicy: { maxRetries: 0 } });
    for (const id of ['gpt', 'claude']) manager.saveAgent({ id, displayName: id, providerId: 'gpt', enabled: true });
    const privateDir = path.join(root, 'Project1', 'AgentChats', 'gpt', 'data');
    fs.mkdirSync(privateDir, { recursive: true });
    fs.writeFileSync(path.join(privateDir, 'draft.txt'), 'private draft');
    await manager.sendPrivate({ projectId: 'Project1', agentId: 'gpt', content: 'read' });
    await manager.sendPrivate({ projectId: 'Project1', agentId: 'claude', content: 'read' });
    assert.match(bodies[0].messages.at(-1).content, /private draft/);
    assert.doesNotMatch(bodies[1].messages.at(-1).content, /private draft/);
    const version = manager.archiveFile('Project1', 'draft.txt', 'gpt');
    fs.writeFileSync(path.join(privateDir, 'draft.txt'), 'revised draft');
    assert.equal(fs.readFileSync(path.join(root, 'Project1', version), 'utf8'), 'private draft');
    const handed = manager.handoffFile('Project1', 'gpt', 'claude', 'draft.txt');
    assert.match(handed, /AgentChats\/claude\/data\/handoffs\/gpt\/draft.txt/);
    fs.writeFileSync(path.join(privateDir, 'draft.txt'), 'latest draft');
    manager.handoffFile('Project1', 'gpt', 'claude', 'draft.txt');
    assert.equal(fs.readFileSync(path.join(root, 'Project1', handed), 'utf8'), 'latest draft');
    const versionsDir = path.join(root, 'Project1', 'AgentChats', 'claude', 'versions');
    const archived = fs.readdirSync(versionsDir).map(dir => fs.readFileSync(path.join(versionsDir, dir, 'draft.txt'), 'utf8'));
    assert.ok(archived.includes('revised draft'));
    assert.throws(() => manager.handoffFile('Project1', 'gpt', 'claude', '../messages.jsonl'));
    await manager.sendPrivate({ projectId: 'Project1', agentId: 'claude', content: 'read' });
    assert.match(bodies[2].messages.at(-1).content, /latest draft/);
  } finally { global.fetch = originalFetch; }
});

test('PDF and DOCX content is extracted for the request', async () => {
  const originalFetch = global.fetch;
  let body;
  global.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'done' } }] }) };
  };
  const projectId = 'document-test';
  try {
    const manager = new ApiCollabManager();
    const project = manager.createProject(projectId);
    const data = path.join(project.root, 'WorkGroup', 'data');
    fs.copyFileSync(require.resolve('pdf-parse/test/data/01-valid.pdf'), path.join(data, 'paper.pdf'));
    fs.copyFileSync(require.resolve('mammoth/test/test-data/underline.docx'), path.join(data, 'draft.docx'));
    await manager.sendPrivate({ projectId, agentId: 'gpt', content: 'read paper.pdf and the documents' });
    const content = body.messages.at(-1).content;
    assert.match(content, /paper\.pdf/);
    assert.match(content, /draft\.docx/);
    assert.doesNotMatch(content, /\[读取失败\]/);
    assert.match(content, /The Sunset Tree/);
    assert.match(content, /Trace-based Just-in-Time/);
  } finally { global.fetch = originalFetch; }
});

test('shared and private images are sent only to the authorized Agent', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'done' } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    const project = manager.createProject('image-test');
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aS8AAAAASUVORK5CYII=', 'base64');
    fs.writeFileSync(path.join(project.root, 'WorkGroup', 'data', 'shared.png'), image);
    const own = path.join(project.root, 'AgentChats', 'gpt', 'data');
    fs.mkdirSync(own, { recursive: true });
    const privateImage = Buffer.concat([image, Buffer.from([0])]);
    fs.writeFileSync(path.join(own, 'private.png'), privateImage);
    for (const id of ['gpt', 'claude']) manager.saveAgent({ id, displayName: id, providerId: 'gpt', enabled: true });
    await manager.sendPrivate({ projectId: project.id, agentId: 'gpt', content: '看 shared.png 和 private.png' });
    await manager.sendPrivate({ projectId: project.id, agentId: 'claude', content: '看 shared.png' });
    manager.sendWorkgroup({ projectId: project.id, content: '@gpt 看 shared.png' });
    await manager.runCycle(project.id);
    await manager.sendPrivate({ projectId: project.id, agentId: 'gpt', content: '总结文字资料' });
    await manager.sendPrivate({ projectId: project.id, agentId: 'gpt', content: '看图片' });
    const ownContent = requests[0].messages.at(-1).content;
    const otherContent = requests[1].messages.at(-1).content;
    assert.match(JSON.stringify(ownContent), /shared\.png/);
    assert.match(JSON.stringify(ownContent), /private\.png/);
    assert.match(JSON.stringify(otherContent), /shared\.png/);
    assert.doesNotMatch(JSON.stringify(otherContent), /private\.png/);
    assert.ok(ownContent.some((part) => part.type === 'image_url' && part.image_url.url.startsWith('data:image/png;base64,')));
    assert.equal(JSON.stringify(otherContent).includes(privateImage.toString('base64')), false);
    assert.doesNotMatch(JSON.stringify(requests[2].messages.at(-1).content), /private\.png/);
    assert.equal(typeof requests[3].messages.at(-1).content, 'string');
    assert.match(requests[4].messages.at(-1).content, /请指定要读取的文件名/);
    assert.doesNotMatch(requests[4].messages.at(-1).content, /data:image/);
  } finally { global.fetch = originalFetch; }
});

test('agent directory junctions cannot redirect private context', async () => {
  const manager = new ApiCollabManager();
  const project = manager.createProject('junction-test');
  const chats = path.join(project.root, 'AgentChats');
  fs.mkdirSync(path.join(chats, 'claude', 'data'), { recursive: true });
  fs.symlinkSync(path.join(chats, 'claude'), path.join(chats, 'gpt'), 'junction');
  await assert.rejects(manager.sendPrivate({ projectId: project.id, agentId: 'gpt', content: 'read' }), /链接/);
});

test('linked project and message paths are rejected', () => {
  const manager = new ApiCollabManager();
  const project = manager.createProject('linked-messages');
  const chats = path.join(project.root, 'AgentChats');
  fs.mkdirSync(path.join(chats, 'gpt'));
  fs.writeFileSync(path.join(chats, 'other.jsonl'), 'private');
  try {
    fs.symlinkSync(path.join(chats, 'other.jsonl'), path.join(chats, 'gpt', 'messages.jsonl'), 'file');
    assert.throws(() => manager.snapshot(project.id), /链接/);
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
  }
  assert.equal(fs.readFileSync(path.join(chats, 'other.jsonl'), 'utf8'), 'private');
  const linked = path.join(root, 'linked-project');
  fs.mkdirSync(linked);
  fs.symlinkSync(path.join(project.root, 'WorkGroup'), path.join(linked, 'WorkGroup'), 'junction');
  assert.throws(() => manager.snapshot('linked-project'), /链接/);
});

test('tasks enforce dependencies, preserve revisions and recover interrupted runs', async () => {
  const originalFetch = global.fetch;
  let response = 'first result';
  let lastBody;
  global.fetch = async (_url, init) => {
    lastBody = JSON.parse(init.body);
    if (response === 'fail') throw new Error('provider unavailable');
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: response } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    const project = manager.createProject('task-workflow');
    const first = manager.createTask({ projectId: project.id, assignedAgentId: 'gpt', description: 'first' });
    const second = manager.createTask({ projectId: project.id, assignedAgentId: 'claude', description: 'second', dependsOn: [first.id] });
    const unassigned = manager.createTask({ projectId: project.id, description: 'assign later' });
    assert.equal(manager.assignTask(project.id, unassigned.id, 'gpt').assignedAgentId, 'gpt');
    assert.throws(() => manager.createTask({ projectId: project.id, description: 'bad', dependsOn: ['missing'] }), /前置任务/);
    await assert.rejects(manager.runTask(project.id, second.id), /前置任务/);
    const review = await manager.runTask(project.id, first.id);
    assert.equal(review.status, 'review');
    assert.equal(fs.readFileSync(path.join(project.root, review.resultReference), 'utf8'), 'first result');
    assert.equal(manager.readTaskResult(project.id, first.id), 'first result');
    await assert.rejects(manager.runTask(project.id, second.id), /前置任务/);
    manager.resolveTask(project.id, first.id, 'rework', 'fix the method');
    response = 'revised result';
    const revised = await manager.runTask(project.id, first.id);
    assert.match(lastBody.messages.at(-1).content, /上次成果：[\s\S]*first result/);
    assert.equal(revised.revisionCount, 1);
    assert.notEqual(revised.resultReference, review.resultReference);
    assert.equal(fs.readFileSync(path.join(project.root, review.resultReference), 'utf8'), 'first result');
    manager.resolveTask(project.id, first.id, 'approve');
    response = 'fail';
    await assert.rejects(manager.runTask(project.id, second.id), /provider unavailable/);
    assert.equal(new ApiCollabManager().snapshot(project.id).tasks.find((task) => task.id === second.id).status, 'failed');
    const file = path.join(project.root, 'tasks', 'tasks.json');
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    const interrupted = persisted.find((task) => task.id === second.id);
    interrupted.status = 'running';
    interrupted.runningProcessId = process.pid;
    interrupted.runningToken = 'old-process-token';
    fs.writeFileSync(file, JSON.stringify(persisted));
    assert.equal(manager.recoverInterruptedTasks(project.id), 1);
    assert.equal(manager.snapshot(project.id).tasks.find((task) => task.id === second.id).status, 'failed');
  } finally { global.fetch = originalFetch; }
});

test('workflow shares only authorized results and stops at the review limit', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  let workerCount = 0;
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const content = body.messages.at(-1).content;
    const review = typeof content === 'string' && content.includes('只返回 JSON');
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: review ? '{"decision":"rework","feedback":"fix","checks":[{"name":"result","ok":false,"note":"fix"}]}' : `worker result ${++workerCount}` } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    const project = manager.createProject('automatic-workflow');
    const first = manager.createTask({ projectId: project.id, assignedAgentId: 'gpt', description: 'first' });
    const firstResult = await manager.runTask(project.id, first.id);
    manager.resolveTask(project.id, first.id, 'approve');
    const privateDir = path.join(project.root, 'AgentChats', 'gpt', 'data');
    fs.writeFileSync(path.join(privateDir, 'secret.txt'), 'unrelated private secret');
    const second = manager.createTask({ projectId: project.id, assignedAgentId: 'claude', reviewerAgentId: 'gpt', description: 'second', dependsOn: [first.id], includeDependencyResults: true, maxRevisions: 1 });
    const workflow = await manager.runWorkflow(project.id);
    const stopped = workflow.tasks.find((task) => task.id === second.id);
    assert.equal(stopped.status, 'rework');
    assert.equal(stopped.revisionCount, 1);
    assert.match(stopped.error, /上限/);
    assert.equal(calls.length, 5);
    assert.match(calls[1].messages.at(-1).content, /worker result 1/);
    for (const call of [calls[2], calls[4]]) {
      assert.doesNotMatch(JSON.stringify(call.messages), /unrelated private secret/);
      assert.equal(call.messages.length, 2);
    }
    assert.equal(fs.readFileSync(path.join(project.root, firstResult.resultReference), 'utf8'), 'worker result 1');
    assert.equal(fs.readdirSync(path.join(project.root, 'AgentChats', 'claude', 'data', 'task-results', second.id)).length, 4);
  } finally { global.fetch = originalFetch; }
});

test('invalid automated review stays pending human review', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const review = body.messages.at(-1).content.includes('只返回 JSON');
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: review ? 'approve' : 'result' } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    const project = manager.createProject('invalid-review');
    const task = manager.createTask({ projectId: project.id, assignedAgentId: 'gpt', reviewerAgentId: 'claude', description: 'work' });
    const result = await manager.runTask(project.id, task.id);
    assert.equal(result.status, 'review');
    assert.match(result.error, /自动审核失败/);
  } finally { global.fetch = originalFetch; }
});

test('oversized result requires manual review', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'x'.repeat(200001) } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    const project = manager.createProject('oversize-review');
    const task = manager.createTask({ projectId: project.id, assignedAgentId: 'gpt', reviewerAgentId: 'claude', description: 'work' });
    const result = await manager.runTask(project.id, task.id);
    assert.equal(result.status, 'review');
    assert.match(result.error, /成果过长/);
    assert.equal(calls, 1);
  } finally { global.fetch = originalFetch; }
});

test('late review cannot approve a newer task result', async () => {
  const originalFetch = global.fetch;
  let release;
  let reviewStarted;
  const started = new Promise((resolve) => { reviewStarted = resolve; });
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.messages.at(-1).content.includes('只返回 JSON')) {
      reviewStarted();
      await new Promise((resolve) => { release = resolve; });
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"decision":"approve","feedback":"ok"}' } }] }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'first' } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    const project = manager.createProject('late-review');
    const task = manager.createTask({ projectId: project.id, assignedAgentId: 'gpt', reviewerAgentId: 'claude', description: 'work' });
    const running = manager.runTask(project.id, task.id);
    await started;
    manager.resolveTask(project.id, task.id, 'rework', 'revise');
    const file = path.join(project.root, 'tasks', 'tasks.json');
    const tasks = JSON.parse(fs.readFileSync(file, 'utf8'));
    tasks[0].status = 'review';
    tasks[0].resultReference = 'new-version.md';
    fs.writeFileSync(file, JSON.stringify(tasks));
    release();
    const result = await running;
    assert.equal(result.status, 'review');
    assert.equal(result.resultReference, 'new-version.md');
  } finally { global.fetch = originalFetch; }
});

test('supervisor receives only task metadata and reports failures', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (calls.length === 1) throw new Error('worker failed');
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'Inspect the failed task.' } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    const project = manager.createProject('supervised-workflow');
    const task = manager.createTask({ projectId: project.id, assignedAgentId: 'gpt', description: 'private task description' });
    const privateDir = path.join(project.root, 'AgentChats', 'claude', 'data');
    fs.mkdirSync(privateDir, { recursive: true });
    fs.writeFileSync(path.join(privateDir, 'secret.txt'), 'private memory');
    const result = await manager.runWorkflow(project.id, 'claude');
    assert.equal(result.stoppedTaskId, task.id);
    assert.match(result.error, /worker failed/);
    assert.equal(fs.readFileSync(path.join(project.root, result.supervisionReport), 'utf8'), 'Inspect the failed task.');
    assert.doesNotMatch(JSON.stringify(calls[1].messages), /private memory|private task description|worker failed/);
    assert.match(calls[1].messages.at(-1).content, /"failed"/);
    const resumed = await new ApiCollabManager().runWorkflow(project.id);
    assert.match(resumed.error, /worker failed/);
    global.fetch = async () => { throw new Error('supervisor unavailable'); };
    const failedSupervisor = await manager.runWorkflow(project.id, 'claude');
    assert.match(failedSupervisor.error, /worker failed/);
    assert.match(failedSupervisor.supervisorError, /supervisor unavailable/);
  } finally { global.fetch = originalFetch; }
});

test('workflow creation persists only user-defined tasks and runtime roles', () => {
  const manager = new ApiCollabManager();
  for (const id of ['gemini', 'claude', 'grok']) manager.saveAgent({ id, displayName: id, providerId: id, enabled: true });
  const project = manager.createProject('dynamic-workflow');
  const workflow = manager.createPaperWorkflow({ projectId: project.id, name: 'User flow', supervisorAgentId: 'gpt', tasks: [
    { key: 'draft', description: 'Draft section', assignedAgentId: 'gemini', runtimeRole: 'Section author', reviewerAgentId: 'claude', publishResult: true, maxRevisions: 2 },
    { key: 'integrate', description: 'Integrate draft', assignedAgentId: 'grok', runtimeRole: 'Integrator', dependsOnKeys: ['draft'], includeDependencyResults: true, publishResult: true }
  ] });
  assert.equal(workflow.taskIds.length, 2);
  const tasks = manager.snapshot(project.id).tasks;
  assert.deepEqual(tasks.map((task) => task.runtimeRole), ['Section author', 'Integrator']);
  assert.equal(tasks[0].assignedAgentId, 'gemini');
  assert.equal(tasks[0].reviewerAgentId, 'claude');
  assert.deepEqual(tasks[1].dependsOn, [tasks[0].id]);
  assert.equal(tasks[1].includeDependencyResults, true);
  assert.ok(fs.existsSync(path.join(project.root, workflow.reportReference)));
  const restarted = new ApiCollabManager().snapshot(project.id);
  assert.equal(restarted.tasks.length, 2);
  assert.throws(() => manager.createWorkflow({ projectId: project.id, tasks: [
    { key: 'a', description: 'a', assignedAgentId: 'gpt', dependsOnKeys: ['b'] },
    { key: 'b', description: 'b', assignedAgentId: 'gpt', dependsOnKeys: ['a'] }
  ] }), /循环/);
  assert.equal(manager.snapshot(project.id).tasks.length, 2);
});

test('user-defined workflow runs tasks, publishes shared drafts, and writes final report', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const prompt = body.messages.at(-1).content;
    const content = typeof prompt === 'string' && prompt.includes('严格只返回 JSON')
      ? JSON.stringify({ decision: 'approve', feedback: '通过', checks: [{ name: 'result', ok: true, note: '' }] })
      : `完成：${typeof prompt === 'string' ? prompt.slice(0, 20) : '任务'}`;
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    manager.saveProvider({ id: 'relay', name: 'Relay', protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1', apiKeyRef: 'TEST_API_KEY', defaultModel: 'gpt-6.1-sol', timeoutMs: 1000, enabled: true, retryPolicy: { maxRetries: 0 } });
    for (const id of ['gpt', 'claude', 'deepseek', 'gemini', 'grok']) manager.saveAgent({ id, displayName: id, providerId: 'relay', enabled: true });
    const project = manager.createProject('paper-run');
    manager.createWorkflow({ projectId: project.id, supervisorAgentId: 'deepseek', tasks: [
      { key: 'one', description: 'first', assignedAgentId: 'gpt', reviewerAgentId: 'deepseek', runtimeRole: 'First author', publishResult: true },
      { key: 'two', description: 'second', assignedAgentId: 'claude', reviewerAgentId: 'deepseek', runtimeRole: 'Second author', publishResult: true },
      { key: 'final', description: 'integrate', assignedAgentId: 'gemini', reviewerAgentId: 'deepseek', runtimeRole: 'Editor', dependsOnKeys: ['one', 'two'], includeDependencyResults: true, publishResult: true },
      { key: 'review', description: 'review', assignedAgentId: 'deepseek', reviewerAgentId: 'deepseek', runtimeRole: 'Lead', dependsOnKeys: ['final'], includeDependencyResults: true, publishResult: true }
    ] });
    const result = await manager.runWorkflow(project.id, 'deepseek');
    assert.equal(result.tasks.every((task) => task.status === 'done'), true);
    assert.match(result.finalReportReference, /WorkGroup[\\/]data[\\/]reports[\\/]workflow-final/);
    assert.ok(fs.existsSync(path.join(project.root, result.finalReportReference)));
    assert.ok(fs.existsSync(path.join(project.root, 'WorkGroup', 'data', 'reports', 'task-results')));
  } finally { global.fetch = originalFetch; }
});

test('proposal baseline hashes, checker permissions and accepted append are enforced', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => { const body = JSON.parse(init.body); const prompt = body.messages.at(-1).content; const content = typeof prompt === 'string' && prompt.includes('严格只返回 JSON') ? JSON.stringify({ decision: 'approve', feedback: '通过', checks: [{ name: 'result', ok: true, note: '' }] }) : 'result'; return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) }; };
  try {
    const manager = new ApiCollabManager();
    manager.saveProvider({ id: 'gpt', name: 'GPT', protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1', apiKeyRef: 'TEST_API_KEY', defaultModel: 'test', timeoutMs: 1000, enabled: true, retryPolicy: { maxRetries: 0 } });
    manager.saveAgent({ id: 'worker-x', displayName: 'Worker X', providerId: 'gpt', enabled: true, permissionProfile: 'worker' });
    manager.saveAgent({ id: 'checker-x', displayName: 'Checker X', providerId: 'gpt', enabled: true, permissionProfile: 'checker' });
    const project = manager.createProject('permission-hash');
    const work = path.join(project.root, 'WorkGroup', 'data');
    fs.writeFileSync(path.join(work, 'proposal.md'), 'proposal v1');
    fs.writeFileSync(path.join(work, 'baseline.md'), 'baseline v1');
    const task = manager.createTask({ projectId: project.id, assignedAgentId: 'worker-x', reviewerAgentId: 'checker-x', description: 'implement', proposalReference: 'WorkGroup/data/proposal.md', baselineReference: 'WorkGroup/data/baseline.md', publishResult: true });
    fs.writeFileSync(path.join(work, 'baseline.md'), 'tampered');
    await assert.rejects(manager.runTask(project.id, task.id), /baseline 已被修改/);
    fs.writeFileSync(path.join(work, 'baseline.md'), 'baseline v1');
    const result = await manager.runTask(project.id, task.id);
    assert.equal(result.publishStatus, 'proposed');
    assert.equal(result.workspaceReference, `runs/${task.id}/workspaces/worker-x`);
    assert.equal(typeof result.workspaceHash, 'string');
    assert.ok(Array.isArray(result.changedFiles));
    const accepted = manager.acceptTaskResult(project.id, task.id);
    assert.equal(accepted.publishStatus, 'accepted');
    const acceptedDir = path.join(project.root, 'WorkGroup', 'data', 'reports', 'accepted');
    assert.equal(fs.readdirSync(acceptedDir).length, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(acceptedDir, `${task.id}.metadata.json`), 'utf8')).resultHash, result.resultHash);
  } finally { global.fetch = originalFetch; }
});

test('directory baselines are copied into an isolated workspace with a recursive manifest', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'directory result' } }] }) });
  try {
    const manager = new ApiCollabManager();
    manager.saveProvider({ id: 'directory-relay', name: 'Directory relay', protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1', apiKeyRef: 'TEST_API_KEY', defaultModel: 'test', timeoutMs: 1000, enabled: true, retryPolicy: { maxRetries: 0 } });
    manager.saveAgent({ id: 'worker-directory', displayName: 'Directory worker', providerId: 'directory-relay', enabled: true, permissionProfile: 'worker' });
    const project = manager.createProject('directory-baseline');
    const baseline = path.join(project.root, 'WorkGroup', 'code', 'baseline');
    fs.mkdirSync(path.join(baseline, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(baseline, 'main.py'), 'main');
    fs.writeFileSync(path.join(baseline, 'nested', 'helper.py'), 'helper');
    const task = manager.createTask({ projectId: project.id, assignedAgentId: 'worker-directory', description: 'copy directory', baselineReference: 'WorkGroup/code/baseline' });
    assert.equal(task.baselineManifest.length, 2);
    const result = await manager.runTask(project.id, task.id);
    assert.equal(result.changedFiles.length, 0);
    assert.equal(fs.readFileSync(path.join(project.root, result.workspaceReference, 'nested', 'helper.py'), 'utf8'), 'helper');
  } finally { global.fetch = originalFetch; }
});

test('directory baseline retries and rework preserve the initialized workspace across restart', async () => {
  const originalFetch = global.fetch;
  try {
    const rootManager = new ApiCollabManager();
    const project = rootManager.createProject('baseline-retry');
    const manager = rootManager.forProject(project.id);
    manager.saveProvider({ id: 'retry-baseline', name: 'Offline', protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1', apiKeyRef: 'TEST_API_KEY', defaultModel: 'test', timeoutMs: 1000, enabled: true, retryPolicy: { maxRetries: 0 } });
    manager.saveAgent({ id: 'retry-worker', displayName: 'Worker', providerId: 'retry-baseline', enabled: true });
    const baseline = path.join(project.root, 'WorkGroup/data/baseline');
    fs.mkdirSync(baseline, { recursive: true });
    fs.writeFileSync(path.join(baseline, 'main.py'), 'original');
    fs.writeFileSync(path.join(baseline, 'remove.py'), 'original helper');
    const task = manager.createTask({ projectId: project.id, assignedAgentId: 'retry-worker', description: 'offline retry', baselineReference: 'WorkGroup/data/baseline' });
    global.fetch = async () => { throw new Error('offline interruption'); };
    await assert.rejects(manager.runTask(project.id, task.id), /offline interruption/);
    const failed = manager.snapshot(project.id).tasks.find(item => item.id === task.id);
    assert.ok(failed.workspaceReference);
    const workspace = path.join(project.root, failed.workspaceReference);
    fs.writeFileSync(path.join(workspace, 'main.py'), 'my edit');
    fs.unlinkSync(path.join(workspace, 'remove.py'));
    manager.saveAgent({ id: 'retry-other', displayName: 'Other', providerId: 'retry-baseline', enabled: true });
    manager.assignTask(project.id, task.id, 'retry-other');
    await assert.rejects(manager.runTask(project.id, task.id), /offline interruption/);
    const otherWorkspace = manager.snapshot(project.id).tasks.find(item => item.id === task.id).workspaceReference;
    assert.equal(fs.readFileSync(path.join(project.root, otherWorkspace, 'main.py'), 'utf8'), 'original');
    manager.assignTask(project.id, task.id, 'retry-worker');
    global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'offline result' } }] }) });
    const restarted = new ApiCollabManager().forProject(project.id);
    await restarted.runTask(project.id, task.id);
    restarted.resolveTask(project.id, task.id, 'rework', 'keep working');
    const revised = await restarted.runTask(project.id, task.id);
    assert.equal(revised.status, 'review');
    assert.equal(fs.readFileSync(path.join(workspace, 'main.py'), 'utf8'), 'my edit');
    assert.equal(fs.existsSync(path.join(workspace, 'remove.py')), false);
    assert.deepEqual(revised.changedFiles, ['main.py', 'remove.py']);
    assert.equal(fs.readFileSync(path.join(baseline, 'main.py'), 'utf8'), 'original');
    assert.equal(fs.readFileSync(path.join(baseline, 'remove.py'), 'utf8'), 'original helper');
  } finally { global.fetch = originalFetch; }
});

test('workflow execution follows dependencies even when task definitions are listed out of order', async () => {
  const originalFetch = global.fetch;
  const prompts = [];
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    prompts.push(body.messages.at(-1).content);
    const userPrompt = body.messages.at(-1).content;
    const content = typeof userPrompt === 'string' && userPrompt.includes('严格只返回 JSON')
      ? JSON.stringify({ decision: 'approve', feedback: '通过', checks: [{ name: 'result', ok: true, note: '' }] }) : 'complete';
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    manager.saveProvider({ id: 'relay', name: 'Relay', protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1', apiKeyRef: 'TEST_API_KEY', defaultModel: 'test', timeoutMs: 1000, enabled: true, retryPolicy: { maxRetries: 0 } });
    manager.saveAgent({ id: 'gpt', displayName: 'GPT', providerId: 'relay', enabled: true });
    const project = manager.createProject('workflow-order');
    manager.createWorkflow({ projectId: project.id, tasks: [
      { key: 'later', description: 'second by dependency', assignedAgentId: 'gpt', reviewerAgentId: 'gpt', dependsOnKeys: ['first'] },
      { key: 'first', description: 'first by dependency', assignedAgentId: 'gpt', reviewerAgentId: 'gpt' }
    ] });
    const result = await manager.runWorkflow(project.id);
    assert.match(prompts.find((prompt) => prompt.startsWith('first by dependency')), /^first by dependency/);
    assert.match(prompts.find((prompt) => prompt.startsWith('second by dependency')), /^second by dependency/);
    assert.ok(result.finalReportReference);
  } finally { global.fetch = originalFetch; }
});

test('group agents follow the user-provided speaking order', async () => {
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const model = body.model;
    const content = model === 'deepseek-test' ? 'DeepSeek response.' : 'GPT completed the method check.';
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    for (const [id, model] of [['deepseek', 'deepseek-test'], ['gpt', 'gpt-test']]) {
      manager.saveProvider({
        id, name: id, protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1',
        apiKeyRef: 'TEST_API_KEY', defaultModel: model, timeoutMs: 1000, enabled: true,
        retryPolicy: { maxRetries: 0, backoffMs: 0 }
      });
      manager.saveAgent({ id, displayName: id, providerId: id, model, enabled: true });
    }
    for (const id of ['claude', 'gemini', 'grok']) manager.saveAgent({ id, displayName: id, providerId: id, enabled: false });
    for (const id of ['worker-x', 'checker-x', 'worker-directory']) manager.saveAgent({ id, displayName: id, providerId: id, enabled: false });
    manager.sendWorkgroup({ projectId: 'Project1', content: '@全体 Check the method logic', speakerOrder: ['DeepSeek', 'GPT'] });
    const result = await manager.runCycle('Project1');
    assert.equal(result.ok, true);
    assert.equal(requests[0].model, 'deepseek-test');
    assert.equal(requests[1].model, 'gpt-test');
    assert.match(requests[1].messages.at(-1).content, /deepseek: DeepSeek response/);
    assert.equal(result.responses.filter((message) => message.status === 'complete').length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('group routing requires mentions and calls only explicitly mentioned agents', async () => {
  const requestedModels = [];
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    requestedModels.push(JSON.parse(init.body).model);
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'reply' } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    for (const id of ['gpt', 'claude', 'deepseek']) {
      manager.saveProvider({ id, name: id, protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1', apiKeyRef: 'TEST_API_KEY', defaultModel: `${id}-test`, timeoutMs: 1000, enabled: true, retryPolicy: { maxRetries: 0 } });
      manager.saveAgent({ id, displayName: id === 'gpt' ? 'GPT' : id, providerId: id, model: `${id}-test`, enabled: true });
    }
    for (const id of ['gemini', 'grok']) manager.saveAgent({ id, displayName: id, providerId: id, enabled: false });
    manager.sendWorkgroup({ projectId: 'Project1', content: '普通群消息' });
    const noMention = await manager.runCycle('Project1');
    assert.equal(noMention.ok, false);
    assert.match(noMention.error, /@Agent/);
    assert.equal(requestedModels.length, 0);

    manager.sendWorkgroup({ projectId: 'Project1', content: '@GPT only GPT should answer' });
    const onlyGpt = await manager.runCycle('Project1');
    assert.equal(onlyGpt.ok, true);
    assert.deepEqual(requestedModels, ['gpt-test']);
    assert.deepEqual(onlyGpt.responses.map((message) => message.senderId), ['gpt']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('custom group membership and messages persist independently', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'group reply' } }] }) });
  try {
    const manager = new ApiCollabManager();
    for (const id of ['gpt', 'claude']) {
      manager.saveProvider({ id, name: id, protocol: 'openai-compatible', baseUrl: 'https://relay.test/v1', apiKeyRef: 'TEST_API_KEY', defaultModel: `${id}-test`, timeoutMs: 1000, enabled: true, retryPolicy: { maxRetries: 0 } });
      manager.saveAgent({ id, displayName: id === 'gpt' ? 'GPT' : 'Claude', providerId: id, enabled: true });
    }
    for (const id of ['deepseek', 'gemini', 'grok']) manager.saveAgent({ id, displayName: id, providerId: id, enabled: false });
    manager.saveAgent({ id: 'agent-reviewer', displayName: '审稿助手', providerId: 'gpt', model: 'review-model', enabled: true });
    const workgroupCount = manager.snapshot('Project1').workgroup.length;
    const group = manager.createGroup({ projectId: 'Project1', name: '论文小组', memberAgentIds: ['gpt'] });
    manager.renameGroup('Project1', 'workgroup', '论文总群');
    assert.equal(manager.snapshot('Project1').groups.find((item) => item.id === 'workgroup').name, '论文总群');
    manager.sendGroup({ projectId: 'Project1', conversationId: group.id, content: '@GPT review this draft' });
    const result = await manager.runCycle('Project1', group.id);
    assert.equal(result.ok, true);
    const restarted = new ApiCollabManager().snapshot('Project1');
    assert.equal(restarted.groups.find((item) => item.id === 'workgroup').name, '论文总群');
    assert.equal(restarted.agents.find((item) => item.id === 'agent-reviewer').model, 'review-model');
    assert.equal(restarted.groups.find((item) => item.id === group.id).name, '论文小组');
    assert.deepEqual(restarted.groups.find((item) => item.id === group.id).memberAgentIds, ['gpt']);
    assert.equal(restarted.groupChats[group.id].length, 2);
    assert.equal(restarted.workgroup.length, workgroupCount);
  } finally {
    global.fetch = originalFetch;
  }
});
