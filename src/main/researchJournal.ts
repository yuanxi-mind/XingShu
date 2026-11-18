import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { ApiAgentConfig, ProviderConfig } from '../shared/apiCollab';
import type { ResearchRun } from '../shared/research';
import type { ProviderContinuation } from './researchProvider';
import { ResearchWorkspaceStore, researchAtomicJson as atomic, researchFileManifest as manifest, researchManifestHash as digest, researchSafePath as safe } from './researchWorkspace';

const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
const mutating = new Set(['save_private_proposal', 'edit_workspace_file', 'complete_implementation', 'submit_implementation_review', 'publish_confirmed_version']);
interface Guard { publicVersionId?: string; workspaceHash?: string; approvalHash?: string }
interface Checkpoint { schemaVersion: 1; runId: string; configurationHash: string; guard: Guard; state: ProviderContinuation; updatedAt: string; digest: string }
interface Transaction { name: string; argsHash: string; status: 'prepared' | 'completed'; before: string; previousIds: string[]; afterWorkspaceHash?: string; expectedWorkspaceHash?: string; expectedResult?: unknown; result?: unknown }
export interface ContinuationInfo { available: boolean; reason: string; updatedAt?: string; rounds?: number; pendingTool?: string; requestMayRepeat: boolean }

export class ResearchJournal {
  constructor(private readonly store: ResearchWorkspaceStore, private readonly run: ResearchRun) {}
  private file(name: string): string {
    if (!/^run-[a-f0-9-]{36}$/u.test(this.run.id)) throw new Error('运行ID无效');
    return safe(this.store.root, `runs/research/checkpoints/${this.run.id}/${name}`, true);
  }
  private guard(): Guard {
    const state = this.store.snapshot(); const p = state.proposals.find(p => p.id === this.run.proposalId);
    return { publicVersionId: state.currentVersionId, ...(p?.approval ? { workspaceHash: this.store.codeHash(p.id), approvalHash: p.approval.planHash } : {}) };
  }
  private context(): string {
    const s = this.store.snapshot(); return sha(JSON.stringify({ current: s.currentVersionId, proposal: s.proposals.find(p => p.id === this.run.proposalId), ownProposals: this.run.action === 'propose' ? s.proposals.filter(p => p.agentId === this.run.agentId) : undefined }));
  }
  private checkpoint(): Checkpoint | undefined {
    const path = this.file('checkpoint.json'); if (!existsSync(path)) return;
    if (statSync(path).size > 64_000_000) throw new Error('断点文件过大，已停止恢复');
    const c = JSON.parse(readFileSync(path, 'utf8')) as Checkpoint; const { digest, ...payload } = c;
    if (c.schemaVersion !== 1 || c.runId !== this.run.id || sha(JSON.stringify(payload)) !== digest || !Array.isArray(c.state?.messages) || !Number.isSafeInteger(c.state.round) || c.state.round < 0 || c.state.round > 32 || !Array.isArray(c.state.usedIds)) throw new Error('断点校验失败，未恢复或重放工具');
    return c;
  }
  info(): ContinuationInfo {
    try { const c = this.checkpoint(); if (!c) return { available: false, reason: '旧运行没有可恢复断点', requestMayRepeat: false };
      return { available: this.run.status !== 'complete' && (c.state.round < 32 || c.state.completed !== undefined), reason: this.run.status === 'complete' ? '本轮已经完成' : '保留模型上下文、已完成工具回执与当前执行位置；续跑须再次由你确认。', updatedAt: c.updatedAt, rounds: c.state.round, pendingTool: c.state.pending?.calls[c.state.pending.next]?.call.function.name, requestMayRepeat: !c.state.pending && c.state.completed === undefined };
    } catch (e) { return { available: false, reason: e instanceof Error ? e.message : '无法读取断点', requestMayRepeat: false }; }
  }
  static configuration(agent: ApiAgentConfig, provider: ProviderConfig): string {
    return sha(JSON.stringify({ agentId: agent.id, providerId: provider.id, model: agent.model || provider.defaultModel, baseUrl: provider.baseUrl, headersHash: sha(JSON.stringify(provider.headers ?? {})), reasoning: agent.reasoningEffort, system: agent.systemPrompt, schema: 1 }));
  }
  load(configurationHash: string): ProviderContinuation {
    const c = this.checkpoint(); if (!c) throw new Error('没有可恢复断点，请发起新任务');
    if (c.configurationHash !== configurationHash) throw new Error('模型、中转配置或系统提示已变化，不能把旧上下文交给不同配置；请恢复原配置或新建任务');
    const actual = this.guard();
    if (JSON.stringify(actual) !== JSON.stringify(c.guard)) {
      const pending = c.state.pending?.calls[c.state.pending.next];
      const transactionPath = pending ? this.file(`tools/${sha(pending.call.id)}.json`) : '';
      const tx = transactionPath && existsSync(transactionPath) ? JSON.parse(readFileSync(transactionPath, 'utf8')) as Transaction : undefined;
      const ownCodeEffect = tx && actual.approvalHash === c.guard.approvalHash && actual.publicVersionId === c.guard.publicVersionId && actual.workspaceHash === (tx.afterWorkspaceHash ?? tx.expectedWorkspaceHash);
      const p = this.store.snapshot().proposals.find(p => p.id === this.run.proposalId);
      const ownPublication = tx?.name === 'publish_confirmed_version' && p?.publishedVersionId && p.publishedVersionId === actual.publicVersionId;
      if (!ownCodeEffect && !ownPublication) throw new Error('公共版本、授权方案或工作副本已变化，已阻止用过期断点继续；请基于当前版本新建任务');
    }
    return c.state;
  }
  save(configurationHash: string, state: ProviderContinuation): void {
    const payload = { schemaVersion: 1 as const, runId: this.run.id, configurationHash, guard: this.guard(), state, updatedAt: new Date().toISOString() };
    atomic(this.file('checkpoint.json'), { ...payload, digest: sha(JSON.stringify(payload)) });
  }
  async once(callId: string, name: string, args: Record<string, unknown>, execute: () => Promise<unknown>): Promise<unknown> {
    const file = this.file(`tools/${sha(callId)}.json`); const argsHash = sha(JSON.stringify(args));
    let tx: Transaction | undefined;
    if (existsSync(file)) {
      tx = JSON.parse(readFileSync(file, 'utf8')) as Transaction;
      if (tx.name !== name || tx.argsHash !== argsHash) throw new Error('工具幂等标识与参数冲突，已停止');
      if (tx.status === 'completed') return tx.result;
      const recovered = this.recover(tx, args);
      if (recovered.found) { tx.status = 'completed'; tx.result = recovered.result; tx.afterWorkspaceHash = this.guard().workspaceHash; atomic(file, tx); return tx.result; }
      if (mutating.has(name) && tx.before !== this.context()) throw new Error('该工具的副作用状态不确定，已阻止自动重放。请先核对文件和执行记录，基于当前状态重新安排任务。');
    } else {
      const state = this.store.snapshot(); const p = state.proposals.find(p => p.id === this.run.proposalId);
      tx = { name, argsHash, status: 'prepared', before: this.context(), previousIds: name === 'save_private_proposal' ? state.proposals.map(p => p.id) : name === 'submit_implementation_review' ? p?.reviews.map(r => r.id) ?? [] : [] };
      if (name === 'edit_workspace_file' && p?.approval) {
        try {
          const path = String(args.path); const absolute = safe(this.store.root, `${p.approval.workspaceRef}/${path}`);
          const before = existsSync(absolute) ? readFileSync(absolute) : undefined; const files = manifest(safe(this.store.root, p.approval.workspaceRef));
          let after: string | undefined;
          if (args.operation === 'create' && !before && typeof args.newText === 'string') after = args.newText;
          else if (before && sha(before) === args.expectedHash && args.operation === 'replace' && typeof args.oldText === 'string' && args.oldText && typeof args.newText === 'string' && before.toString('utf8').split(args.oldText).length === 2) after = before.toString('utf8').replace(args.oldText, () => args.newText as string);
          else if (before && sha(before) === args.expectedHash && args.operation === 'delete') after = undefined;
          else throw new Error('不能预核对此次修改');
          if (after === undefined) delete files[path]; else files[path] = sha(after);
          const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
          tx.expectedWorkspaceHash = digest(ordered); tx.expectedResult = { reference: `${p.approval.workspaceRef}/${path}`, ...(before ? { before: sha(before) } : {}), ...(after !== undefined ? { after: sha(after) } : {}) };
        } catch { /* Invalid edits still pass through the authoritative permission checks, then their failure is recorded. */ }
      }
      atomic(file, tx);
    }
    const result = await execute();
    tx.status = 'completed'; tx.result = result; tx.afterWorkspaceHash = this.guard().workspaceHash; atomic(file, tx); return result;
  }
  private recover(tx: Transaction, args: Record<string, unknown>): { found: boolean; result?: unknown } {
    const state = this.store.snapshot(); const p = state.proposals.find(p => p.id === this.run.proposalId);
    if (tx.name === 'edit_workspace_file' && tx.expectedWorkspaceHash && tx.expectedWorkspaceHash === this.guard().workspaceHash) return { found: true, result: tx.expectedResult };
    if (tx.name === 'save_private_proposal') {
      const found = state.proposals.filter(p => !tx.previousIds.includes(p.id) && p.agentId === this.run.agentId && p.title === String(args.title).trim() && p.summary === String(args.summary).trim() && JSON.stringify(p.steps) === JSON.stringify(args.steps));
      if (found.length === 1) return { found: true, result: { ok: true, proposalId: found[0].id, summary: `已恢复已落盘的私人方案：${found[0].title}，未重复创建。` } };
    }
    if (tx.name === 'complete_implementation' && p && p.implementationHash === this.guard().workspaceHash && p.implementationSummary === String(args.summary).trim()) return { found: true, result: { ok: true, summary: `${p.implementationSummary}\n代码哈希：${p.implementationHash}；已恢复完成登记，未重复修改。` } };
    if (tx.name === 'submit_implementation_review' && p) {
      const found = p.reviews.filter(r => !tx.previousIds.includes(r.id) && r.codeHash === this.guard().workspaceHash && r.summary === String(args.summary).trim() && r.passed === (args.passed === true) && JSON.stringify(r.checks) === JSON.stringify(args.checks));
      if (found.length === 1) return { found: true, result: { ok: true, review: found[0] } };
    }
    if (tx.name === 'publish_confirmed_version' && p?.publishedVersionId) { const v = state.versions.find(v => v.id === p.publishedVersionId); if (v?.publishedBy === this.run.agentId && v.summary === String(args.summary).trim()) return { found: true, result: { ok: true, version: v } }; }
    return { found: false };
  }
}
