const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(`D:/Multi-Agent/_runtime/tests/chat-backgrounds-${process.pid}`);
process.env.MULTI_AGENT_ROOT = root;
const { ApiCollabManager } = require('./load-ts.cjs')('src/main/apiCollab.ts');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ahtsAAAAASUVORK5CYII=', 'base64');
let sequence = 0;
function fixture() {
  const manager = new ApiCollabManager();
  const project = manager.createProject('背景测试-' + ++sequence);
  const source = 'WorkGroup/artifacts/images/source.png';
  fs.mkdirSync(path.dirname(path.join(project.root, source)), { recursive: true });
  fs.writeFileSync(path.join(project.root, source), png);
  return { manager, project, source };
}
test.after(() => { assert.equal(path.dirname(root), path.resolve('D:/Multi-Agent/_runtime/tests')); fs.rmSync(root, { force: true, recursive: true }); });

test('manual background copies the project image on D, persists, and keeps previous versions', () => {
  const { manager, project, source } = fixture();
  let notifications = 0;
  manager.onImageUpdate((id) => { assert.equal(id, project.id); notifications++; });
  manager.setChatBackground(project.id, 'workgroup', source);
  const first = manager.snapshot(project.id).imageStudio.conversationBackgrounds.workgroup;
  assert(first.startsWith('runs/appearance/backgrounds/'));
  assert.deepEqual(fs.readFileSync(path.join(project.root, first)), png);
  manager.setChatBackground(project.id, 'workgroup', source);
  const second = new ApiCollabManager().snapshot(project.id).imageStudio.conversationBackgrounds.workgroup;
  assert.notEqual(first, second);
  assert(fs.existsSync(path.join(project.root, first)));
  assert.deepEqual(fs.readFileSync(path.join(project.root, source)), png);
  assert.equal(notifications, 2);
});

test('workgroup, custom group, private chats and projects keep independent backgrounds', () => {
  const { manager, project, source } = fixture();
  const group = manager.createGroup({ projectId: project.id, name: '设计群', memberAgentIds: ['gpt', 'claude'] });
  for (const id of ['workgroup', group.id, 'private:gpt']) manager.setChatBackground(project.id, id, source);
  const backgrounds = manager.snapshot(project.id).imageStudio.conversationBackgrounds;
  assert.equal(Object.keys(backgrounds).length, 3);
  assert.equal(new Set(Object.values(backgrounds)).size, 3);
  assert.equal(backgrounds['private:claude'], undefined);
  const other = manager.createProject('另一个项目-' + ++sequence);
  assert.deepEqual(manager.snapshot(other.id).imageStudio.conversationBackgrounds, {});
  manager.setChatBackground(project.id, 'private:gpt', null);
  assert.equal(new ApiCollabManager().snapshot(project.id).imageStudio.conversationBackgrounds['private:gpt'], null);
  assert(fs.existsSync(path.join(project.root, backgrounds['private:gpt'])));
  assert.equal(manager.snapshot(project.id).imageStudio.conversationBackgrounds.workgroup, backgrounds.workgroup);
});

test('native picker import copies a local image without changing source or global agent visuals', () => {
  const { manager, project } = fixture();
  const local = path.join(root, 'user-selected.png');
  fs.writeFileSync(local, png);
  const visualsPath = path.join(root, '_runtime/agent-visuals.json');
  const visuals = { avatars: { gpt: 'existing-avatar.png' }, backgrounds: { gpt: 'existing-background.png' } };
  fs.writeFileSync(visualsPath, JSON.stringify(visuals));
  const previous = global.fetch;
  global.fetch = async () => { throw new Error('Background changes must not call a provider'); };
  try {
    manager.importChatBackground(project.id, 'private:gpt', local);
    const result = manager.snapshot(project.id).imageStudio;
    assert.deepEqual(result.visuals, visuals);
    assert.deepEqual(fs.readFileSync(path.join(project.root, result.conversationBackgrounds['private:gpt'])), png);
    assert.deepEqual(fs.readFileSync(local), png);
    assert.equal(result.jobs.length, 0);
  } finally { global.fetch = previous; }
});

test('invalid conversation, escaping paths, unsupported or oversized files cannot change backgrounds', () => {
  const { manager, project, source } = fixture();
  manager.setChatBackground(project.id, 'workgroup', source);
  const before = manager.snapshot(project.id).imageStudio.conversationBackgrounds;
  for (const id of ['private:missing', 'missing-group', '__proto__', null]) assert.throws(() => manager.setChatBackground(project.id, id, source), /会话不存在/);
  assert.throws(() => manager.setChatBackground(project.id, 'workgroup', path.join(project.root, source)), /相对路径/);
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'outside.png'), png);
  assert.throws(() => manager.setChatBackground(project.id, 'workgroup', '../outside/outside.png'), /当前项目/);
  fs.symlinkSync(outside, path.join(project.root, 'outside-link'), 'junction');
  assert.throws(() => manager.setChatBackground(project.id, 'workgroup', 'outside-link/outside.png'), /当前项目/);
  fs.writeFileSync(path.join(project.root, 'bad.png'), 'not an image');
  assert.throws(() => manager.setChatBackground(project.id, 'workgroup', 'bad.png'), /文件内容/);
  fs.writeFileSync(path.join(project.root, 'bad.svg'), '<svg/>');
  assert.throws(() => manager.setChatBackground(project.id, 'workgroup', 'bad.svg'), /PNG/);
  fs.writeFileSync(path.join(project.root, 'large.png'), Buffer.alloc(10 * 1024 * 1024 + 1));
  assert.throws(() => manager.setChatBackground(project.id, 'workgroup', 'large.png'), /10 MB/);
  assert.throws(() => manager.importChatBackground(project.id, 'workgroup', '\\\\server\\image.png'), /本机磁盘/);
  assert.deepEqual(manager.snapshot(project.id).imageStudio.conversationBackgrounds, before);
});
