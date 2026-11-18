import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { EvidenceGraph, EvidenceNode, ResearchMemoryHit } from '../shared/researchIntelligence';
import { ResearchWorkspaceStore, researchAtomicJson, researchFileManifest, researchManifestHash, researchSafePath } from './researchWorkspace';

const tokens = (s: string): Set<string> => {
  const lower = s.toLowerCase(); const words = lower.match(/[a-z0-9_./-]+|[\u3400-\u9fff]+/gu) ?? [];
  return new Set(words.flatMap(w => /[\u3400-\u9fff]/u.test(w) && w.length > 2 ? Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2)) : [w]));
};
export class ResearchMemory {
  constructor(private readonly store: ResearchWorkspaceStore) {}
  graph(proposalId?: string): EvidenceGraph {
    const state = this.store.snapshot(); const nodes: EvidenceNode[] = []; const edges: EvidenceGraph['edges'] = [];
    const current = state.versions.find(v => v.id === state.currentVersionId);
    let currentCodeHash = '';
    if (current) { this.store.assertVersion(current); currentCodeHash = researchManifestHash(researchFileManifest(researchSafePath(this.store.root, current.codeRef))); }
    for (const p of state.proposals.filter(p => !proposalId || p.id === proposalId)) {
      const add = (node: Omit<EvidenceNode, 'proposalId'>): void => { nodes.push({ ...node, proposalId: p.id }); };
      const applicability = p.sourceVersionId === state.currentVersionId ? 'current' : 'historical';
      add({ id: p.id, kind: 'proposal', title: p.title, detail: p.summary, assurance: 'hypothesis', applicability, reference: `AgentChats/${p.agentId}/boxes/hypotheses/${p.id}.md` });
      p.evidence.forEach((e, i) => {
        const path = researchSafePath(this.store.root, e.reference); const actual = existsSync(path) && statSync(path).isFile() ? createHash('sha256').update(readFileSync(path)).digest('hex') : '';
        add({ id: `${p.id}-source-${i}`, kind: 'source', title: e.reference.split('/').at(-1)!, detail: e.reason, quote: e.quote,
          hash: e.sourceHash || actual, reference: e.reference, assurance: 'file-checked', applicability: !actual || (e.sourceHash && actual !== e.sourceHash) ? 'changed' : applicability });
        edges.push({ from: `${p.id}-source-${i}`, to: p.id, relation: e.quote ? '已核对原文片段' : '已读来源；旧记录未定位原文' });
      });
      if (p.approval) {
        const codeId = `${p.id}-code`; const codeHash = this.store.codeHash(p.id);
        add({ id: codeId, kind: 'code', title: '实际代码工作副本', detail: `实施清单：${p.steps.join('；')}`, hash: codeHash, reference: p.approval.workspaceRef,
          assurance: 'file-checked', applicability: p.implementationHash && codeHash !== p.implementationHash ? 'changed' : codeHash === currentCodeHash ? 'current' : 'unverified' });
        edges.push({ from: p.id, to: codeId, relation: `用户采纳；实施清单哈希 ${p.approval.planHash}` });
        for (const r of p.reviews) {
          add({ id: r.id, kind: 'review', title: r.passed ? '代码核查通过' : '代码核查未通过', detail: r.summary, hash: r.codeHash, assurance: 'model-reviewed', applicability: r.codeHash === codeHash ? 'current' : 'historical' });
          edges.push({ from: codeId, to: r.id, relation: '核对实施条目与实际文件；不是效果证明' });
        }
        for (const e of p.experiments) {
          let intact = false;
          try { intact = researchManifestHash(researchFileManifest(researchSafePath(this.store.root, e.evidenceRef))) === e.evidenceHash; } catch { /* A missing proof is not a valid observation. */ }
          const currentScope = e.codeHash === currentCodeHash ? 'current' : e.codeHash === codeHash ? 'unverified' : 'historical';
          const scope = intact ? currentScope : 'changed';
          add({ id: e.id, kind: 'experiment', title: e.outcome === 'success' ? '实验记录' : '失败／无提升记录', detail: `${e.command}\n${e.note}`, dataset: e.dataset, hash: e.codeHash, reference: e.evidenceRef,
            assurance: e.confirmedAt ? 'human-confirmed' : 'pending', applicability: scope });
          edges.push({ from: codeId, to: e.id, relation: '实验绑定此代码哈希和凭据哈希' });
          add({ id: `${e.id}-conclusion`, kind: 'conclusion', title: e.metricName ? `${e.metricName} = ${e.metricValue || '未取得'}` : '未取得有效指标',
            detail: `${e.confirmedAt ? '用户确认的观察，尚非独立复跑证明' : '待用户核对，不能当作事实'}。仅适用于记录的数据集、划分和运行条件；不能推断普遍有效。`, dataset: e.dataset, hash: e.codeHash,
            assurance: e.confirmedAt ? 'human-confirmed' : 'pending', applicability: scope });
          edges.push({ from: e.id, to: `${e.id}-conclusion`, relation: e.confirmedAt ? '人工确认；保留适用范围' : '尚未确认' });
        }
      }
      const publication = state.versions.find(v => v.id === p.publishedVersionId);
      if (publication) {
        add({ id: publication.id, kind: 'publication', title: publication.name, detail: publication.summary, reference: publication.evidenceRef, assurance: 'human-confirmed', applicability: publication.id === state.currentVersionId ? 'current' : 'historical' });
        const experiment = p.experiments.at(-1); if (experiment) edges.push({ from: `${experiment.id}-conclusion`, to: publication.id, relation: publication.kind === 'negative-result' ? '共享失败经验，未切换公共代码' : '用户授权发布，旧版本保留' });
      }
    }
    const graph = { currentVersionId: state.currentVersionId, nodes, edges };
    if (!proposalId) researchAtomicJson(researchSafePath(this.store.root, 'runs/research/evidence-index.json', true), graph);
    return graph;
  }
  search(query: string, actorId: string, privateChat: boolean): ResearchMemoryHit[] {
    if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('记忆检索词须为1–500字符');
    this.store.modelFiles({ agentId: actorId, mode: privateChat ? 'private' : 'group' }, 'public');
    const s = this.store.snapshot(); const entries: ResearchMemoryHit[] = [];
    const current = s.versions.find(v => v.id === s.currentVersionId); if (current) this.store.assertVersion(current);
    const currentHash = current ? researchManifestHash(researchFileManifest(researchSafePath(this.store.root, current.codeRef))) : '';
    for (const v of s.versions.filter(v => v.kind !== 'baseline')) { try { this.store.assertVersion(v); } catch { continue; } entries.push({ id: v.id, kind: 'publication', text: `${v.name}\n${v.summary}`, scope: 'public', versionId: v.id, assurance: 'human-confirmed', applicability: v.id === s.currentVersionId ? 'current' : 'historical', reference: v.evidenceRef, score: 0 }); }
    for (const p of s.sharedProposals) entries.push({ id: p.id, kind: 'hypothesis', text: `${p.title}\n${p.summary}\n${p.steps.join('\n')}`, scope: 'public', assurance: 'hypothesis', applicability: 'unverified', reference: `WorkGroup/research/shared-proposals/${p.id}.md`, score: 0 });
    if (privateChat) for (const p of s.proposals) {
      if (p.agentId === actorId) entries.push({ id: p.id, kind: 'hypothesis', text: `${p.title}\n${p.summary}\n${p.steps.join('\n')}`, scope: 'private', versionId: p.sourceVersionId, assurance: 'hypothesis', applicability: p.sourceVersionId === s.currentVersionId ? 'current' : 'historical', reference: `AgentChats/${actorId}/boxes/hypotheses/${p.id}.md`, score: 0 });
      if (p.approval?.implementerId === actorId) for (const e of p.experiments.filter(e => e.confirmedAt)) {
        const factRef = `AgentChats/${actorId}/boxes/facts/${e.id}.json`;
        const exists = existsSync(researchSafePath(this.store.root, factRef)); if (!exists) continue;
        try { if (researchManifestHash(researchFileManifest(researchSafePath(this.store.root, e.evidenceRef))) !== e.evidenceHash) continue; } catch { continue; }
        entries.push({ id: e.id, kind: 'observation', text: `${p.title}\n${e.outcome === 'failure' ? '失败观察' : '用户确认观察'}：${e.metricName} ${e.metricValue}；${e.note}。用户确认不等于独立复跑。`, scope: 'private', versionId: p.publishedVersionId ?? p.sourceVersionId, codeHash: e.codeHash, dataset: e.dataset, assurance: 'human-confirmed', applicability: e.codeHash === currentHash ? 'current' : 'historical', reference: factRef, score: 0 });
      }
    }
    const q = tokens(query);
    return entries.map(e => ({ ...e, score: [...q].reduce((n, t) => n + (e.text.toLowerCase().includes(t) ? 1 : 0), 0) })).filter(e => e.score > 0).sort((a, b) => b.score - a.score).slice(0, 12);
  }
}
