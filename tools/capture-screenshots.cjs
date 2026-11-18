'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const cp = require('node:child_process');

async function capture({ app, page, project }) {
  const destination = path.resolve(__dirname, '../docs/screenshots');
  fs.mkdirSync(destination, { recursive: true });
  const snapshot = await page.evaluate(id => window.cth.apiCollabSnapshot(id), project.id);
  // Only the newly-created offline fixture is touched. Never point this at live data.
  assert(/fixture-\d+/u.test(project.root) && /[Dd]:[\\/]/u.test(project.root));
  await page.evaluate(async ({ projectId, agents }) => {
    for (const agent of agents) await window.cth.apiCollabSaveAgent({ ...agent, displayName: agent.id === 'a' ? 'GPT' : 'Claude', avatarPreset: agent.id === 'a' ? 'gpt' : 'claude' }, projectId);
    for (const [id, displayName] of [['gemini', 'Gemini'], ['grok', 'Grok'], ['deepseek', 'DeepSeek']]) {
      await window.cth.apiCollabSaveAgent({ id, displayName, providerId: 'a', model: 'fixture-' + id, enabled: true, apiMode: 'agent', avatarPreset: id }, projectId);
    }
    const key = `tongzhou-appearance:project:${projectId}`;
    const old = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({ ...old, theme: 'light', fontSize: 15 }));
  }, { projectId: project.id, agents: snapshot.agents });

  const text = [
    ['human', '@全体 先独立分析 baseline，方案私聊给我。本轮不改代码，不读取其他人的私人资料。'],
    ['a', '我会对照论文与代码，记录改进猜想、证据和实施步骤。'],
    ['b', '我先独立核对 baseline 的假设与实现，不替其他人预设结论。'],
    ['gemini', '资料不足时标记缺口，来源保留原文片段，不将推测写成事实。'],
    ['grok', '先保留可验证的研究问题，未经你采纳不会修改公共代码。'],
    ['deepseek', '方案保存在自己的猜想盒。是否开会、如何分工，等你决定。']
  ];
  const now = Date.now();
  const messages = text.map(([senderId, content], i) => ({ id: 'demo-message-' + i, projectId: project.id, channel: 'workgroup', conversationId: 'workgroup', senderId, content, status: 'complete', createdAt: new Date(now - (text.length - i) * 90000).toISOString() }));
  fs.writeFileSync(path.join(project.root, 'WorkGroup/messages.jsonl'), messages.map(m => JSON.stringify(m)).join('\n') + '\n');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await page.getByRole('button', { name: project.name, exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('.tz-message').last().waitFor();
  await page.locator('.tz-chat-body').evaluate(el => { el.scrollTop = el.scrollHeight; });

  async function shot(name) {
    await page.evaluate(() => {
      if (!document.getElementById('screenshot-demo-label')) {
        const label = document.createElement('div'); label.id = 'screenshot-demo-label';
        label.textContent = '离线演示数据 · 非真实科研结果';
        Object.assign(label.style, { position: 'fixed', right: '18px', bottom: '12px', zIndex: '2147483647', padding: '5px 10px', borderRadius: '8px', font: '11px "Microsoft YaHei UI",sans-serif', color: '#fff', background: '#46405e', pointerEvents: 'none' });
        document.body.appendChild(label);
      }
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.showInactive());
    await page.screenshot({ path: path.join(destination, name + '.png'), scale: 'css', animations: 'disabled' });
    console.log('SCREENSHOT ' + name);
  }
  const button = name => page.getByRole('button', { name, exact: true });
  await shot('01-chat');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: /科研工作台|公共资料、私人盒子与创新实验/u }).click();
  await button(/^方案与实验/u).click();
  const proposal = (await page.evaluate(id => window.cth.apiCollabResearchSnapshot(id), project.id)).proposals[0];
  await page.getByRole('button').filter({ has: page.getByText(proposal.title, { exact: true }) }).click();
  await page.locator('.rw-review').first().waitFor();
  await page.locator('summary').filter({ hasText: /^实际文件变动/u }).evaluate(el => { const sc = el.closest('.rw-content'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 20; });
  await shot('02-proposal');
  await button('证据追溯').click();
  await button('刷新证据链').click();
  await page.locator('.rt-evidence-conclusion').waitFor();
  await page.locator('.rt-evidence-code').first().evaluate(el => { const sc = el.closest('.rw-content'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 20; });
  await shot('03-evidence');
  await button('可复现实验').click();
  const bundles = await page.evaluate(id => window.cth.apiCollabExperimentSnapshot(id), project.id);
  const candidate = bundles.bundles.find(bundle => !bundle.proposalId.startsWith('baseline:'));
  const baseline = bundles.bundles.find(bundle => bundle.proposalId.startsWith('baseline:'));
  const experiment = page.getByRole('region', { name: '可复现实验', exact: true });
  await experiment.getByLabel('查看实验包', { exact: true }).selectOption(candidate.id);
  await experiment.getByLabel('对照实验包', { exact: true }).selectOption(baseline.id);
  await experiment.getByLabel('候选实验包', { exact: true }).selectOption(candidate.id);
  await button('核对可比条件并计算差值').click();
  await page.getByText(/均值差=0.5000/u).waitFor();
  await page.locator('.rt-bundle').scrollIntoViewIfNeeded();
  await shot('04-experiments');
  await button('能力评测').click();
  const evaluations = await page.evaluate(id => window.cth.apiCollabBenchmarkSnapshot(id), project.id);
  const offline = evaluations.runs.find(run => run.mode === 'offline');
  await page.locator('label').filter({ hasText: /^查看哪次评测/u }).locator('select').selectOption(offline.id);
  await page.getByText('离线自检 · 不代表模型成绩', { exact: true }).waitFor();
  await page.locator('.rt-result-heading').evaluate(el => { const sc = el.closest('.rw-content'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 20; });
  await shot('05-benchmark');
  assert.deepEqual(errors, []);
  const version = await app.evaluate(({ app }) => app.getVersion());
  assert.equal(version, require('../package.json').version);
  console.log(JSON.stringify({ screenshotCount: 5, version, viewports: ['1440x1100', '1440x1000'], data: 'synthetic fixtures only', rendererErrors: errors.length }));
}

module.exports = { capture };
if (require.main === module) {
  const result = cp.spawnSync(process.execPath, [path.join(__dirname, 'verify-research-intelligence.cjs')], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, XINGSHU_CAPTURE_SCREENSHOTS: '1' }, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
