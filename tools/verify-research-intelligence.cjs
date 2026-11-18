const qa = require('./qa-paths.cjs');
'use strict';
// Real Electron/IPC. All model responses and server result files are isolated fixtures.
const { _electron } = require('playwright-core');
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto'); const assert = require('node:assert/strict');
const output = qa.output('research-intelligence');
const executablePath = qa.executable();
const root = path.join(output, 'fixture-' + Date.now()); const source = path.join(root, 'baseline-source'); fs.mkdirSync(source, { recursive: true });
for (const [name, value] of Object.entries({ 'train.py': 'def predict(x):\n    return x\n', 'paper.md': '# Baseline\n隔离验收资料，双时相输入预测变化图；这里没有真实科研结论。', 'requirements.txt': 'torch==2.5.1\n', 'splits.json': '["test-a","test-b"]\n' })) fs.writeFileSync(path.join(source, name), value);
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const report = { startedAt: new Date().toISOString(), executablePath, realProviderRequests: 0, realTrainingRuns: 0, checks: [], rendererErrors: [], viewports: [], fetchHistory: [] };
const env = { ...process.env, MULTI_AGENT_ROOT: root, TEMP: qa.temp, TMP: qa.temp, DO_NOT_TRACK: '1' }; delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const check = (name, value = true) => { assert.ok(value, name); report.checks.push(name); console.log('PASS ' + name); };
const button = name => page.getByRole('button', { name: name === '科研工作台' ? /科研工作台|公共资料、私人盒子与创新实验/u : name === '执行记录' ? /^执行记录/u : name, exact: true });
const state = id => page.evaluate(id => window.cth.apiCollabResearchSnapshot(id), id);
const bundles = id => page.evaluate(id => window.cth.apiCollabExperimentSnapshot(id), id);
async function waitFor(fn, label) { for (let i = 0; i < 240; i++) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 100)); } throw new Error(label || '等待状态超时'); }
async function waitState(id, predicate) { return waitFor(async () => { const s = await state(id); return predicate(s) ? s : false; }, '科研状态超时'); }
async function shot(name) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.showInactive()); await page.screenshot({ path: path.join(output, name + '.png'), scale: 'css', animations: 'disabled', timeout: 20000 }); }
async function resize(width, height) { await page.setViewportSize({ width, height }); await page.waitForFunction(s => innerWidth === s.width && innerHeight === s.height, { width, height }); report.viewports.push({ width, height }); }
async function noOverflow(label) { const s = await page.locator('.rw-content').evaluate(e => ({ w: e.clientWidth, sw: e.scrollWidth, p: document.documentElement.scrollWidth, v: innerWidth })); check(label, s.sw <= s.w + 1 && s.p <= s.v + 1); }
async function history() { return app.evaluate(() => globalThis.__qaCalls.map(r => ({ model: r.model, url: r.url, round: r.round, tools: r.tools }))); }
async function close() { report.fetchHistory.push(...await history()); await app.close(); app = null; }
async function launch() {
  const development = /[\\/]electron\.exe$/iu.test(executablePath);
  if (!development) report.asarSha256 = sha(fs.readFileSync(path.join(path.dirname(executablePath), 'resources/app.asar')));
  app = await _electron.launch({ executablePath, args: ['--disable-gpu', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion', ...(development ? [qa.root] : [])], cwd: root, env, timeout: 90000 });
  report.runtime = await app.evaluate(({ app }) => ({ version: app.getVersion(), paths: Object.fromEntries(['appData', 'userData', 'sessionData', 'logs', 'crashDumps', 'temp'].map(k => [k, app.getPath(k)])) }));
  if (!development) assert.equal(report.runtime.version, require('../package.json').version);
  assert(Object.values(report.runtime.paths).every(p => /^[Dd]:[\\/]/u.test(p)));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(0, 0); win.webContents.setBackgroundThrottling(false); win.showInactive();
    globalThis.__qaDialogs = []; globalThis.__qaCalls = []; globalThis.__qaSequence = 0; globalThis.__holdProposal = false;
    dialog.showOpenDialog = async () => globalThis.__qaDialogs.shift() || { canceled: true, filePaths: [] };
    globalThis.fetch = async (url, init) => {
      if (!['https://relay-a.invalid/v1/chat/completions', 'https://relay-b.invalid/v1/chat/completions'].includes(String(url))) throw new Error('QA blocked external fetch');
      const body = JSON.parse(init.body); const count = body.messages.filter(m => m.role === 'assistant').length;
      globalThis.__qaCalls.push({ model: body.model, url: String(url), round: count, tools: body.tools?.map(t => t.function.name) || [] });
      const call = (name, args) => ({ tool_calls: [{ id: 'fixture-' + (++globalThis.__qaSequence), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
      let message;
      if (body.tools.some(t => t.function.name === 'read_benchmark_file')) {
        if (!count) message = { tool_calls: ['paper.md', 'workspace/model.py'].map((p, i) => ({ id: 'eval-read-' + i, type: 'function', function: { name: 'read_benchmark_file', arguments: JSON.stringify({ path: p }) } })) };
        else { const evidence = body.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content)).map(r => ({ path: r.path, quote: r.text.slice(0, 80) })); message = call('submit_evaluation', { answer: { path: 'workspace/model.py', function: 'temporal_difference', line: 1, evidence } }); }
      } else {
        const mode = body.messages[0].content.match(/当前权限：(propose|implement|review|publish|private|group)/u)?.[1];
        if (mode === 'propose') {
          if (count === 0) message = call('read_research_file', { reference: globalThis.__qaVersion.codeRef + '/train.py' });
          else if (count === 1) message = call('read_research_file', { reference: globalThis.__qaVersion.codeRef + '/paper.md' });
          else if (globalThis.__holdProposal) return new Promise((resolve, reject) => { const stop = () => reject(new Error('fixture aborted')); if (init.signal.aborted) stop(); else init.signal.addEventListener('abort', stop, { once: true }); });
          else message = call('save_private_proposal', { title: '独立残差校准 · 演示方案', summary: '需要多seed验证的隔离测试猜想，不能当作科研事实。', steps: ['将 predict 返回值改为 x + 1'], evidence: [{ reference: globalThis.__qaVersion.codeRef + '/train.py', reason: '实际读过代码，当前直接返回输入。', quote: 'return x' }] });
        } else if (mode === 'implement') {
          if (count === 0) message = call('read_research_file', { reference: globalThis.__qaApproval.workspaceRef + '/train.py' });
          else if (count === 1) message = call('edit_workspace_file', { path: 'train.py', operation: 'replace', oldText: 'return x', newText: 'return x + 1', expectedHash: JSON.parse(body.messages.at(-1).content).hash });
          else if (count === 2) message = call('inspect_code_changes', {});
          else message = call('complete_implementation', { summary: '只修改train.py的predict；命令python train.py --seed 1。没有运行真实实验。' });
        } else if (mode === 'review') {
          if (count === 0) message = call('inspect_code_changes', {});
          else if (count === 1) message = call('read_research_file', { reference: globalThis.__qaApproval.workspaceRef + '/train.py' });
          else message = call('submit_implementation_review', { passed: true, summary: '逐条核对清单，只有train.py目标返回值改变。', checks: [{ stepIndex: 0, passed: true, evidence: '实际文件返回x+1；尚未证明实验效果。', files: ['train.py'] }] });
        } else message = { content: '隔离测试回复。' };
      }
      return new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 20 } }), { headers: { 'content-type': 'application/json' } });
    };
  });
  page = await app.firstWindow(); page.on('pageerror', e => report.rendererErrors.push(e.message));
  await page.getByText('所有项目', { exact: true }).first().waitFor(); await resize(1440, 960);
}
async function open(project) { await button(project.name).click(); await button('科研工作台').click(); }
function results(project, b, offset = 0) {
  const directory = path.join(root, 'server-fixture', b.id, 'results'); fs.mkdirSync(directory, { recursive: true });
  const runs = b.plan.seeds.map((seed, i) => { const d = path.join(directory, 'seed-' + seed); fs.mkdirSync(d); const log = 'MOCK SERVER ONLY seed=' + seed; const metrics = JSON.stringify({ F1: 89 + i + offset }); fs.writeFileSync(path.join(d, 'train.log'), log); fs.writeFileSync(path.join(d, 'metrics.json'), metrics); return { seed, exitCode: 0, metric: 89 + i + offset, log: `results/seed-${seed}/train.log`, logHash: sha(log), metrics: `results/seed-${seed}/metrics.json`, metricsHash: sha(metrics) }; });
  const file = path.join(directory, 'bundle-results.json'); fs.writeFileSync(file, JSON.stringify({ runner: 'xingshu-experiment-v1', bundleId: b.id, codeHash: b.codeHash, manifestHash: b.manifestHash, plan: b.plan, status: 'completed', runs })); return file;
}
(async () => {
  try {
    await launch();
    const project = await page.evaluate(async () => {
      const p = await window.cth.apiCollabCreateProject('科研协作 · 演示');
      for (const id of ['a', 'b']) { await window.cth.apiCollabSaveProvider({ id, name: '隔离中转' + id, protocol: 'openai-compatible', baseUrl: `https://relay-${id}.invalid/v1`, apiKeyRef: '', defaultModel: 'fixture-' + id, enabled: true, stream: false, timeoutMs: 30000, retryPolicy: { maxRetries: 0 } }); await window.cth.apiCollabSetSecret(id, 'fixture-not-real-' + id); await window.cth.apiCollabSaveAgent({ id, displayName: id === 'a' ? '研究员甲' : '检查员乙', providerId: id, model: 'fixture-' + id, enabled: true, apiMode: 'agent', reasoningEffort: 'high' }, p.id); }
      return p;
    });
    await page.reload(); await open(project); await button('能力评测').click();
    await button('开始离线自检').click();
    let evaluation = await waitFor(async () => { const s = await page.evaluate(id => window.cth.apiCollabBenchmarkSnapshot(id), project.id); return s.runs[0]?.status === 'completed' ? page.evaluate(x => window.cth.apiCollabBenchmarkRead(x.project, x.run), { project: project.id, run: s.runs[0].id }) : false; });
    check('离线自检6项正确例和6项故障例、真实中转请求为0', evaluation.attempts.filter(a => a.status === 'passed').length === 6 && evaluation.attempts.filter(a => a.status === 'failed').length === 6 && (await history()).length === 0);
    await button('刷新评测').click(); await shot('01-offline-benchmark');
    const modeWidths = await page.locator('.rt-mode input').evaluateAll(items => items.map(e => e.getBoundingClientRect().width));
    await button('开始离线自检').hover(); const actionColor = await button('开始离线自检').evaluate(e => getComputedStyle(e).color);
    check('模式选项保持正常横排，主要按钮悬停后仍为白色文字', modeWidths.every(w => w >= 12 && w <= 20) && actionColor === 'rgb(255, 255, 255)');
    await page.getByRole('radio', { name: /真实模型评测/u }).check();
    await page.locator('.rt-agent-grid input').check({ force: true }).catch(async () => { for (const item of await page.locator('.rt-agent-grid input').all()) await item.check(); });
    const cases = page.locator('.rt-case-grid input'); for (let i = 1; i < await cases.count(); i++) await cases.nth(i).uncheck();
    await button('核对调用预算').click(); check('确认预算但未批准前不发出任何中转请求', (await history()).length === 0);
    const consent = page.getByRole('region', { name: '确认真实模型评测' });
    assert.equal(await button('确认并开始真实评测').isEnabled(), false); await consent.getByRole('checkbox').check(); await button('确认并开始真实评测').click();
    evaluation = await waitFor(async () => { const s = await page.evaluate(id => window.cth.apiCollabBenchmarkSnapshot(id), project.id); const r = s.runs.find(r => r.mode === 'provider'); return r?.status === 'completed' ? page.evaluate(x => window.cth.apiCollabBenchmarkRead(x.project, x.run), { project: project.id, run: r.id }) : false; });
    check('两个独立中转与可选模型通过真实工具循环，未知费用没有记为0', evaluation.identities.length === 2 && evaluation.attempts.every(a => a.status === 'passed' && a.estimatedCost === null) && new Set((await history()).map(r => r.url)).size === 2);
    await button('刷新评测').click(); await shot('02-provider-benchmark');
    await button('资料与版本').click(); await app.evaluate((_e, source) => globalThis.__qaDialogs.push({ canceled: false, filePaths: [source] }, { canceled: true, filePaths: [] }), source); await button('导入原始代码与论文').click();
    const initial = await waitState(project.id, s => s.versions.length === 1); const version = initial.versions[0];
    await app.evaluate((_e, v) => { globalThis.__qaVersion = v; globalThis.__holdProposal = true; }, version);
    await button('独立想方案').click(); await page.getByRole('checkbox', { name: '研究员甲', exact: true }).check(); await page.getByLabel('这次研究什么', { exact: true }).fill('独立读取baseline，提出带可核对原文的独立残差方案。'); await button('开始独立构思').click();
    await waitFor(async () => (await history()).some(r => r.round === 2 && r.tools.includes('read_research_file')));
    await button('执行记录').click(); await button('暂停并保存断点').click(); const paused = await waitState(project.id, s => s.runs[0]?.status === 'interrupted'); const runId = paused.runs[0].id;
    const checkpoint = await page.evaluate(x => window.cth.apiCollabResearchContinuationInfo(x.project, x.run), { project: project.id, run: runId }); check('真实工具已读两份文件后暂停，断点可读且尚未保存方案', checkpoint.available && paused.proposals.length === 0);
    await shot('03-paused'); const beforeRestart = (await history()).filter(r => r.tools.includes('read_research_file')).length;
    await close(); await launch(); await open(project); await app.evaluate((_e, v) => { globalThis.__qaVersion = v; return true; }, version); await button('执行记录').click();
    await button('从断点继续').click(); check('重启后续跑仍需明确批准，尚无模型请求', (await history()).length === 0); await button('确认续跑本轮任务').click();
    const proposed = await waitState(project.id, s => s.proposals.length === 1 && s.runs[0].status === 'complete'); const p = proposed.proposals[0];
    check('完整进程重启后保留原上下文，不重复已读工具与已保存方案', beforeRestart === 3 && (await history()).length === 1 && (await history())[0].round === 2 && p.evidence[0].sourceHash && p.evidence[0].quote === 'return x');
    await button(/方案与实验/u).click(); await page.getByRole('button').filter({ has: page.getByText(p.title, { exact: true }) }).click(); await page.locator('.rw-approval select').nth(0).selectOption('a'); await page.locator('.rw-approval select').nth(1).selectOption('b'); await button('采纳并创建工作副本').click();
    const approved = await waitState(project.id, s => s.proposals[0].approval); const approval = approved.proposals[0].approval; await app.evaluate((_e, a) => { globalThis.__qaApproval = a; }, approval);
    await button('开始改代码').click(); await waitState(project.id, s => s.proposals[0].status === 'implemented'); await button('核查实际代码').click(); await waitState(project.id, s => s.proposals[0].status === 'review-passed');
    check('修改者和独立检查者动态指定，实际改代码且baseline完全保留', fs.readFileSync(path.join(project.root, approval.workspaceRef, 'train.py'), 'utf8').includes('x + 1') && fs.readFileSync(path.join(project.root, version.codeRef, 'train.py'), 'utf8') === fs.readFileSync(path.join(source, 'train.py'), 'utf8'));
    await button('证据追溯').click(); await page.getByRole('heading', { name: '证据与版本记忆', exact: true }).waitFor(); await page.getByLabel('以谁的权限检索', { exact: true }).selectOption('b'); await page.getByPlaceholder('例如：差分、失败、F1').fill('独立'); await button('检索记忆凭据').click(); await page.getByText('没有找到已授权的匹配记录。', { exact: true }).waitFor();
    check('记忆检索按Agent权限隔离，检查者不继承未公开私人方案');
    await page.getByLabel('以谁的权限检索', { exact: true }).selectOption('a'); await button('检索记忆凭据').click(); await page.locator('.rt-memory-hits').getByText(/独立残差校准/u).waitFor();
    const graph = await page.evaluate(id => window.cth.apiCollabResearchEvidence(id), project.id); check('方案、真实原文、实际代码和核查形成版本证据链', ['source', 'proposal', 'code', 'review'].every(kind => graph.nodes.some(n => n.kind === kind)));
    await shot('04-evidence-chain');
    await button('可复现实验').click(); const experiment = page.getByRole('region', { name: '可复现实验', exact: true });
    await experiment.getByLabel('数据集名称', { exact: true }).fill('CD-fixture'); await experiment.getByLabel('划分标识', { exact: true }).fill('official-test'); await experiment.getByLabel('划分清单文件（代码内，可选）', { exact: true }).fill('splits.json'); await experiment.getByLabel('服务器预装镜像的完整 digest', { exact: true }).fill('fixture/image@sha256:' + '1'.repeat(64));
    await button('生成可复现实验包').click(); let bs = await waitFor(async () => { const s = await bundles(project.id); return s.bundles.length === 1 ? s : false; }); const baselineBundle = bs.bundles[0];
    await experiment.getByLabel('要运行的代码', { exact: true }).selectOption(p.id); await button('生成可复现实验包').click(); bs = await waitFor(async () => { const s = await bundles(project.id); return s.bundles.length === 2 ? s : false; }); const candidate = bs.bundles.find(x => x.proposalId === p.id);
    check('baseline与候选代码均生成真实tar.gz、清单、依赖和多seed配置', [baselineBundle, candidate].every(b => b.archiveHash === sha(fs.readFileSync(path.join(project.root, b.archiveReference))) && fs.existsSync(path.join(project.root, b.reference, 'run_experiment.py'))));
    check('未配置服务器时不能误提交训练', await button('准备提交服务器').isDisabled());
    await shot('05-experiment-bundle');
    for (const [b, offset] of [[baselineBundle, 0], [candidate, 0.5]]) {
      await experiment.getByLabel('查看实验包', { exact: true }).selectOption(b.id); const file = results(project, b, offset); await app.evaluate((_e, file) => globalThis.__qaDialogs.push({ canceled: false, filePaths: [file] }), file); await button('导入服务器结果').click(); await waitFor(async () => (await bundles(project.id)).bundles.find(x => x.id === b.id)?.results);
      if (offset) check('日志与结果已核验，但人工确认前私人事实盒仍为空', fs.readdirSync(path.join(project.root, 'AgentChats/a/boxes/facts')).filter(n => n.endsWith('.json')).length === 0);
      await button('人工确认包内实验结果').click(); await waitFor(async () => (await bundles(project.id)).bundles.find(x => x.id === b.id)?.confirmedAt);
    }
    await experiment.getByLabel('对照实验包', { exact: true }).selectOption(baselineBundle.id); await experiment.getByLabel('候选实验包', { exact: true }).selectOption(candidate.id); await button('核对可比条件并计算差值').click(); await page.getByText(/均值差=0.5000/u).waitFor();
    check('三个seed的日志指标与人工确认闭环，对照均值差0.5且事实落盘', fs.readdirSync(path.join(project.root, 'AgentChats/a/boxes/facts')).filter(n => n.endsWith('.json')).length === 1);
    await shot('06-confirmed-comparison');
    await button('证据追溯').click(); await button('刷新证据链').click(); await page.locator('.rt-evidence-experiment').waitFor(); await page.locator('.rt-evidence-conclusion').waitFor();
    check('人工确认后证据链连接实验与限定条件下的观察，未伪称独立复跑');
    for (const [w, h] of [[1100, 760], [760, 700]]) { await resize(w, h); await noOverflow(`${w}证据页不溢出`); await shot('evidence-' + w); await button('可复现实验').click(); await noOverflow(`${w}实验页不溢出`); await shot('experiments-' + w); await button('能力评测').click(); await noOverflow(`${w}评测页不溢出`); await shot('benchmark-' + w); await button('证据追溯').click(); }
    await resize(1440, 960);
    const cdp = await page.context().newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable'); const doc = await cdp.send('DOM.getDocument'); const node = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.rt-panel:not([hidden]) h3' }); report.actualFonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId })).fonts; check('实际渲染使用中文字体', report.actualFonts.some(f => /Microsoft YaHei|微软雅黑|DengXian|SimSun/iu.test(f.familyName)));
    await page.locator('.rw-tabs button').last().focus(); await page.keyboard.press('Tab'); check('科研面板按钮支持键盘焦点', await page.evaluate(() => document.activeElement instanceof HTMLButtonElement));
    await page.evaluate(id => { const k = `tongzhou-appearance:project:${id}`; const s = JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify({ ...s, theme: 'dark' })); }, project.id); await page.reload(); await open(project); await button('可复现实验').click(); await page.locator('.tz-app[data-theme=dark]').waitFor(); await noOverflow('深色实验页不溢出'); await shot('07-dark-experiments');
    const other = await page.evaluate(() => window.cth.apiCollabCreateProject('另一份全新项目')); const empty = await page.evaluate(async id => ({ snapshot: await window.cth.apiCollabSnapshot(id), evaluation: await window.cth.apiCollabBenchmarkSnapshot(id), experiments: await window.cth.apiCollabExperimentSnapshot(id), research: await window.cth.apiCollabResearchSnapshot(id) }), other.id);
    check('新项目Agent、评测、实验、服务器、记忆和版本全部空白', !empty.snapshot.agents.length && !empty.evaluation.runs.length && !empty.experiments.bundles.length && !empty.experiments.server && !empty.research.versions.length && !empty.research.proposals.length);
    await close(); await launch(); await open(project); const restored = await state(project.id); const restoredBundles = await bundles(project.id); const restoredEvals = await page.evaluate(id => window.cth.apiCollabBenchmarkSnapshot(id), project.id);
    check('完整重启恢复评测、方案、已确认实验、工具记录和当前公共版', restoredEvals.runs.length === 2 && restoredBundles.bundles.length === 2 && restoredBundles.bundles.every(b => b.confirmedAt) && restored.proposals[0].experiments[0].confirmedAt && restored.runs.every(r => r.status === 'complete') && restored.currentVersionId === version.id);
    check('前端运行异常为0', !report.rendererErrors.length);
    if (process.env.XINGSHU_CAPTURE_SCREENSHOTS === '1') await require('./capture-screenshots.cjs').capture({ app, page, project }); report.finishedAt = new Date().toISOString(); await close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, checks: report.checks.length, rendererErrors: report.rendererErrors, asarSha256: report.asarSha256 }, null, 2));
  } catch (error) { if (page) { console.error(await page.locator('body').innerText({ timeout: 3000 }).catch(() => 'No DOM')); await shot('failure').catch(() => {}); } throw error; }
  finally { if (app) await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
