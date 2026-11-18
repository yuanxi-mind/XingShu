'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(`D:/Multi-Agent/_runtime/tests/relay-isolation-${process.pid}`);
process.env.MULTI_AGENT_ROOT = root;
const { ApiCollabManager } = require('./load-ts.cjs')('src/main/apiCollab.ts');

test.after(() => {
  assert.equal(path.dirname(root), path.resolve('D:/Multi-Agent/_runtime/tests'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('five agents route to independent relay endpoints, keys, and model selections', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, authorization: init.headers.Authorization, model: JSON.parse(init.body).model });
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'offline fixture' } }] }) };
  };
  try {
    const manager = new ApiCollabManager();
    const project = manager.createProject('独立中转连接验收');
    const ids = ['gpt', 'claude', 'deepseek', 'gemini', 'grok'];
    for (const id of ids) {
      manager.saveProvider({ id: 'isolated-' + id, name: id, protocol: 'openai-compatible', baseUrl: `https://${id}.relay.invalid/v1`, apiKeyRef: '', defaultModel: 'provider-default', timeoutMs: 1000, enabled: true, retryPolicy: { maxRetries: 0 } });
      manager.setSecret('isolated-' + id, 'fixture-key-' + id);
      manager.saveAgent({ id, displayName: id, providerId: 'isolated-' + id, model: 'selected-model-' + id, enabled: true });
      await manager.sendPrivate({ projectId: project.id, agentId: id, content: 'Local routing check' });
    }
    assert.deepEqual(calls, ids.map((id) => ({ url: `https://${id}.relay.invalid/v1/chat/completions`, authorization: 'Bearer fixture-key-' + id, model: 'selected-model-' + id })));
  } finally { global.fetch = originalFetch; }
});
