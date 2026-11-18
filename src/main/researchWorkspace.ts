import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ResearchApproval, ResearchChange, ResearchExperiment, ResearchExperimentInput, ResearchFile, ResearchPreview, ResearchProposal, ResearchProposalInput, ResearchReview, ResearchReviewCheck, ResearchRun, ResearchSharedProposal, ResearchState, ResearchVersion } from '../shared/research';

const emptyState = (): ResearchState => ({ schemaVersion: 1, versions: [], proposals: [], sharedProposals: [], runs: [] });
const now = (): string => new Date().toISOString();
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const normalized = (path: string): string => path.replace(/\\/gu, '/');
const inside = (root: string, path: string): boolean => { const r = relative(root, path); return !r || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); };
const id = (prefix: string): string => `${prefix}-${randomUUID()}`;
function text(value: unknown, label: string, max = 30_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}不能为空，且不能超过 ${max} 字`);
  return value.trim();
}
function segments(value: string): string[] {
  if (typeof value !== 'string' || value.length > 1500 || isAbsolute(value)) throw new Error('只允许盒子里的相对路径');
  const parts = normalized(value).split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\u0000-\u001f]/u.test(part) || /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) throw new Error('文件路径无效或包含越界路径');
  return parts;
}
/** Every component is checked, including Windows junctions; model paths never become host paths directly. */
function safe(root: string, reference: string, makeParents = false): string {
  const base = resolve(root);
  if (!existsSync(base) || lstatSync(base).isSymbolicLink()) throw new Error('资料根目录不存在或是链接');
  const parts = segments(reference);
  let current = base;
  for (let i = 0; i < parts.length; i += 1) {
    current = join(current, parts[i]);
    if (existsSync(current)) {
      if (lstatSync(current).isSymbolicLink() || !inside(realpathSync(base), realpathSync(current))) throw new Error('禁止通过链接访问盒子外的文件');
      if (i < parts.length - 1 && !statSync(current).isDirectory()) throw new Error('路径中的目录不是文件夹');
    } else if (makeParents && i < parts.length - 1) mkdirSync(current);
  }
  return current;
}
function atomic(file: string, data: unknown): void {
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx' });
  renameSync(temp, file);
}
function fileManifest(root: string): Record<string, string> {
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  let count = 0;
  if (!existsSync(root)) return files;
  if (lstatSync(root).isSymbolicLink()) throw new Error('资料目录不允许是链接');
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (lstatSync(path).isSymbolicLink()) throw new Error('资料中存在链接，已停止操作');
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        if (++count > 100_000) throw new Error('资料超过十万个文件，请移除依赖或缓存目录后重试');
        files[normalized(relative(root, path))] = hash(readFileSync(path));
      } else throw new Error('资料包含不支持的特殊文件');
    }
  };
  walk(root);
  const ordered: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, value] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) ordered[name] = value;
  return ordered;
}
const digest = (manifest: Record<string, string>): string => hash(JSON.stringify(manifest));
function copyTree(source: string, target: string): void {
  let totalBytes = 0; let count = 0;
  const copy = (from: string, to: string): void => {
    if (lstatSync(from).isSymbolicLink()) throw new Error('导入或复制的资料不能包含符号链接、快捷链接或目录联接');
    if (statSync(from).isDirectory()) {
      mkdirSync(to, { recursive: true });
      for (const entry of readdirSync(from, { withFileTypes: true })) { segments(entry.name); copy(join(from, entry.name), join(to, entry.name)); }
    } else if (statSync(from).isFile()) {
      totalBytes += statSync(from).size; count += 1;
      if (totalBytes > 2 * 1024 ** 3 || count > 100_000) throw new Error('本次复制超过 2 GB 或十万个文件；请排除数据集、依赖与缓存后再导入');
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to, constants.COPYFILE_EXCL);
    } else throw new Error('不支持复制特殊文件');
  };
  copy(source, target);
}
const proposalBody = (p: ResearchProposalInput): string => `# ${p.title}\n\n${p.summary}\n\n## 实施清单\n${p.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n## 证据与理由\n${p.evidence.map(e => `- ${e.reference}\n  ${e.reason}`).join('\n')}\n`;

export type ResearchAccess = { agentId: string; mode: 'private' | 'group' | 'propose' | 'implement' | 'review' | 'publish'; proposalId?: string };

export class ResearchWorkspaceStore {
  private readonly stateRef = 'runs/research/state.json';
  constructor(readonly root: string, private readonly agentIds: () => string[]) {
    // A process restart never silently repeats an API/tool action. Existing copies remain available for explicit continuation.
    const state = this.snapshot(); let changed = false;
    for (const run of state.runs) if (run.status === 'running') { run.status = 'interrupted'; run.finishedAt = now(); run.error = '程序重启，任务已中断。已完成的文件修改保留；请手动继续。'; changed = true; }
    if (changed) this.save(state);
  }
  snapshot(): ResearchState {
    const file = safe(this.root, this.stateRef);
    if (!existsSync(file)) return emptyState();
    const state = JSON.parse(readFileSync(file, 'utf8')) as ResearchState;
    if (state.schemaVersion !== 1 || !Array.isArray(state.versions) || !Array.isArray(state.proposals) || !Array.isArray(state.runs) || !Array.isArray(state.sharedProposals)) throw new Error('科研工作区状态损坏；请恢复备份，未重置资料');
    return state;
  }
  private save(state: ResearchState): void { atomic(safe(this.root, this.stateRef, true), state); }
  private audit(action: string, value: unknown): void { appendFileSync(safe(this.root, 'runs/research/audit.jsonl', true), `${JSON.stringify({ at: now(), action, value })}\n`, 'utf8'); }
  private agent(agentId: string): void { if (typeof agentId !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(agentId) || !this.agentIds().includes(agentId)) throw new Error('请选择本项目中存在的 Agent'); }
  initializeAgent(agentId: string): void {
    this.agent(agentId);
    for (const box of ['materials', 'hypotheses', 'facts']) {
      const dir = safe(this.root, `AgentChats/${agentId}/boxes/${box}/.keep`, true);
      if (!existsSync(dir)) writeFileSync(dir, '', { flag: 'wx' });
    }
  }
  private proposal(state: ResearchState, proposalId: string): ResearchProposal { const p = state.proposals.find(p => p.id === proposalId); if (!p) throw new Error('创新方案不存在'); return p; }
  private idle(state: ResearchState, proposalId?: string, agentId?: string): void {
    if (state.runs.some(r => r.status === 'running' && ((proposalId && r.proposalId === proposalId) || (agentId && r.agentId === agentId)))) throw new Error('相关 Agent 或方案正在执行，请等待当前操作结束');
  }
  private version(state: ResearchState, versionId?: string): ResearchVersion { const v = state.versions.find(v => v.id === (versionId ?? state.currentVersionId)); if (!v) throw new Error('请先导入 baseline 代码和论文'); return v; }
  private versionRoot(version: ResearchVersion): string { return safe(this.root, dirname(version.codeRef)); }
  assertVersion(version: ResearchVersion): void {
    if (digest(fileManifest(this.versionRoot(version))) !== version.digest) throw new Error('公共版本的文件已被外部修改。已停止复制或发布，请先恢复该版本；Agent 没有公共盒写权限');
  }
  importBaseline(source: string, documents: string[] = []): ResearchVersion {
    const state = this.snapshot(); this.idle(state);
    if (state.versions.length) throw new Error('baseline 已导入并冻结。新实验请从当前公共版本创建私人工作副本；更换 baseline 请新建项目');
    if (!isAbsolute(source) || !existsSync(source) || !statSync(source).isDirectory() || inside(realpathSync(source), realpathSync(this.root)) || inside(realpathSync(source), join(realpathSync(this.root), 'WorkGroup', 'research'))) throw new Error('请选择独立的 baseline 代码文件夹，不能选项目根目录、公共盒父目录或它们的上级目录');
    const versionId = id('baseline'); const baseRef = `WorkGroup/research/versions/${versionId}`;
    if (inside(realpathSync(source), resolve(realpathSync(this.root), baseRef))) throw new Error('不能把资料复制到它自己的下级目录中，请换一个独立的 baseline 文件夹');
    const codeRef = `${baseRef}/code`; const documentsRef = `${baseRef}/documents`;
    const code = safe(this.root, `${codeRef}/.stage`, true); // Parent creation is scoped to the new, unpublished version.
    copyTree(source, dirname(code));
    safe(this.root, `${documentsRef}/.stage`, true);
    for (const file of documents) {
      if (!isAbsolute(file) || !existsSync(file) || !statSync(file).isFile()) throw new Error('论文文件不存在');
      copyTree(file, safe(this.root, `${documentsRef}/${basename(file)}`));
    }
    const manifest = fileManifest(safe(this.root, baseRef));
    if (!Object.keys(manifest).some(path => path.startsWith('code/'))) throw new Error('baseline 文件夹为空，未导入');
    const version: ResearchVersion = { id: versionId, name: '原始 baseline', kind: 'baseline', createdAt: now(), codeRef, documentsRef, manifest, digest: digest(manifest), summary: '用户导入的原始代码与论文；Agent 只读，永不原地覆盖。' };
    state.versions.push(version); state.currentVersionId = version.id; this.save(state); this.audit('import-baseline', { versionId, files: Object.keys(manifest).length }); return version;
  }
  saveProposal(agentId: string, input: ResearchProposalInput): ResearchProposal {
    this.agent(agentId); this.initializeAgent(agentId);
    const clean: ResearchProposalInput = {
      title: text(input.title, '方案名', 150), summary: text(input.summary, '方案说明'),
      steps: Array.isArray(input.steps) ? input.steps.map(step => text(step, '实施步骤', 4000)) : [],
      evidence: Array.isArray(input.evidence) ? input.evidence.map(item => {
        const reference = this.allowed({ agentId, mode: 'propose' }, text(item.reference, '证据来源', 2000));
        const file = safe(this.root, reference);
        if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > 30_000_000) throw new Error('证据文件不存在或超过30MB，不能保存为已读来源');
        const sourceHash = hash(readFileSync(file));
        if (item.sourceHash && item.sourceHash !== sourceHash) throw new Error('证据文件在读取后已变化，请重新读取再保存方案');
        return { reference, reason: text(item.reason, '证据理由', 4000), sourceHash,
          ...(item.quote !== undefined ? { quote: text(item.quote, '证据原文', 3000), offset: Number.isSafeInteger(item.offset) && item.offset! >= 0 ? item.offset : 0 } : {}) };
      }) : []
    };
    if (!clean.steps.length || clean.steps.length > 30 || !clean.evidence.length || clean.evidence.length > 30) throw new Error('方案必须包含 1—30 条实施步骤，以及 1—30 条可追溯证据');
    const state = this.snapshot(); this.version(state);
    const p: ResearchProposal = { ...clean, sourceVersionId: state.currentVersionId, id: id('proposal'), agentId, revision: 1, status: 'draft', createdAt: now(), updatedAt: now(), reviews: [], experiments: [] };
    writeFileSync(safe(this.root, `AgentChats/${agentId}/boxes/hypotheses/${p.id}.md`, true), proposalBody(p), { flag: 'wx' });
    state.proposals.push(p); this.save(state); this.audit('save-private-proposal', { proposalId: p.id, agentId }); return p;
  }
  shareProposal(proposalId: string): ResearchSharedProposal {
    const state = this.snapshot(); this.idle(state, proposalId); const p = this.proposal(state, proposalId);
    const existing = state.sharedProposals.find(s => s.proposalId === p.id && s.revision === p.revision); if (existing) return existing;
    const share: ResearchSharedProposal = { title: p.title, summary: p.summary, steps: [...p.steps], evidence: p.evidence.map(e => ({ ...e })), id: id('share'), proposalId: p.id, agentId: p.agentId, revision: p.revision, sharedAt: now() };
    // A meeting shares this proposal's cited material, never a folder-wide private grant.
    share.evidence = share.evidence.map((e, index) => {
      const owned = e.reference.startsWith(`AgentChats/${p.agentId}/boxes/`) || e.reference.startsWith(`AgentChats/${p.agentId}/data/`);
      if (e.reference.startsWith('AgentChats/') && !owned) throw new Error('方案不能替其他 Agent 授权私人资料');
      if (!owned) return e;
      const source = safe(this.root, e.reference);
      if (!existsSync(source) || !statSync(source).isFile()) throw new Error('被授权的来源文件已丢失，请恢复后再共享方案');
      const reference = `WorkGroup/research/shared-proposals/${share.id}/evidence/${index}-${basename(source)}`;
      copyTree(source, safe(this.root, reference, true)); return { ...e, reference };
    });
    writeFileSync(safe(this.root, `WorkGroup/research/shared-proposals/${share.id}.md`, true), proposalBody(share), { flag: 'wx' });
    state.sharedProposals.push(share); this.save(state); this.audit('human-share-proposal', { proposalId, shareId: share.id }); return share;
  }
  approveProposal(proposalId: string, implementerId: string, reviewerId: string): ResearchApproval {
    this.agent(implementerId); this.agent(reviewerId);
    if (implementerId === reviewerId) throw new Error('修改代码与核查代码必须选择不同的 Agent');
    const state = this.snapshot(); this.idle(state, proposalId, implementerId); const p = this.proposal(state, proposalId);
    if (p.approval) throw new Error('此方案已采纳；继续修改会沿用原工作副本，不会重置已改代码。要换分工请建立新方案');
    const v = this.version(state);
    if (p.sourceVersionId && p.sourceVersionId !== v.id) throw new Error('此方案基于旧公共版本。请以当前版本重新分析后提出新方案，不能套用到未经检查的新 baseline');
    this.assertVersion(v); this.initializeAgent(implementerId);
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const label = p.title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '-').replace(/[. ]+$/gu, '').slice(0, 40) || '创新';
    const workspaceRef = `AgentChats/${implementerId}/boxes/materials/${date}-${label}-${p.id.slice(-8)}-${randomUUID().slice(0, 8)}/code`;
    const staged = safe(this.root, `${workspaceRef}-copy/.stage`, true);
    copyTree(safe(this.root, v.codeRef), dirname(staged));
    if (digest(fileManifest(dirname(staged))) !== digest(fileManifest(safe(this.root, v.codeRef)))) throw new Error('工作副本复制校验失败，未采纳方案');
    renameSync(dirname(staged), safe(this.root, workspaceRef));
    const approval: ResearchApproval = { revision: p.revision, planHash: hash(proposalBody(p)), baselineVersionId: v.id, implementerId, reviewerId, approvedAt: now(), workspaceRef };
    p.approval = approval; p.status = 'approved'; p.updatedAt = now(); this.save(state); this.audit('human-approve-proposal', { proposalId, ...approval }); return approval;
  }
  changes(proposalId: string): ResearchChange[] {
    const state = this.snapshot(); const p = this.proposal(state, proposalId); if (!p.approval) throw new Error('请先采纳方案并指定分工');
    const version = this.version(state, p.approval.baselineVersionId); this.assertVersion(version);
    const before = fileManifest(safe(this.root, version.codeRef)); const after = fileManifest(safe(this.root, p.approval.workspaceRef));
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(path => before[path] === after[path] ? [] : [{ path, type: !before[path] ? 'added' as const : !after[path] ? 'deleted' as const : 'modified' as const, before: before[path], after: after[path] }]);
  }
  codeHash(proposalId: string): string { const p = this.proposal(this.snapshot(), proposalId); if (!p.approval) throw new Error('尚未创建工作副本'); return digest(fileManifest(safe(this.root, p.approval.workspaceRef))); }
  finishImplementation(proposalId: string, summary: string): void {
    const state = this.snapshot(); const p = this.proposal(state, proposalId);
    if (!this.changes(proposalId).length) throw new Error('未检测到实际代码变动；文字回复不能算完成修改');
    p.implementationHash = this.codeHash(proposalId); p.implementationSummary = text(summary, '修改说明'); p.status = 'implemented'; p.updatedAt = now(); this.save(state);
  }
  saveReview(proposalId: string, reviewerId: string, input: { passed: boolean; summary: string; checks: ResearchReviewCheck[] }): ResearchReview {
    this.agent(reviewerId);
    const state = this.snapshot(); const p = this.proposal(state, proposalId); const approval = p.approval;
    if (!approval || approval.reviewerId !== reviewerId || approval.implementerId === reviewerId) throw new Error('当前 Agent 没有此方案的核查授权');
    const codeHash = this.codeHash(proposalId);
    if (!p.implementationHash || p.implementationHash !== codeHash) throw new Error('代码尚未完成或已变更，请先重新完成修改再检查');
    if (!Array.isArray(input.checks) || input.checks.length !== p.steps.length || new Set(input.checks.map(c => c.stepIndex)).size !== p.steps.length || input.checks.some(c => !Number.isInteger(c.stepIndex) || c.stepIndex < 0 || c.stepIndex >= p.steps.length || typeof c.passed !== 'boolean' || !Array.isArray(c.files))) throw new Error('检查报告必须逐条覆盖已采纳的实施清单');
    const changes = this.changes(proposalId);
    const checks = input.checks.map(c => ({ ...c, evidence: text(c.evidence, '核查依据', 5000), files: c.files.map(f => segments(f).join('/')) }));
    if (input.passed && (checks.some(c => !c.passed) || changes.some(c => !checks.some(check => check.files.includes(c.path))))) throw new Error('通过检查必须覆盖每个实施步骤和所有实际变更文件；额外改动也必须解释');
    const review: ResearchReview = { id: id('review'), reviewerId, codeHash, planHash: approval.planHash, passed: Boolean(input.passed), summary: text(input.summary, '核查结论'), checks, createdAt: now() };
    p.reviews.push(review); p.status = review.passed ? 'review-passed' : 'review-failed'; p.updatedAt = now();
    writeFileSync(safe(this.root, `AgentChats/${approval.implementerId}/boxes/materials/reviews/${review.id}.json`, true), JSON.stringify(review, null, 2), { flag: 'wx' });
    this.save(state); this.audit('review-result', { proposalId, reviewerId, passed: review.passed, codeHash }); return review;
  }
  prepareAgentBaseline(agentId: string): string {
    this.initializeAgent(agentId); const v = this.version(this.snapshot()); this.assertVersion(v);
    const ref = `AgentChats/${agentId}/boxes/materials/baselines/${v.id}`;
    const target = safe(this.root, ref);
    if (existsSync(target)) {
      if (digest(fileManifest(target)) !== v.digest) throw new Error('个人 baseline 快照不完整或被手动修改；请保留备份后移走此快照，再重试');
      return ref;
    }
    const staging = safe(this.root, `${ref}-copy-${randomUUID()}/.stage`, true);
    copyTree(this.versionRoot(v), dirname(staging));
    renameSync(dirname(staging), safe(this.root, ref)); return ref;
  }
  recordExperiment(proposalId: string, input: ResearchExperimentInput, sources: string[]): ResearchExperiment {
    const state = this.snapshot(); this.idle(state, proposalId); const p = this.proposal(state, proposalId); const approval = p.approval;
    if (!approval) throw new Error('请先完成方案修改与检查');
    const codeHash = this.codeHash(proposalId); const review = p.reviews.at(-1);
    if (!review?.passed || review.codeHash !== codeHash || p.implementationHash !== codeHash) throw new Error('只有通过检查且没有再变化的代码，才能登记服务器实验');
    if (!['success', 'failure'].includes(input.outcome)) throw new Error('请选择有效或失败');
    const clean: ResearchExperimentInput = { outcome: input.outcome, metricName: input.metricName?.trim() ?? '', metricValue: input.metricValue?.trim() ?? '', dataset: text(input.dataset, '数据集与划分', 2000), command: text(input.command, '服务器执行命令', 10_000), note: input.note?.trim() ?? '' };
    if (clean.outcome === 'success' && (!clean.metricName || !clean.metricValue || !Number.isFinite(Number(clean.metricValue.replace(/%$/u, ''))))) throw new Error('有效实验需要填写指标名称与数值；请按日志中的实际数值填写');
    if (clean.outcome === 'failure' && !clean.note) throw new Error('失败实验也要填写失败原因或观察');
    if (!Array.isArray(sources) || !sources.length || sources.length > 50) throw new Error('请至少选择一份服务器日志或结果文件，最多 50 份');
    const experimentId = id('experiment');
    const evidenceRef = `AgentChats/${approval.implementerId}/boxes/materials/experiments/${experimentId}`;
    for (const source of sources) {
      if (!isAbsolute(source) || !existsSync(source) || !statSync(source).isFile()) throw new Error('实验凭据必须是已存在的文件');
      copyTree(source, safe(this.root, `${evidenceRef}/results/${basename(source)}`, true));
    }
    copyTree(safe(this.root, approval.workspaceRef), dirname(safe(this.root, `${evidenceRef}/code/.stage`, true)));
    if (digest(fileManifest(safe(this.root, `${evidenceRef}/code`))) !== codeHash) throw new Error('登记期间代码发生变化，未登记结果，请重试');
    const experiment: ResearchExperiment = { ...clean, id: experimentId, codeHash, evidenceRef, evidenceHash: digest(fileManifest(safe(this.root, evidenceRef))), createdAt: now() };
    p.experiments.push(experiment); p.status = 'pending-confirmation'; p.updatedAt = now(); this.save(state); this.audit('record-experiment-pending', { proposalId, experimentId, codeHash }); return experiment;
  }
  confirmExperiment(proposalId: string, experimentId: string): void {
    const state = this.snapshot(); this.idle(state, proposalId); const p = this.proposal(state, proposalId);
    const experiment = p.experiments.find(e => e.id === experimentId);
    if (!experiment || !p.approval) throw new Error('实验记录不存在');
    if (experiment.confirmedAt) return;
    if (experiment.codeHash !== this.codeHash(proposalId) || digest(fileManifest(safe(this.root, experiment.evidenceRef))) !== experiment.evidenceHash || !p.reviews.at(-1)?.passed || p.reviews.at(-1)?.codeHash !== experiment.codeHash) throw new Error('代码、日志、结果或核查状态发生变化，不能将旧结果确认为当前事实');
    experiment.confirmedAt = now(); p.status = 'confirmed'; p.updatedAt = now();
    const fact = { proposalId, title: p.title, experiment, scope: '该代码哈希、数据集与执行条件下的用户确认观察，不代表普遍有效' };
    atomic(safe(this.root, `AgentChats/${p.approval.implementerId}/boxes/facts/${experiment.id}.json`, true), fact);
    this.save(state); this.audit('human-confirm-experiment', { proposalId, experimentId, codeHash: experiment.codeHash });
  }
  publish(proposalId: string, publisherId: string, summary: string): ResearchVersion {
    this.agent(publisherId); const state = this.snapshot(); const p = this.proposal(state, proposalId); const approval = p.approval;
    if (!approval) throw new Error('此方案尚未采纳');
    if (p.publishedVersionId) return this.version(state, p.publishedVersionId);
    const exp = p.experiments.at(-1); const review = p.reviews.at(-1); const current = this.version(state);
    if (!exp?.confirmedAt || !review?.passed || review.codeHash !== exp.codeHash || this.codeHash(proposalId) !== exp.codeHash || digest(fileManifest(safe(this.root, exp.evidenceRef))) !== exp.evidenceHash) throw new Error('发布需要你确认过的实验、对应的检查报告，以及完整未变动的代码和凭据');
    this.assertVersion(current);
    // A stale branch must not overwrite a newer project's public code.
    if (exp.outcome === 'success' && approval.baselineVersionId !== current.id) throw new Error('公共版本已经更新。此方案基于旧版，请在新版本上建立新方案并重新检查、实验，不能覆盖其他人的成果');
    const versionId = id(exp.outcome === 'failure' ? 'negative' : 'release');
    const baseRef = `WorkGroup/research/versions/${versionId}`;
    const codeRef = `${baseRef}/code`; const documentsRef = `${baseRef}/documents`; const evidenceRef = `${baseRef}/evidence`;
    copyTree(safe(this.root, `${exp.evidenceRef}/code`), dirname(safe(this.root, `${codeRef}/.stage`, true)));
    const baseline = this.version(state, approval.baselineVersionId); this.assertVersion(baseline);
    copyTree(safe(this.root, baseline.documentsRef), dirname(safe(this.root, `${documentsRef}/.stage`, true)));
    copyTree(safe(this.root, `${exp.evidenceRef}/results`), dirname(safe(this.root, `${evidenceRef}/results/.stage`, true)));
    atomic(safe(this.root, `${evidenceRef}/confirmed-experiment.json`, true), exp);
    atomic(safe(this.root, `${evidenceRef}/review.json`, true), review);
    const publishedProposal: ResearchProposalInput = { title: p.title, summary: p.summary, steps: [...p.steps], evidence: p.evidence.map((e, index) => {
      const owned = e.reference.startsWith(`AgentChats/${p.agentId}/boxes/`) || e.reference.startsWith(`AgentChats/${p.agentId}/data/`);
      if (e.reference.startsWith('AgentChats/') && !owned) throw new Error('不能发布其他 Agent 的私人引用');
      if (!owned) return { ...e };
      const source = safe(this.root, e.reference); const reference = `${evidenceRef}/sources/${index}-${basename(source)}`;
      if (!existsSync(source) || !statSync(source).isFile()) throw new Error('方案来源附件已丢失，未发布');
      copyTree(source, safe(this.root, reference, true)); return { ...e, reference };
    }) };
    writeFileSync(safe(this.root, `${evidenceRef}/approved-proposal.md`, true), proposalBody(publishedProposal), { flag: 'wx' });
    const manifest = fileManifest(safe(this.root, baseRef));
    const version: ResearchVersion = { id: versionId, name: `${exp.outcome === 'failure' ? '失败经验' : '项目版本'} · ${p.title}`, kind: exp.outcome === 'failure' ? 'negative-result' : 'release', createdAt: now(), parentId: current.id, proposalId, publishedBy: publisherId, codeRef, documentsRef, evidenceRef, manifest, digest: digest(manifest), summary: text(summary, '发布说明') };
    state.versions.push(version); if (version.kind === 'release') state.currentVersionId = versionId;
    p.publishedVersionId = versionId; p.status = 'published'; p.updatedAt = now();
    // Files are completed and checked before the single atomic current-version pointer is made visible.
    this.assertVersion(version); this.audit('prepare-human-authorized-publication', { proposalId, publisherId, versionId }); this.save(state); return version;
  }
  beginRun(action: ResearchRun['action'], agentId: string, instruction: string, proposalId?: string): ResearchRun {
    this.agent(agentId); const state = this.snapshot(); this.idle(state, proposalId, agentId);
    if (action === 'propose') this.version(state);
    else {
      const p = this.proposal(state, proposalId ?? ''); const a = p.approval;
      if (!a || p.publishedVersionId) throw new Error('方案尚未采纳或已经发布');
      if (action === 'implement' && agentId !== a.implementerId) throw new Error('只允许你指定的负责人修改这份工作副本');
      if (action === 'review' && (agentId !== a.reviewerId || !p.implementationHash || p.implementationHash !== this.codeHash(p.id))) throw new Error('核查需要指定检查者，以及已完成的对应代码版本');
      if (action === 'publish' && !p.experiments.at(-1)?.confirmedAt) throw new Error('你尚未确认本次实验');
    }
    const run: ResearchRun = { id: id('run'), action, agentId, proposalId, instruction, status: 'running', startedAt: now(), receipts: [] };
    state.runs.push(run); this.save(state); this.audit('begin-run', { runId: run.id, action, agentId, proposalId }); return run;
  }
  receipt(runId: string, tool: string, ok: boolean, summary: string): void {
    const state = this.snapshot(); const run = state.runs.find(r => r.id === runId); if (!run) throw new Error('运行记录不存在');
    run.receipts.push({ tool, ok, summary: summary.slice(0, 2000), at: now() }); this.save(state);
  }
  finishRun(runId: string, summary?: string, error?: string): ResearchRun {
    const state = this.snapshot(); const run = state.runs.find(r => r.id === runId); if (!run) throw new Error('运行记录不存在');
    run.status = error ? 'failed' : 'complete'; run.summary = summary; run.error = error; run.finishedAt = now(); this.save(state); return run;
  }
  resumeRun(runId: string): ResearchRun {
    const state = this.snapshot(); const run = state.runs.find(r => r.id === runId);
    if (!run || !['failed', 'interrupted'].includes(run.status)) throw new Error('只可续跑失败或中断的任务');
    this.agent(run.agentId); this.idle(state, run.proposalId, run.agentId);
    run.status = 'running'; run.error = undefined; run.finishedAt = undefined;
    run.receipts.push({ tool: 'human_resume', ok: true, summary: '用户确认续跑；恢复上下文，不自动重放已完成工具。', at: now() }); this.save(state); return run;
  }
  pauseRun(runId: string, reason: string): ResearchRun {
    const state = this.snapshot(); const run = state.runs.find(r => r.id === runId); if (!run) throw new Error('运行不存在');
    run.status = 'interrupted'; run.error = reason; run.finishedAt = now(); this.save(state); return run;
  }
  archiveSource(agentId: string, runId: string, data: unknown): string {
    this.agent(agentId); const ref = `AgentChats/${agentId}/boxes/materials/sources/${runId}-${randomUUID()}.json`;
    atomic(safe(this.root, ref, true), { retrievedAt: now(), data }); return ref;
  }
  files(box: 'public' | 'materials' | 'hypotheses' | 'facts', agentId?: string, versionId?: string): ResearchFile[] {
    const state = this.snapshot(); let rootRef: string;
    if (box === 'public') {
      if (!state.currentVersionId) return [];
      const v = this.version(state, versionId); rootRef = normalized(dirname(v.codeRef));
    } else {
      this.agent(agentId ?? ''); if (!['materials', 'hypotheses', 'facts'].includes(box)) throw new Error('资料盒不存在');
      rootRef = `AgentChats/${agentId}/boxes/${box}`;
    }
    const root = safe(this.root, rootRef); if (!existsSync(root)) return [];
    const files = Object.entries(fileManifest(root)).filter(([path]) => !path.endsWith('.keep')).map(([path, hash]) => ({ path: `${rootRef}/${path}`, size: statSync(safe(root, path)).size, hash }));
    if (box === 'public' && !versionId) for (const share of state.sharedProposals) {
      const ref = `WorkGroup/research/shared-proposals/${share.id}.md`; const file = safe(this.root, ref);
      if (existsSync(file)) files.push({ path: ref, size: statSync(file).size, hash: hash(readFileSync(file)) });
    }
    if (box === 'materials') {
      const legacyRef = `AgentChats/${agentId}/data`; const legacyRoot = safe(this.root, legacyRef);
      for (const [path, hash] of Object.entries(fileManifest(legacyRoot))) files.push({ path: `${legacyRef}/${path}`, hash, size: statSync(safe(this.root, `${legacyRef}/${path}`)).size });
    }
    return files;
  }
  private allowed(access: ResearchAccess, reference: string): string {
    this.agent(access.agentId); const ref = segments(reference).join('/'); const state = this.snapshot();
    const isPublic = state.versions.some(v => ref.startsWith(`${normalized(dirname(v.codeRef))}/`)) || state.sharedProposals.some(s => ref === `WorkGroup/research/shared-proposals/${s.id}.md` || (ref.startsWith(`WorkGroup/research/shared-proposals/${s.id}/evidence/`) && s.evidence.some(e => e.reference === ref)));
    let permitted = isPublic;
    if (['private', 'propose', 'implement'].includes(access.mode)) permitted ||= ref.startsWith(`AgentChats/${access.agentId}/boxes/`) || ref.startsWith(`AgentChats/${access.agentId}/data/`);
    if (['review', 'publish'].includes(access.mode)) {
      const p = this.proposal(state, access.proposalId ?? '');
      if (!p.approval) throw new Error('此方案尚未授权');
      if (access.mode === 'review' && p.approval.reviewerId !== access.agentId) throw new Error('检查授权无效');
      permitted ||= ref.startsWith(`${p.approval.workspaceRef}/`);
      if (access.mode === 'publish') permitted ||= Boolean(p.experiments.at(-1)?.confirmedAt && ref.startsWith(`${p.experiments.at(-1)!.evidenceRef}/`));
    }
    if (!permitted) throw new Error('没有这份资料的读取权限；私人盒子需要逐份授权，不能跨 Agent 查阅');
    return ref;
  }
  modelFiles(access: ResearchAccess, box: string): ResearchFile[] {
    this.agent(access.agentId);
    if (box === 'workspace') {
      const p = this.proposal(this.snapshot(), access.proposalId ?? '');
      if (!p.approval || !['implement', 'review', 'publish'].includes(access.mode)) throw new Error('当前任务没有工作副本授权');
      if (access.mode === 'implement' && (p.approval.implementerId !== access.agentId || p.publishedVersionId)) throw new Error('工作副本修改授权无效');
      if (access.mode === 'review' && p.approval.reviewerId !== access.agentId) throw new Error('工作副本核查授权无效');
      return Object.entries(fileManifest(safe(this.root, p.approval.workspaceRef))).map(([path, hash]) => ({ path: `${p.approval!.workspaceRef}/${path}`, hash, size: statSync(safe(this.root, `${p.approval!.workspaceRef}/${path}`)).size }));
    }
    if (box === 'public') return this.files('public');
    if (['private', 'propose', 'implement'].includes(access.mode) && ['materials', 'hypotheses', 'facts'].includes(box)) return this.files(box as 'materials' | 'hypotheses' | 'facts', access.agentId);
    throw new Error('当前会话不能读取私人资料盒');
  }
  async preview(reference: string, offset = 0, access?: ResearchAccess): Promise<ResearchPreview> {
    const ref = access ? this.allowed(access, reference) : segments(reference).join('/');
    if (!access && !ref.startsWith('WorkGroup/research/') && !/^AgentChats\/[a-zA-Z0-9_-]+\/(boxes|data)\//u.test(ref)) throw new Error('只允许预览科研资料盒中的文件');
    const file = safe(this.root, ref);
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error('文件不存在');
    if (!Number.isInteger(offset) || offset < 0) throw new Error('读取起点无效');
    if (statSync(file).size > 30_000_000) throw new Error('文件超过 30 MB，请拆分或在本地打开；不会假装已读完整文件');
    const ext = extname(file).toLowerCase(); let raw: string;
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      if (statSync(file).size > 8_000_000) throw new Error('图片超过 8 MB，请缩小后重试');
      const imageUrl = `data:image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)};base64,${readFileSync(file).toString('base64')}`;
      return { reference: ref, text: '图片原图；如果中转站或模型不支持视觉，无法保证识图。', imageUrl, hash: hash(readFileSync(file)) };
    }
    if (ext === '.pdf') raw = (await (require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>)(readFileSync(file))).text;
    else if (ext === '.docx') raw = (await (require('mammoth') as { extractRawText(input: { path: string }): Promise<{ value: string }> }).extractRawText({ path: file })).value;
    else {
      const buffer = readFileSync(file);
      if (buffer.subarray(0, 8000).includes(0)) throw new Error('这是二进制文件，请在本地打开。支持 PDF、DOCX、常见文本和图片；扫描 PDF 暂需另加 OCR');
      raw = buffer.toString('utf8');
    }
    if (!raw.trim()) return { reference: ref, text: '[未提取到文字：扫描 PDF 或图片文字需要 OCR，尚不能作为已读证据]' };
    return { reference: ref, text: raw.slice(offset, offset + 30_000), hash: hash(readFileSync(file)), ...(offset + 30_000 < raw.length ? { nextOffset: offset + 30_000 } : {}) };
  }
  edit(access: ResearchAccess, input: { path: string; operation: 'replace' | 'create' | 'delete'; oldText?: string; newText?: string; expectedHash?: string }): { reference: string; before?: string; after?: string } {
    this.agent(access.agentId);
    if (access.mode !== 'implement') throw new Error('当前不是已授权的代码修改任务');
    const state = this.snapshot(); const p = this.proposal(state, access.proposalId ?? ''); const a = p.approval;
    if (!a || a.implementerId !== access.agentId || p.publishedVersionId || state.runs.some(r => r.status === 'running' && r.proposalId === p.id && r.action !== 'implement')) throw new Error('当前没有这份代码的修改权限');
    const path = segments(input.path).join('/'); const ref = `${a.workspaceRef}/${path}`; const file = safe(this.root, ref, input.operation === 'create');
    if (!['replace', 'create', 'delete'].includes(input.operation)) throw new Error('文件操作无效');
    if (input.newText !== undefined && (typeof input.newText !== 'string' || input.newText.length > 200_000)) throw new Error('单次写入不能超过二十万字符');
    let before: string | undefined;
    if (input.operation === 'create') { if (existsSync(file)) throw new Error('文件已存在，请先读取再做精确修改'); }
    else {
      if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > 10_000_000) throw new Error('文件不存在、不是普通文件或超过 10 MB');
      const buffer = readFileSync(file); before = hash(buffer);
      if (!input.expectedHash || input.expectedHash !== before) throw new Error('文件版本已变化或未提供读取到的哈希，未执行修改');
      const backupRef = `AgentChats/${a.implementerId}/boxes/materials/edit-backups/${p.id}/${randomUUID()}/${path}`;
      copyTree(file, safe(this.root, backupRef, true));
    }
    if (input.operation === 'delete') unlinkSync(file);
    else {
      let content = input.newText ?? '';
      if (input.operation === 'replace') {
        const raw = readFileSync(file, 'utf8');
        if (typeof input.oldText !== 'string' || !input.oldText || raw.split(input.oldText).length !== 2) throw new Error('原文字必须在文件中精确出现一次；未修改文件');
        content = raw.replace(input.oldText, () => input.newText ?? '');
      }
      const temp = `${file}.${randomUUID()}.tmp`; writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' }); renameSync(temp, file);
    }
    const after = existsSync(file) ? hash(readFileSync(file)) : undefined;
    if (before === after) throw new Error('未产生实际修改');
    p.status = 'approved'; p.implementationHash = undefined; p.updatedAt = now(); this.save(state);
    this.audit('scoped-code-edit', { proposalId: p.id, agentId: access.agentId, ref, operation: input.operation, before, after }); return { reference: ref, before, after };
  }
  context(agentId: string, privateChat: boolean): string {
    this.agent(agentId); const state = this.snapshot(); if (!state.currentVersionId) return '\n科研资料盒：尚未导入 baseline。不能声称已读代码或论文。';
    const v = this.version(state); this.assertVersion(v);
    const publicInfo = { currentVersion: { id: v.id, name: v.name, codeRef: v.codeRef, documentsRef: v.documentsRef, digest: v.digest }, publishedResults: state.versions.filter(v => v.kind !== 'baseline').map(v => ({ id: v.id, name: v.name, kind: v.kind, summary: v.summary, evidenceRef: v.evidenceRef })), authorizedMeetingProposals: state.sharedProposals };
    const own = privateChat ? state.proposals.filter(p => p.agentId === agentId || p.approval?.implementerId === agentId).map(p => ({ id: p.id, title: p.title, status: p.status, approval: p.approval, latestExperiment: p.experiments.at(-1) })) : undefined;
    return `\n科研工作区（事实以文件哈希与用户确认记录为准；方案和模型检查不是实验事实）：\n${JSON.stringify({ ...publicInfo, ...(own ? { ownPrivateIndex: own } : {}) })}\n公共盒只读；私人资料只在私聊或明确授权的单份任务中读取。不得宣称未调用工具的读写、实验或发布已完成。`;
  }
}

export { safe as researchSafePath, atomic as researchAtomicJson, fileManifest as researchFileManifest, digest as researchManifestHash, copyTree as researchCopyTree };
