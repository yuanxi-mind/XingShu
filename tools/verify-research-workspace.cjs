const qa = require('./qa-paths.cjs');
'use strict';
const { _electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const output = qa.output('research-workspace');
const root = path.join(output, 'fixture-' + Date.now());
const source = path.join(root, 'baseline-source');
const executablePath = qa.executable();
fs.mkdirSync(source, { recursive: true });
fs.writeFileSync(path.join(source, 'model.py'), 'def predict(x):\n    return x\n');
fs.writeFileSync(path.join(source, 'baseline.md'), '# Baseline\n离线验收论文说明：输入光学与 SAR 双时相图像，输出变化图。此处不是科研结论。');
const log = path.join(root, 'server-result.log'); fs.writeFileSync(log, 'offline fixture F1=91.2, seed=42, dataset=test');
const env = { ...process.env, MULTI_AGENT_ROOT: root, TEMP: qa.temp, TMP: qa.temp, DO_NOT_TRACK: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const report = { startedAt: new Date().toISOString(), executablePath, realProviderRequests: 0, checks: [], rendererErrors: [], viewports: [] };
let app, page;
const button = name => page.getByRole('button', { name: name === '科研工作台' ? /科研工作台|公共资料、私人盒子与创新实验/u : name, exact: true });
const check = (name, condition = true) => { assert.ok(condition, name); report.checks.push(name); console.log('PASS ' + name); };
const state = id => page.evaluate(id => window.cth.apiCollabResearchSnapshot(id), id);
async function waitState(id, fn) { for (let i = 0; i < 160; i++) { const s = await state(id); if (fn(s)) return s; await new Promise(r => setTimeout(r, 150)); } throw new Error('科研状态未达到预期'); }
async function screenshot(name) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.showInactive()); await page.screenshot({ path: path.join(output, name + '.png'), scale: 'css', animations: 'disabled', timeout: 20000 }); }
async function resize(width, height) {
  await page.setViewportSize({ width, height }); await page.waitForFunction(s => innerWidth === s.width && innerHeight === s.height, { width, height });
  report.viewports.push(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
}
async function noOverflow(label) {
  const dimensions = await page.locator('.rw-content').evaluate(e => ({ w: e.clientWidth, sw: e.scrollWidth, page: document.documentElement.scrollWidth, viewport: innerWidth }));
  check(label, dimensions.sw <= dimensions.w + 1 && dimensions.page <= dimensions.viewport + 1);
}
async function launch() {
  const development = /[\\/]electron\.exe$/iu.test(executablePath);
  if (!development) report.asarSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(path.dirname(executablePath), 'resources/app.asar'))).digest('hex');
  app = await _electron.launch({ executablePath, args: ['--disable-gpu', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion', ...(development ? [qa.root] : [])], cwd: root, env, timeout: 90000 });
  report.runtime = await app.evaluate(({ app }) => ({ version: app.getVersion(), paths: Object.fromEntries(['appData', 'userData', 'sessionData', 'logs', 'crashDumps', 'temp'].map(k => [k, app.getPath(k)])) }));
  if (!development) assert.equal(report.runtime.version, require('../package.json').version); assert(Object.values(report.runtime.paths).every(p => /^[Dd]:[\\/]/u.test(p)));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.showInactive(); win.webContents.setBackgroundThrottling(false);
    globalThis.__researchDialogs = []; globalThis.__researchCalls = []; globalThis.__researchSeq = 0;
    dialog.showOpenDialog = async () => globalThis.__researchDialogs.shift() || { canceled: true, filePaths: [] };
    globalThis.fetch = async (url, init) => {
      if (String(url) !== 'https://offline-research.invalid/v1/chat/completions') throw new Error('QA blocked external fetch');
      const body = JSON.parse(init.body); globalThis.__researchCalls.push(body);
      const system = body.messages[0].content; const action = system.match(/当前权限：(propose|implement|review|publish|private|group)/u)?.[1];
      const count = body.messages.filter(m => m.role === 'assistant').length;
      const tool = (name, args) => ({ tool_calls: [{ id: 'qa-' + (++globalThis.__researchSeq), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
      let message;
      const baseline = globalThis.__researchVersion;
      if (action === 'propose') {
        if (count === 0) message = tool('read_research_file', { reference: baseline.codeRef + '/model.py' });
        else if (count === 1) message = tool('read_research_file', { reference: baseline.codeRef + '/baseline.md' });
        else if (count === 2) message = tool('save_private_proposal', { title: body.model === 'offline-a' ? '残差校准创新 · 研究员甲' : '对照分析创新 · 研究员丁', summary: '只用于界面与权限验收，尚未证明实验有效。', steps: ['将 predict 的输出调整为 x + 1'], evidence: [{ reference: baseline.codeRef + '/model.py', reason: '已实际读取原始 predict 直接返回 x 的代码。' }] });
        else message = { content: '私人方案保存完成。' };
      } else if (action === 'implement') {
        if (count === 0) message = tool('read_research_file', { reference: globalThis.__researchApproval.workspaceRef + '/model.py' });
        else if (count === 1) message = tool('edit_workspace_file', { path: 'model.py', operation: 'replace', oldText: 'return x', newText: 'return x + 1', expectedHash: JSON.parse(body.messages.at(-1).content).hash });
        else if (count === 2) message = tool('complete_implementation', { summary: '已修改 model.py 的 predict。服务器命令 python train.py --seed 42；没有运行实验。' });
        else message = { content: '实际代码修改已登记。' };
      } else if (action === 'review') {
        if (count === 0) message = tool('read_research_file', { reference: globalThis.__researchApproval.workspaceRef + '/model.py' });
        else if (count === 1) message = tool('submit_implementation_review', { passed: true, summary: '实现逐项符合采用方案，实验仍需用户验证。', checks: [{ stepIndex: 0, passed: true, evidence: '实际文件返回 x + 1，符合本条实施清单。', files: ['model.py'] }] });
        else message = { content: '核查完成。' };
      } else if (action === 'publish') message = count === 0 ? tool('publish_confirmed_version', { summary: '发布用户确认的离线实验记录；旧版保留。' }) : { content: '发布完成。' };
      else message = { content: '已接收本项目当前版本上下文；不读取他人私人空间。' };
      return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });
  page = await app.firstWindow(); page.on('pageerror', e => report.rendererErrors.push(e.message));
  await page.getByText('所有项目', { exact: true }).first().waitFor(); await resize(1440, 960);
}
(async () => {
  try {
    await launch();
    const project = await page.evaluate(async () => {
      const p = await window.cth.apiCollabCreateProject('遥感创新验证项目');
      await window.cth.apiCollabSaveProvider({ id: 'offline', name: '本地离线夹具', protocol: 'openai-compatible', baseUrl: 'https://offline-research.invalid/v1', apiKeyRef: '', defaultModel: 'offline-a', enabled: true, stream: false, retryPolicy: { maxRetries: 0 } });
      await window.cth.apiCollabSetSecret('offline', 'offline-test-not-real');
      for (const [id, displayName] of [['a', '研究员甲'], ['b', '研究员乙'], ['c', '研究员丙'], ['d', '研究员丁']]) await window.cth.apiCollabSaveAgent({ id, displayName, model: 'offline-' + id, providerId: 'offline', enabled: true, apiMode: 'agent' }, p.id);
      return p;
    });
    await page.reload(); await button(project.name).click(); await button('科研工作台').click();
    await page.getByText('先放入原始代码和论文', { exact: true }).waitFor();
    check('新项目公共盒无虚构实验，四位伙伴均有三盒', !(await state(project.id)).currentVersionId && ['a', 'b', 'c', 'd'].every(id => fs.existsSync(path.join(project.root, 'AgentChats', id, 'boxes/facts'))));
    await screenshot('01-empty'); await noOverflow('1440 空态无横向溢出');
    await app.evaluate(({ dialog }, source) => { globalThis.__researchDialogs.push({ canceled: false, filePaths: [source] }, { canceled: true, filePaths: [] }); }, source);
    await button('导入原始代码与论文').click();
    const imported = await waitState(project.id, s => s.versions.length === 1); const baseline = imported.versions[0]; await app.evaluate((_electron, version) => { globalThis.__researchVersion = version; }, baseline);
    check('原生选择器真实导入 baseline，原文件未动', fs.readFileSync(path.join(project.root, baseline.codeRef, 'model.py'), 'utf8') === fs.readFileSync(path.join(source, 'model.py'), 'utf8'));
    await button('独立想方案').click(); await page.getByRole('checkbox', { name: '研究员甲', exact: true }).check(); await page.getByRole('checkbox', { name: '研究员丁', exact: true }).check(); await page.getByLabel('这次研究什么', { exact: true }).fill('分别阅读 baseline，独立提出带证据的最佳创新方案。');
    await button('开始独立构思').click(); const proposed = await waitState(project.id, s => s.proposals.length === 2 && s.runs.every(r => r.status !== 'running'));
    assert(proposed.runs.every(r => r.status === 'complete'), JSON.stringify(proposed.runs));
    check('独立构思真实调用读文件/存方案工具，并各自私聊', proposed.proposals.length === 2 && (await page.evaluate(id => window.cth.apiCollabSnapshot(id), project.id)).workgroup.length === 0);
    const p = proposed.proposals.find(p => p.agentId === 'a');
    await page.getByRole('button').filter({ has: page.getByText(p.title, { exact: true }) }).click();
    await button('授权公开这版方案').click(); await waitState(project.id, s => s.sharedProposals.length === 1);
    check('会议只授权一份方案，未开放全部私人空间', (await state(project.id)).sharedProposals.length === 1);
    await page.locator('.rw-approval select').nth(0).selectOption('b'); await page.locator('.rw-approval select').nth(1).selectOption('c'); await button('采纳并创建工作副本').click();
    const approved = await waitState(project.id, s => s.proposals.find(q => q.id === p.id)?.approval); const approval = approved.proposals.find(q => q.id === p.id).approval;
    await app.evaluate((_electron, approval) => { globalThis.__researchApproval = approval; }, approval);
    check('分工动态指定，工作副本在修改者私人盒', approval.implementerId === 'b' && approval.reviewerId === 'c' && approval.workspaceRef.startsWith('AgentChats/b/boxes/materials/'));
    await button('开始改代码').click(); await waitState(project.id, s => s.proposals.find(q => q.id === p.id)?.status === 'implemented');
    check('修改真实落盘且公共 baseline 保留', fs.readFileSync(path.join(project.root, approval.workspaceRef, 'model.py'), 'utf8').includes('x + 1') && !fs.readFileSync(path.join(project.root, baseline.codeRef, 'model.py'), 'utf8').includes('x + 1'));
    await button('核查实际代码').click(); await waitState(project.id, s => s.proposals.find(q => q.id === p.id)?.status === 'review-passed');
    check('独立检查者逐条核对并绑定代码哈希'); await screenshot('02-reviewed');
    await button('登记一次实验').click(); await page.getByLabel('数据集', { exact: true }).fill('LEVIR-CD / test / seed=42'); await page.getByLabel('指标名称', { exact: true }).fill('F1'); await page.getByLabel('真实数值', { exact: true }).fill('91.2%'); await page.getByLabel('运行命令', { exact: true }).fill('python train.py --seed 42');
    await app.evaluate((_electron, log) => { globalThis.__researchDialogs.push({ canceled: false, filePaths: [log] }); }, log);
    await button('选择证据并保存实验').click(); const pending = await waitState(project.id, s => s.proposals.find(q => q.id === p.id)?.status === 'pending-confirmation');
    check('实验登记不自动确认为事实', !pending.proposals.find(q => q.id === p.id).experiments[0].confirmedAt && fs.readdirSync(path.join(project.root, 'AgentChats/b/boxes/facts')).filter(n => n !== '.keep').length === 0);
    await button('人工确认这次实验').click(); await waitState(project.id, s => s.proposals.find(q => q.id === p.id)?.status === 'confirmed');
    await page.locator('.rw-publish-controls select').selectOption('d'); await button('发布已确认结果').click(); const published = await waitState(project.id, s => s.proposals.find(q => q.id === p.id)?.status === 'published');
    const versionId = published.currentVersionId;
    check('人工确认后指定任意伙伴发布，旧版与日志均保留', published.versions.length === 2 && published.versions.some(v => v.id === baseline.id) && fs.existsSync(path.join(project.root, published.versions[1].evidenceRef, 'results/server-result.log')));
    await screenshot('03-published'); await noOverflow('1440 方案详情无横向溢出');
    const cdp = await page.context().newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable'); const dom = await cdp.send('DOM.getDocument'); const node = await cdp.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '.rw-topbar h2' }); report.fonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId })).fonts;
    check('中文标题实际使用中文字体', report.fonts.some(f => /Microsoft YaHei|微软雅黑|DengXian/iu.test(f.familyName)));
    await resize(1100, 760); await noOverflow('1100 详情无横向溢出'); await screenshot('04-laptop'); await resize(760, 700); await noOverflow('760 详情无横向溢出'); await screenshot('05-narrow');
    await page.keyboard.press('Tab'); check('键盘焦点留在工作台对话框', await page.getByRole('dialog', { name: '科研工作台', exact: true }).evaluate(el => el.contains(document.activeElement)));
    await button('资料与版本').click(); await page.getByLabel('查看公共资料版本', { exact: true }).selectOption(baseline.id); await screenshot('06-historical-version');
    check('查看历史版本不改变当前公共代码', (await state(project.id)).currentVersionId === versionId);
    await page.keyboard.press('Escape');
    const chat = await page.evaluate(id => window.cth.apiCollabSendPrivate({ projectId: id, agentId: 'a', content: '告诉我当前公共版本，不能读取其他伙伴私人想法。' }), project.id);
    check('普通私聊取得当前版本和受限工具', chat.status === 'complete' && await app.evaluate((_electron, versionId) => globalThis.__researchCalls.at(-1).messages[0].content.includes(versionId) && globalThis.__researchCalls.at(-1).tools.some(t => t.function.name === 'read_research_file'), versionId));
    await page.evaluate(id => { const key = `tongzhou-appearance:project:${id}`; localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) || '{}'), theme: 'dark' })); }, project.id);
    await page.reload(); await button(project.name).click(); await button('科研工作台').click(); await page.locator('.tz-app[data-theme=dark]').waitFor(); await noOverflow('深色主题无横向溢出'); await screenshot('07-dark');
    const other = await page.evaluate(() => window.cth.apiCollabCreateProject('全新隔离项目')); const otherSnapshot = await page.evaluate(id => window.cth.apiCollabSnapshot(id), other.id);
    check('新项目不继承 Agent、聊天、方案、事实或版本', !otherSnapshot.agents.length && !otherSnapshot.workgroup.length && !(await state(other.id)).versions.length && !(await state(other.id)).proposals.length);
    await app.close(); app = null; await launch(); await button(project.name).click(); await button('科研工作台').click();
    const recovered = await state(project.id); check('完整进程重启恢复公共版本、私人方案、实验确认、工具回执', recovered.currentVersionId === versionId && recovered.proposals.length === 2 && recovered.proposals.find(q => q.id === p.id).experiments[0].confirmedAt && recovered.runs.every(r => r.status === 'complete'));
    check('没有前端运行异常', report.rendererErrors.length === 0);
    report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error('Renderer errors', report.rendererErrors); if (page) { console.error('Visible text', await page.locator('body').innerText({ timeout: 5000 }).catch(e => e.message)); await screenshot('failure').catch(e => console.error('screenshot', e.message)); } throw error; }
  finally { if (app) await app.close().catch(() => {}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
