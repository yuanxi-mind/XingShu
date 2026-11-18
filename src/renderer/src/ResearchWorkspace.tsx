import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { agentApiMode, type ApiAgentConfig, type ProjectSnapshot } from '@shared/apiCollab';
import type { ResearchChange, ResearchExperimentInput, ResearchFile, ResearchPreview, ResearchProposal, ResearchRunInput, ResearchState } from '@shared/research';
import { AgentAvatar } from './AgentAvatar';
import { Icon, IconButton, Modal } from './NextChat';
import './ResearchWorkspace.css';
import { BenchmarkPanel, EvidencePanel, ExperimentPanel, RecoveryControl } from './ResearchTools';

interface Props {
  open: boolean;
  projectId: string;
  snapshot: ProjectSnapshot;
  busy: boolean;
  onBusyChange(busy: boolean): void;
  onRefresh(): Promise<void>;
  onClose(): void;
}

type Box = 'public' | 'materials' | 'hypotheses' | 'facts';
type Tab = 'files' | 'proposals' | 'runs' | 'benchmark' | 'evidence' | 'experiments';
type Arrangement = { implementer: string; reviewer: string; publisher: string; instruction: string };
const boxes: Array<{ id: Box; name: string; description: string; icon: string }> = [
  { id: 'public', name: '公共资料盒', description: '大家可读的代码、论文与已发布结果', icon: 'members' },
  { id: 'materials', name: '个人资料盒', description: '这个伙伴的 baseline 快照与代码工作副本', icon: 'folder' },
  { id: 'hypotheses', name: '猜想盒', description: '尚未实验确认的创新方案，默认私有', icon: 'discovery' },
  { id: 'facts', name: '确认事实盒', description: '你核对并确认过的实验记录，包括失败经验', icon: 'plugin' },
];
const proposalStatus: Record<ResearchProposal['status'], string> = { draft: '待你选择', approved: '已采纳，待修改', implemented: '已修改，待核查', 'review-failed': '核查未通过', 'review-passed': '核查通过，待实验', 'pending-confirmation': '实验待你确认', confirmed: '实验已确认', published: '已发布' };
const actionNames = { propose: '独立构思', implement: '修改代码', review: '核查代码', publish: '发布结果' };
const runStatus = { running: '正在执行', complete: '已结束', failed: '执行失败', interrupted: '已中断' };
const initialExperiment = (): ResearchExperimentInput => ({ outcome: 'success', metricName: '', metricValue: '', dataset: '', command: '', note: '' });
const emptyArrangement = (): Arrangement => ({ implementer: '', reviewer: '', publisher: '', instruction: '' });
const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+':\s*/u, '').replace(/^Error:\s*/u, '');
const dateText = (value: string): string => Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString('zh-CN', { hour12: false });
const sizeText = (size: number): string => size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(1)} MB`;
const fileName = (reference: string): string => reference.replace(/\\/gu, '/').split('/').at(-1) || reference;

export function ResearchWorkspace({ open, projectId, snapshot, busy, onBusyChange, onRefresh, onClose }: Props) {
  const [state, setState] = useState<ResearchState | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>('files');
  const [box, setBox] = useState<Box>('public');
  const [agentId, setAgentId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [files, setFiles] = useState<Partial<Record<Box, ResearchFile[]>>>({});
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [fileQuery, setFileQuery] = useState('');
  const [preview, setPreview] = useState<ResearchPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [brainstormOpen, setBrainstormOpen] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('');
  const [proposalId, setProposalId] = useState('');
  const [proposalOwner, setProposalOwner] = useState('');
  const [arrangements, setArrangements] = useState<Record<string, Arrangement>>({});
  const [experiments, setExperiments] = useState<Record<string, ResearchExperimentInput>>({});
  const [experimentOpen, setExperimentOpen] = useState(false);
  const [changes, setChanges] = useState<ResearchChange[] | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesError, setChangesError] = useState('');
  const [runLimit, setRunLimit] = useState(20);
  const contentRef = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const scope = useRef(projectId);
  const operation = useRef(false);
  const snapshotSequence = useRef(0);
  const previewSequence = useRef(0);
  const stateRef = useRef(state);
  const busyRef = useRef(busy);
  scope.current = projectId;
  stateRef.current = state;
  busyRef.current = busy || working;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; snapshotSequence.current += 1; previewSequence.current += 1; }; }, []);

  const loadState = useCallback(async (quiet = false): Promise<void> => {
    const sequence = ++snapshotSequence.current;
    const requestedProject = projectId;
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const next = await window.cth.apiCollabResearchSnapshot(requestedProject);
      if (!mounted.current || scope.current !== requestedProject || sequence !== snapshotSequence.current) return;
      setState(current => quiet && JSON.stringify(current) === JSON.stringify(next) ? current : next);
    } catch (cause) {
      if (mounted.current && scope.current === requestedProject && sequence === snapshotSequence.current) setError(errorText(cause));
    } finally {
      if (mounted.current && scope.current === requestedProject && sequence === snapshotSequence.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    void loadState();
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending || (!busyRef.current && !stateRef.current?.runs.some(run => run.status === 'running'))) return;
      pending = true;
      void loadState(true).finally(() => { pending = false; });
    }, 1100);
    return () => { window.clearInterval(timer); snapshotSequence.current += 1; };
  }, [open, loadState]);

  const enabled = snapshot.agents.filter(agent => agent.enabled && agentApiMode(agent.model ?? snapshot.providers.find(provider => provider.id === agent.providerId)?.defaultModel ?? '', agent.apiMode) !== 'image');
  const name = (id: string): string => snapshot.agents.find(agent => agent.id === id)?.displayName ?? id;
  const options = (agents: ApiAgentConfig[] = enabled) => agents.map(agent => <option key={agent.id} value={agent.id}>{agent.displayName}</option>);
  const currentVersion = state?.versions.find(version => version.id === state.currentVersionId);
  const selectedVersion = state?.versions.find(version => version.id === (versionId || state.currentVersionId));
  const hasRunning = Boolean(state?.runs.some(run => run.status === 'running'));
  const locked = busy || working || hasRunning;
  const proposal = state?.proposals.find(item => item.id === proposalId);
  const arrangement = proposal ? arrangements[proposal.id] ?? emptyArrangement() : emptyArrangement();
  const experiment = proposal ? experiments[proposal.id] ?? initialExperiment() : initialExperiment();
  const latestExperiment = proposal?.experiments.at(-1);
  const latestReview = proposal?.reviews.at(-1);
  const reviewPassed = Boolean(proposal?.implementationHash && latestReview?.passed && latestReview.codeHash === proposal.implementationHash);
  const selectedBox = boxes.find(item => item.id === box)!;

  useEffect(() => {
    if (agentId && snapshot.agents.some(agent => agent.id === agentId)) return;
    setAgentId(snapshot.agents[0]?.id ?? '');
  }, [snapshot.agents, agentId]);

  useEffect(() => {
    if (!open || !state) return;
    let cancelled = false;
    setFilesLoading(true);
    setFileError('');
    const ids: Box[] = ['public', 'materials', 'hypotheses', 'facts'];
    void Promise.allSettled(ids.map(id => id !== 'public' && !agentId ? Promise.resolve([] as ResearchFile[]) : window.cth.apiCollabResearchFiles(projectId, id, id === 'public' ? undefined : agentId, id === 'public' ? versionId || undefined : undefined))).then(results => {
      if (cancelled) return;
      const next: Partial<Record<Box, ResearchFile[]>> = {};
      const errors: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') next[ids[index]] = result.value;
        else errors.push(`${boxes[index].name}：${errorText(result.reason)}`);
      });
      setFiles(next); setFileError(errors.join('；')); setFilesLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, projectId, agentId, versionId, state]);

  useEffect(() => {
    setChanges(null); setChangesError('');
    if (!open || !proposal?.approval) return;
    let cancelled = false;
    setChangesLoading(true);
    void window.cth.apiCollabResearchChanges(projectId, proposal.id).then(result => { if (!cancelled) setChanges(result); }).catch(cause => { if (!cancelled) setChangesError(errorText(cause)); }).finally(() => { if (!cancelled) setChangesLoading(false); });
    return () => { cancelled = true; };
  }, [open, projectId, proposal?.id, proposal?.updatedAt, state?.runs]);

  const goTab = (next: Tab): void => { previewSequence.current += 1; setPreview(null); setPreviewLoading(false); setTab(next); };
  const selectBox = (next: Box): void => { setBox(next); setFileQuery(''); goTab('files'); };
  const patchArrangement = (patch: Partial<Arrangement>): void => { if (proposal) setArrangements(current => ({ ...current, [proposal.id]: { ...(current[proposal.id] ?? emptyArrangement()), ...patch } })); };
  const patchExperiment = (patch: Partial<ResearchExperimentInput>): void => { if (proposal) setExperiments(current => ({ ...current, [proposal.id]: { ...(current[proposal.id] ?? initialExperiment()), ...patch } })); };
  const perform = async (work: () => Promise<void>): Promise<void> => {
    if (busyRef.current || operation.current || stateRef.current?.runs.some(run => run.status === 'running')) return;
    const requestedProject = projectId;
    operation.current = true; busyRef.current = true; setWorking(true); onBusyChange(true); setError(''); setNotice('');
    try {
      await work();
      if (mounted.current && scope.current === requestedProject) { await loadState(); await onRefresh(); }
    } catch (cause) {
      if (mounted.current && scope.current === requestedProject) { setError(errorText(cause)); await loadState(true); }
    } finally {
      operation.current = false;
      if (mounted.current && scope.current === requestedProject) { setWorking(false); onBusyChange(false); }
    }
  };
  const run = (input: ResearchRunInput): Promise<void> => perform(async () => {
    const result = await window.cth.apiCollabResearchRun(projectId, input);
    if (!mounted.current || scope.current !== projectId) return;
    const failed = result.filter(item => item.status === 'failed' || item.status === 'interrupted');
    setNotice(result.some(item => item.status === 'running') ? '已开始执行，文件和回执会持续更新。' : failed.length ? `本轮有 ${failed.length} 项未完成，请查看执行记录和错误原因。` : '本轮请求已结束。请核对方案、文件和执行回执。');
  });
  const reveal = async (reference: string): Promise<void> => {
    try {
      const result = await window.cth.revealPath(`${snapshot.projectRoot.replace(/[\\/]$/u, '')}/${reference}`);
      if (!result.ok) throw new Error(result.error || '打开文件夹失败');
    } catch (cause) { setError(errorText(cause)); }
  };
  const readPreview = async (reference: string, append = false): Promise<void> => {
    const sequence = ++previewSequence.current;
    const requestedProject = projectId;
    const offset = append ? preview?.nextOffset : undefined;
    if (!append) setPreview({ reference, text: '' });
    setPreviewLoading(true); setPreviewError('');
    try {
      const result = await window.cth.apiCollabResearchRead(projectId, reference, offset);
      if (!mounted.current || scope.current !== requestedProject || sequence !== previewSequence.current) return;
      setPreview(current => append && current?.reference === reference ? { ...result, text: current.text + result.text } : result);
    } catch (cause) { if (mounted.current && scope.current === requestedProject && sequence === previewSequence.current) setPreviewError(errorText(cause)); }
    finally { if (mounted.current && scope.current === requestedProject && sequence === previewSequence.current) setPreviewLoading(false); }
  };
  const proposalNext = (item: ResearchProposal): string => {
    if (item.status === 'published') return '结果已入公共资料盒，可开始下一轮研究。';
    if (!item.approval) return '先读方案；决定采用时指定修改人和核查人。';
    if (!item.implementationHash || item.status === 'review-failed') return '让修改人按已采纳的清单修改工作副本。';
    if (!item.reviews.at(-1)?.passed || item.reviews.at(-1)?.codeHash !== item.implementationHash || item.status === 'implemented') return '让另一位伙伴核查实际代码与实施清单。';
    if (!item.experiments.length || item.experiments.at(-1)?.codeHash !== item.implementationHash) return '当前代码还没有对应的实验。请先在服务器运行，取回日志和结果后再登记。';
    if (!item.experiments.at(-1)?.confirmedAt) return '核对最近一次实验的数值和日志，再人工确认。';
    return '选择发布人，把已确认的结果放入公共资料盒。';
  };
  const visibleProposals = (state?.proposals ?? []).filter(item => !proposalOwner || item.agentId === proposalOwner).slice().reverse();
  const visibleFiles = (files[box] ?? []).filter(file => file.path.toLocaleLowerCase().includes(fileQuery.trim().toLocaleLowerCase()));
  const boxRoot = box === 'public' ? selectedVersion?.codeRef.replace(/\/code$/u, '') ?? 'WorkGroup' : `AgentChats/${agentId}/boxes/${box}`;
  const runningCount = state?.runs.filter(item => item.status === 'running').length ?? 0;
  const nextStage = !proposal?.approval ? 'approval' : !proposal.implementationHash || proposal.status === 'review-failed' || !reviewPassed ? 'implementation' : !latestExperiment?.confirmedAt || latestExperiment.codeHash !== proposal.implementationHash ? 'experiment' : 'publish';

  if (!open) return null;
  return <Modal title="科研工作台" onClose={onClose}><div className="tz-research-workspace">
    <div className="rw-topbar"><div><span className="rw-eyebrow">当前项目 · 四个资料盒</span><h2>从一个想法，走到有证据的结果</h2><p>{!currentVersion ? '第一步：导入原始代码，可同时选择论文。' : runningCount ? `${runningCount} 位伙伴正在执行，文件和回执会持续更新。` : '公共资料供大家读取；私人想法由你决定何时公开。'}</p></div><div className="rw-actions"><IconButton icon="reload" text="刷新" bordered disabled={loading} onClick={() => void loadState()} />{!currentVersion ? <IconButton icon="add" text="导入原始代码与论文" type="primary" className="rw-primary" disabled={locked || loading} onClick={() => void perform(async () => { if (await window.cth.apiCollabResearchImportBaseline(projectId)) setNotice('原始代码和所选论文已复制到公共资料盒。原文件不变，公共版本只读。'); })} /> : <IconButton icon="discovery" text="独立想方案" type="primary" className="rw-primary" disabled={locked} onClick={() => { goTab('files'); setBrainstormOpen(true); }} />}</div></div>
    {(error || notice) && <div className={'rw-feedback' + (error ? ' rw-error' : '')} role={error ? 'alert' : 'status'}><span>{error || notice}</span><button type="button" aria-label="收起提示" onClick={() => { setError(''); setNotice(''); }}><Icon name="close" /></button></div>}
    <div className="rw-body">
      <aside className="rw-sidebar" aria-label="研究资料盒">
        <div className="rw-sidebar-title">共享给大家</div>
        <button type="button" className="rw-box-button" aria-pressed={box === 'public' && tab === 'files'} onClick={() => selectBox('public')}><Icon name="members" /><span><strong>公共资料盒</strong><small>{currentVersion ? '只读版本 · 已发布结果' : '尚未导入原始资料'}</small></span><b>{files.public?.length ?? '—'}</b></button>
        <div className="rw-private-heading"><span>每位伙伴的私人空间</span><small>只有本人和你可见</small></div>
        <label className="rw-agent-picker"><span className="rw-sr-only">查看哪位伙伴的资料盒</span>{agentId && <AgentAvatar id={agentId} />}<select aria-label="查看哪位伙伴的资料盒" value={agentId} onChange={event => { setAgentId(event.target.value); setFiles(current => ({ public: current.public })); }} disabled={!snapshot.agents.length}>{!snapshot.agents.length && <option value="">还没有伙伴</option>}{options(snapshot.agents)}</select></label>
        {boxes.filter(item => item.id !== 'public').map(item => <button type="button" key={item.id} className="rw-box-button" aria-pressed={box === item.id && tab === 'files'} disabled={!agentId} onClick={() => selectBox(item.id)}><Icon name={item.icon} /><span><strong>{item.name}</strong><small>{item.id === 'materials' ? '资料与代码副本' : item.id === 'hypotheses' ? '未公开的方案' : '发现与实验依据'}</small></span><b>{files[item.id]?.length ?? '—'}</b></button>)}
        <div className="rw-sidebar-note"><Icon name="plugin" /><p>这里没有固定角色。每次采用方案时，再决定谁修改、谁核查。</p></div>
        <button type="button" className="rw-folder-link" onClick={() => void reveal('WorkGroup')}><Icon name="folder" />打开项目共享文件夹</button>
      </aside>
      <div className="rw-main">
        <nav className="rw-tabs" aria-label="科研工作区页面"><button type="button" aria-pressed={tab === 'files'} onClick={() => goTab('files')}>资料与版本</button><button type="button" aria-pressed={tab === 'proposals'} onClick={() => goTab('proposals')}>方案与实验 <span>{state?.proposals.length ?? '—'}</span></button><button type="button" aria-pressed={tab === 'runs'} onClick={() => goTab('runs')}>执行记录{runningCount > 0 && <span className="rw-running-dot">{runningCount} 项进行中</span>}</button><button type="button" aria-pressed={tab === 'evidence'} onClick={() => goTab('evidence')}>证据追溯</button><button type="button" aria-pressed={tab === 'experiments'} onClick={() => goTab('experiments')}>可复现实验</button><button type="button" aria-pressed={tab === 'benchmark'} onClick={() => goTab('benchmark')}>能力评测</button></nav>
        <main ref={contentRef} className="rw-content" aria-busy={loading && !state}>
          <BenchmarkPanel projectId={projectId} snapshot={snapshot} open={tab === 'benchmark' && !preview} />
          <EvidencePanel projectId={projectId} snapshot={snapshot} open={tab === 'evidence' && !preview} research={state} onRead={reference => void readPreview(reference)} />
          <ExperimentPanel projectId={projectId} snapshot={snapshot} open={tab === 'experiments' && !preview} research={state} refreshResearch={loadState} />
          <div className="rw-core-content" hidden={['benchmark', 'evidence', 'experiments'].includes(tab) && !preview}>
          {!state ? <div className="rw-empty"><Icon name="folder" /><h3>{loading ? '正在读取研究资料…' : '研究资料暂时无法读取'}</h3><p>已有文件不会被重置。</p>{!loading && <IconButton text="重新读取" bordered onClick={() => void loadState()} />}</div> : preview ? <section className="rw-preview">
            <header className="rw-section-heading"><div><button type="button" className="rw-text-button" onClick={() => { previewSequence.current += 1; setPreview(null); setPreviewLoading(false); }}>‹ 返回{tab === 'proposals' ? '方案' : tab === 'runs' ? '执行记录' : '资料列表'}</button><h3>{fileName(preview.reference)}</h3></div><IconButton icon="export" text="在文件夹中查看" bordered onClick={() => void reveal(preview.reference)} /></header><code className="rw-path">{preview.reference}</code>
            {previewError && <div className="rw-inline-error" role="alert">{previewError}<button type="button" className="rw-text-button" disabled={previewLoading} onClick={() => void readPreview(preview.reference, Boolean(preview.text))}>重试读取</button></div>}
            {preview.imageUrl && /^(?:data:image\/(?:png|jpe?g|webp|gif);base64,|blob:)/iu.test(preview.imageUrl) ? <img className="rw-preview-image" src={preview.imageUrl} alt={fileName(preview.reference)} /> : /\.md(?:own)?$/iu.test(preview.reference) ? <div className="rw-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span className="rw-muted">[图片引用：{alt || '请打开原文件查看'}]</span>, a: ({ href, children }) => href && /^(?:WorkGroup|AgentChats)\//u.test(href) ? <button type="button" className="rw-text-button" onClick={() => void readPreview(href)}>{children}</button> : <span>{children}{href && <code>（{href}）</code>}</span> }}>{preview.text}</ReactMarkdown></div> : <pre className="rw-file-text">{preview.text}</pre>}
            {previewLoading && <p className="rw-muted" role="status">正在读取文件…</p>}{preview.nextOffset !== undefined && <div className="rw-read-more"><p>此处只读取了部分内容，后面还有内容。</p><IconButton text={previewLoading ? '正在读取…' : '继续读取'} bordered disabled={previewLoading} onClick={() => void readPreview(preview.reference, true)} /></div>}
          </section> : tab === 'files' ? <>
            {brainstormOpen && <form className="rw-brainstorm" onSubmit={event => { event.preventDefault(); const ids = selectedAgents.filter(id => enabled.some(agent => agent.id === id)); if (!ids.length || !instruction.trim()) return; goTab('proposals'); void run({ action: 'propose', agentIds: ids, instruction: instruction.trim() }); }}><header className="rw-section-heading"><div><h3>各自读资料，独立想方案</h3><p>选多少位都可以。彼此不会收到对方未公开的想法。</p></div><IconButton icon="close" title="收起独立构思" onClick={() => setBrainstormOpen(false)} /></header><fieldset><legend>哪些伙伴参加</legend><div className="rw-agent-checks">{enabled.map(agent => <label className="rw-agent-check" key={agent.id}><input type="checkbox" checked={selectedAgents.includes(agent.id)} disabled={locked} onChange={() => setSelectedAgents(current => current.includes(agent.id) ? current.filter(id => id !== agent.id) : [...current, agent.id])} /><AgentAvatar id={agent.id} /><span>{agent.displayName}</span></label>)}</div>{!enabled.length && <p className="rw-muted">还没有启用的文字伙伴，请先在设置中添加。</p>}</fieldset><label>这次研究什么<textarea rows={3} value={instruction} disabled={locked} onChange={event => setInstruction(event.target.value)} placeholder="说明研究问题、限制和你期望看到的证据。" /></label><div className="rw-form-footer"><p>点击后会调用所选伙伴的模型，并读取公共资料和各自的私人资料。</p><IconButton text="开始独立构思" buttonType="submit" type="primary" className="rw-primary" disabled={locked || !currentVersion || !instruction.trim() || !selectedAgents.some(id => enabled.some(agent => agent.id === id))} /></div></form>}
            <header className="rw-section-heading"><div><span className="rw-eyebrow">{box === 'public' ? '本项目所有伙伴可读' : `${name(agentId)} · 私人空间`}</span><h3>{selectedBox.name}</h3><p>{selectedBox.description}</p></div><IconButton icon="folder" text="打开此资料盒" bordered disabled={box !== 'public' && !agentId} onClick={() => void reveal(boxRoot)} /></header>
            {box === 'public' && currentVersion && <div className="rw-version-bar"><label>查看版本<select aria-label="查看公共资料版本" value={versionId} onChange={event => setVersionId(event.target.value)}><option value="">当前公共代码 · {currentVersion.name}</option>{state.versions.slice().reverse().map(version => <option key={version.id} value={version.id}>{version.kind === 'baseline' ? '原始代码' : version.kind === 'negative-result' ? '失败实验记录' : '发布版本'} · {version.name} · {dateText(version.createdAt)}</option>)}</select></label>{selectedVersion && <p>{selectedVersion.summary}<small>{selectedVersion.id === state.currentVersionId ? '当前公共代码版本' : '正在浏览历史记录，不会切换当前代码'}</small></p>}</div>}
            {box === 'hypotheses' && <div className="rw-box-hint"><p>想法文件先放在本人盒子里。你可以查看方案，再决定采纳或公开。</p><IconButton text="查看这位伙伴的方案" bordered onClick={() => { setProposalOwner(agentId); goTab('proposals'); }} /></div>}
            {fileError && <p className="rw-inline-error" role="alert">{fileError}</p>}
            {!currentVersion && box === 'public' ? <div className="rw-empty rw-baseline-empty"><Icon name="folder" /><h3>先放入原始代码和论文</h3><p>公共资料盒当前为空。导入会复制资料，后续研究从工作副本开始，原始版本会保留。</p><IconButton text="选择原始代码文件夹" type="primary" className="rw-primary" disabled={locked} onClick={() => void perform(async () => { if (await window.cth.apiCollabResearchImportBaseline(projectId)) setNotice('原始资料已导入。现在可以选择伙伴，开始独立想方案。'); })} /></div> : <><div className="rw-file-toolbar"><span>{filesLoading ? '正在更新文件…' : files[box] ? `${files[box]!.length} 个文件` : '文件数量尚未读取'}</span><label><Icon name="search" /><input aria-label="筛选盒中相对路径" placeholder="查找文件" value={fileQuery} onChange={event => setFileQuery(event.target.value)} /></label></div>{visibleFiles.length ? <ul className="rw-file-list">{visibleFiles.map(file => <li key={file.path}><button type="button" onClick={() => void readPreview(file.path)}><Icon name="plugin" /><span><strong>{fileName(file.path)}</strong><code>{file.path}</code></span><small>{sizeText(file.size)}</small><span aria-hidden="true">›</span></button></li>)}</ul> : <div className="rw-empty rw-small-empty"><Icon name={selectedBox.icon} /><h3>{filesLoading ? '正在读取文件…' : !files[box] ? '暂时无法读取这个资料盒' : fileQuery ? '没有找到这个文件' : '这个资料盒还是空的'}</h3><p>{!files[box] ? '请点击上方刷新重试；已有文件不会被清空。' : fileQuery ? '试试文件名或一段路径。' : box === 'hypotheses' ? '先让伙伴独立构思，产出的方案会放在这里。' : box === 'materials' ? '采纳方案后，会在修改人的资料盒创建带日期的代码副本。' : box === 'facts' ? '可核对的发现与证据会保留在这里。' : '此版本中没有可浏览的文件。'}</p></div>}</>}
            <details className="rw-details"><summary tabIndex={0}>资料保存在哪里</summary><code className="rw-path">{boxRoot}</code><p className="rw-muted">文件夹中看到的是实际项目文件。请勿直接改动已冻结的公共版本。</p></details>
          </> : tab === 'proposals' ? <>
            <header className="rw-section-heading"><div><span className="rw-eyebrow">先看依据，再决定下一步</span><h3>方案与实验</h3><p>采纳、共享和发布是三个独立的决定。</p></div>{proposal && <IconButton text="返回方案列表" bordered onClick={() => { setProposalId(''); setExperimentOpen(false); }} />}</header>
            {!proposal ? <><label className="rw-filter">查看谁的方案<select aria-label="按伙伴筛选方案" value={proposalOwner} onChange={event => setProposalOwner(event.target.value)}><option value="">所有伙伴（仅你可总览）</option>{options(snapshot.agents)}</select></label>{visibleProposals.length ? <div className="rw-proposal-list">{visibleProposals.map(item => <button type="button" className="rw-proposal-card" key={item.id} onClick={() => { setProposalId(item.id); setExperimentOpen(false); }}><div className="rw-card-meta"><span className="rw-owner"><AgentAvatar id={item.agentId} />{name(item.agentId)}</span><span className="rw-status" data-status={item.status}>{proposalStatus[item.status]}</span></div><h4>{item.title}</h4><p>{item.summary}</p><small>{item.steps.length} 条实施步骤 · 第 {item.revision} 版 · {dateText(item.updatedAt)}</small><span className="rw-card-next">查看方案与下一步 <span aria-hidden="true">›</span></span></button>)}</div> : <div className="rw-empty"><div className="rw-empty-agents">{enabled.slice(0, 5).map(agent => <AgentAvatar key={agent.id} id={agent.id} />)}</div><h3>{proposalOwner ? '这位伙伴还没有研究方案' : '还没有研究方案'}</h3><p>导入资料后，选择任意数量的伙伴独立构思。方案出现后，再决定是否采用。</p><IconButton text="选择伙伴并开始构思" bordered disabled={!currentVersion || locked} onClick={() => { goTab('files'); setBrainstormOpen(true); }} /></div>}</> : <article className="rw-proposal-detail">
              <div className="rw-card-meta"><span className="rw-owner"><AgentAvatar id={proposal.agentId} />{name(proposal.agentId)} · 第 {proposal.revision} 版</span><span className="rw-status" data-status={proposal.status}>{proposalStatus[proposal.status]}</span></div><h2>{proposal.title}</h2><div className="rw-next-action"><strong>下一步</strong><p>{proposalNext(proposal)}</p>{proposal.status !== 'published' && <button type="button" className="rw-text-button" onClick={() => contentRef.current?.querySelector<HTMLElement>(`[data-research-stage="${nextStage}"]`)?.scrollIntoView({ block: 'start' })}>前往下一步 ›</button>}</div><section className="rw-reading"><h4>方案说明</h4><p>{proposal.summary}</p><h4>实施清单</h4><ol>{proposal.steps.map((step, index) => <li key={index}>{step}</li>)}</ol><h4>依据与来源</h4><ul className="rw-evidence-list">{proposal.evidence.map((evidence, index) => <li key={index}><button type="button" className="rw-reference" onClick={() => void readPreview(evidence.reference)}><Icon name="plugin" /><span>{evidence.reference}</span></button><p>{evidence.reason}</p></li>)}</ul></section>
              <section className="rw-sharing"><div><h4>是否把这版方案公开给总群？</h4><p>只授权当前第 {proposal.revision} 版的副本。其他私人文件与后续改动不会一并公开。</p></div><IconButton icon="share" text={state.sharedProposals.some(item => item.proposalId === proposal.id && item.revision === proposal.revision) ? '这版方案已公开' : '授权公开这版方案'} bordered disabled={locked || state.sharedProposals.some(item => item.proposalId === proposal.id && item.revision === proposal.revision)} onClick={() => void perform(async () => { await window.cth.apiCollabResearchShareProposal(projectId, proposal.id); setNotice(`第 ${proposal.revision} 版方案已放入总群共享区。`); })} /></section>
              {!proposal.approval ? <form className="rw-approval" data-research-stage="approval" onSubmit={event => { event.preventDefault(); if (!arrangement.implementer || !arrangement.reviewer || arrangement.implementer === arrangement.reviewer) return; void perform(async () => { await window.cth.apiCollabResearchApproveProposal(projectId, proposal.id, arrangement.implementer, arrangement.reviewer); setNotice('方案已采纳，已为修改人建立带日期的代码工作副本。点击“开始改代码”才会调用模型。'); }); }}><h4>采用这份方案</h4><p className="rw-muted">从当前公共代码复制一份工作副本，再开始修改。修改人与核查人必须不同。</p><div className="rw-two-col"><label>谁来改代码<select aria-label="谁来改代码" value={arrangement.implementer} onChange={event => patchArrangement({ implementer: event.target.value, reviewer: arrangement.reviewer === event.target.value ? '' : arrangement.reviewer })} disabled={locked}><option value="">请选择</option>{options()}</select></label><label>谁来核查<select aria-label="谁来核查" value={arrangement.reviewer} onChange={event => patchArrangement({ reviewer: event.target.value })} disabled={locked}><option value="">请选择另一位伙伴</option>{options(enabled.filter(agent => agent.id !== arrangement.implementer))}</select></label></div><div className="rw-form-footer"><p>本次只确认方案和分工，不会立即调用模型。</p><IconButton text="采纳并创建工作副本" type="primary" className="rw-primary" buttonType="submit" disabled={locked || !currentVersion || !enabled.some(agent => agent.id === arrangement.implementer) || !enabled.some(agent => agent.id === arrangement.reviewer) || arrangement.implementer === arrangement.reviewer} /></div></form> : <>
                <section className="rw-implementation" data-research-stage="implementation"><h4>修改与核查</h4><div className="rw-assignees"><span><AgentAvatar id={proposal.approval.implementerId} /><small>修改代码<strong>{name(proposal.approval.implementerId)}</strong></small></span><span><AgentAvatar id={proposal.approval.reviewerId} /><small>独立核查<strong>{name(proposal.approval.reviewerId)}</strong></small></span></div><button type="button" className="rw-reference" onClick={() => void reveal(proposal.approval!.workspaceRef)}><Icon name="folder" /><span>打开带日期的代码工作副本</span></button><code className="rw-path">{proposal.approval.workspaceRef}</code>{proposal.status !== 'published' && <><label>本轮补充说明（可选）<textarea rows={2} value={arrangement.instruction} disabled={locked} onChange={event => patchArrangement({ instruction: event.target.value })} placeholder="例如：先处理上一轮核查指出的问题。" /></label><div className="rw-actions"><IconButton text={proposal.implementationHash ? '继续修改代码' : '开始改代码'} type="primary" className="rw-primary" disabled={locked || !enabled.some(agent => agent.id === proposal.approval!.implementerId)} onClick={() => void run({ action: 'implement', proposalId: proposal.id, agentId: proposal.approval!.implementerId, instruction: arrangement.instruction.trim() || undefined })} /><IconButton text="核查实际代码" bordered disabled={locked || !proposal.implementationHash || !enabled.some(agent => agent.id === proposal.approval!.reviewerId)} onClick={() => void run({ action: 'review', proposalId: proposal.id, agentId: proposal.approval!.reviewerId, instruction: arrangement.instruction.trim() || undefined })} /></div></>}{proposal.implementationSummary && <div className="rw-reading"><h4>修改人的完成说明</h4><p>{proposal.implementationSummary}</p></div>}
                  <details className="rw-details" open><summary tabIndex={0}>实际文件变动 {changes && `· ${changes.length} 个`}</summary>{changesLoading && <p className="rw-muted">正在比对工作副本和采用时的公共代码…</p>}{changesError && <p className="rw-inline-error" role="alert">{changesError}</p>}{changes && !changes.length && <p className="rw-muted">尚未检测到实际文件变动，文字回复不代表代码已经修改。</p>}{changes && changes.length > 0 && <ul className="rw-changes">{changes.map(change => <li key={change.path}><span data-type={change.type}>{{ added: '新增', modified: '修改', deleted: '删除' }[change.type]}</span>{change.type === 'deleted' ? <code>{change.path}</code> : <button type="button" className="rw-text-button" onClick={() => void readPreview(`${proposal.approval!.workspaceRef}/${change.path}`)}>{change.path}</button>}</li>)}</ul>}</details>
                  {proposal.reviews.length > 0 && <details className="rw-details" open><summary tabIndex={0}>代码核查记录 · {proposal.reviews.length} 次</summary>{proposal.reviews.slice().reverse().map(review => <div className="rw-review" key={review.id}><div className="rw-card-meta"><strong className={review.passed ? 'rw-success-text' : 'rw-error-text'}>{review.passed ? '核查通过' : '核查未通过'}</strong><small>{name(review.reviewerId)} · {dateText(review.createdAt)}</small></div><p>{review.summary}</p><ol>{review.checks.map(check => <li key={check.stepIndex}><strong>第 {check.stepIndex + 1} 项 · {check.passed ? '通过' : '未通过'}</strong><p>{check.evidence}</p>{check.files.map(file => <button key={file} type="button" className="rw-reference" onClick={() => void readPreview(`${proposal.approval!.workspaceRef}/${file}`)}>{file}</button>)}</li>)}</ol><details className="rw-hashes"><summary tabIndex={0}>本次核查绑定的版本</summary><code>代码：{review.codeHash}</code><code>方案：{review.planHash}</code></details></div>)}</details>}
                </section>
                <section className="rw-experiment-section" data-research-stage="experiment"><header className="rw-section-heading"><div><h4>你的实验与人工确认</h4><p>先在服务器运行实验，再取回日志和结果。这里不会代替你运行训练。</p></div>{proposal.status !== 'published' && <IconButton text={experimentOpen ? '收起表单' : '登记一次实验'} bordered disabled={locked || !reviewPassed} onClick={() => setExperimentOpen(current => !current)} />}</header>{!reviewPassed && proposal.status !== 'published' && <p className="rw-muted">当前代码通过核查后，才能登记实验。</p>}
                  {experimentOpen && proposal.status !== 'published' && <form className="rw-experiment-form" onSubmit={event => { event.preventDefault(); void perform(async () => { if (await window.cth.apiCollabResearchRecordExperiment(projectId, proposal.id, experiment)) { setNotice('实验记录与所选证据已保存。请打开日志核对，再单独人工确认。'); setExperimentOpen(false); } }); }}><div className="rw-two-col"><label>这次结果<select aria-label="这次结果" value={experiment.outcome} disabled={locked} onChange={event => patchExperiment({ outcome: event.target.value as ResearchExperimentInput['outcome'] })}><option value="success">成功</option><option value="failure">失败或没有提升</option></select></label><label>数据集<input value={experiment.dataset} onChange={event => patchExperiment({ dataset: event.target.value })} disabled={locked} required /></label><label>{experiment.outcome === 'failure' ? '指标名称（可选）' : '指标名称'}<input value={experiment.metricName} onChange={event => patchExperiment({ metricName: event.target.value })} placeholder="例如：F1" disabled={locked} required={experiment.outcome === 'success'} /></label><label>{experiment.outcome === 'failure' ? '真实数值（可选）' : '真实数值'}<input value={experiment.metricValue} onChange={event => patchExperiment({ metricValue: event.target.value })} placeholder="例如：83.4%" disabled={locked} required={experiment.outcome === 'success'} /></label></div><label>运行命令<textarea value={experiment.command} onChange={event => patchExperiment({ command: event.target.value })} rows={2} disabled={locked} required /></label><label>{experiment.outcome === 'failure' ? '失败原因' : '补充说明'}<textarea value={experiment.note} onChange={event => patchExperiment({ note: event.target.value })} rows={2} disabled={locked} required={experiment.outcome === 'failure'} /></label><div className="rw-form-footer"><p>下一步由系统窗口选择本次的日志或结果文件。取消选择不会保存这次记录。</p><IconButton text="选择证据并保存实验" buttonType="submit" type="primary" className="rw-primary" disabled={locked || !reviewPassed || !experiment.dataset.trim() || !experiment.command.trim() || (experiment.outcome === 'success' ? !experiment.metricName.trim() || !experiment.metricValue.trim() : !experiment.note.trim())} /></div></form>}
                  {!proposal.experiments.length && <p className="rw-muted rw-empty-line">尚未登记实验。需要真实结果与人工确认后才能发布。</p>}{proposal.experiments.slice().reverse().map(item => <article key={item.id} className="rw-experiment"><div className="rw-card-meta"><strong>{item.outcome === 'success' ? '成功实验' : '失败／无提升实验'}</strong><span className="rw-status" data-status={item.confirmedAt ? 'confirmed' : 'pending-confirmation'}>{item.confirmedAt ? '你已确认' : '待你核对'}</span></div><dl><div><dt>指标</dt><dd>{[item.metricName, item.metricValue].filter(Boolean).join(' · ') || '未产生指标'}</dd></div><div><dt>数据集</dt><dd>{item.dataset}</dd></div><div><dt>命令</dt><dd><code>{item.command}</code></dd></div>{item.note && <div><dt>说明</dt><dd>{item.note}</dd></div>}</dl><button type="button" className="rw-reference" onClick={() => void reveal(item.evidenceRef)}><Icon name="folder" /><span>查看实验凭据文件夹</span></button><code className="rw-path">{item.evidenceRef}</code><small className="rw-muted">登记：{dateText(item.createdAt)}{item.confirmedAt && ` · 人工确认：${dateText(item.confirmedAt)}`}</small>{item.codeHash !== proposal.implementationHash && <p className="rw-muted">这份记录对应较早的代码，不能用于发布当前代码。</p>}{!item.confirmedAt && proposal.status !== 'published' && <div className="rw-confirm"><p>我已核对结果、数据集、命令和附件，确认它们对应这次代码。</p><IconButton text="人工确认这次实验" bordered disabled={locked || !reviewPassed || item.codeHash !== proposal.implementationHash} onClick={() => void perform(async () => { await window.cth.apiCollabResearchConfirmExperiment(projectId, proposal.id, item.id); setNotice('这次实验已由你确认。现在可以指定伙伴发布已确认的结果。'); })} /></div>}<details className="rw-hashes"><summary tabIndex={0}>代码与证据校验值</summary><code>代码：{item.codeHash}</code><code>证据：{item.evidenceHash}</code></details></article>)}
                </section>
                {proposal.status !== 'published' && <section className="rw-publish" data-research-stage="publish"><h4>发布已确认的结果</h4><p>{latestExperiment?.outcome === 'failure' ? '失败结果会作为公共负面记录共享，不会替换当前公共代码。' : '发布成功实验时，会保留旧版本，并建立新的公共代码版本。'}</p><p className="rw-muted">发布使用最近一次实验，且须对应当前已核查的代码。新实验需要单独人工确认。</p><div className="rw-publish-controls"><label>谁来发布<select aria-label="谁来发布" value={arrangement.publisher} onChange={event => patchArrangement({ publisher: event.target.value })} disabled={locked}><option value="">选择一位伙伴</option>{options()}</select></label><IconButton text={latestExperiment?.outcome === 'failure' ? '发布失败实验记录' : '发布已确认结果'} type="primary" className="rw-primary" disabled={locked || !reviewPassed || !latestExperiment?.confirmedAt || latestExperiment.codeHash !== proposal.implementationHash || !enabled.some(agent => agent.id === arrangement.publisher)} onClick={() => void run({ action: 'publish', proposalId: proposal.id, agentId: arrangement.publisher })} /></div></section>}
                {proposal.publishedVersionId && <div className="rw-next-action"><strong>结果已发布</strong><p>对应版本已保存在公共资料盒。</p><IconButton text="查看发布记录" bordered onClick={() => { setVersionId(proposal.publishedVersionId!); selectBox('public'); }} /></div>}
              </>}
            </article>}
          </> : <>
            <header className="rw-section-heading"><div><span className="rw-eyebrow">来自实际执行</span><h3>执行记录</h3><p>只展示已发生的调用与工具回执，不使用模拟进度。</p></div></header>{!state.runs.length ? <div className="rw-empty"><Icon name="history" /><h3>还没有执行记录</h3><p>导入资料、采纳分工不会自动调用模型。你点击开始后，执行过程才会出现在这里。</p></div> : <div className="rw-runs">{state.runs.slice().reverse().slice(0, runLimit).map(item => <article className="rw-run" key={item.id}><div className="rw-card-meta"><span className="rw-owner"><AgentAvatar id={item.agentId} />{name(item.agentId)} · {actionNames[item.action]}</span><span className="rw-status" data-status={item.status}>{runStatus[item.status]}</span></div><RecoveryControl projectId={projectId} runId={item.id} running={item.status === 'running'} onRefresh={() => loadState(true)} /><small className="rw-muted">开始：{dateText(item.startedAt)}{item.finishedAt && ` · 结束：${dateText(item.finishedAt)}`}</small>{item.status === 'running' && <p className="rw-running-note">请求尚未结束。等待真实回执；关闭窗口后仍可返回查看。</p>}{item.summary && <p className="rw-run-summary">{item.summary}</p>}{item.error && <p className="rw-inline-error" role="alert">{item.error}</p>}{item.proposalId && <button type="button" className="rw-text-button" onClick={() => { setProposalId(item.proposalId!); goTab('proposals'); }}>查看对应方案</button>}<details className="rw-details" open={item.status === 'running' || item.status === 'failed' || item.status === 'interrupted'}><summary tabIndex={0}>工具回执 · {item.receipts.length} 条</summary>{item.receipts.length ? <ol className="rw-receipts">{item.receipts.map((receipt, index) => <li key={index}><span className={receipt.ok ? 'rw-success-text' : 'rw-error-text'}>{receipt.ok ? '完成' : '失败'}</span><div><strong>{receipt.tool}</strong><p>{receipt.summary}</p><small>{dateText(receipt.at)}</small></div></li>)}</ol> : <p className="rw-muted">尚未收到工具回执。</p>}</details><details className="rw-details"><summary tabIndex={0}>本轮指令</summary><p className="rw-pre-wrap">{item.instruction || '按已采纳方案执行。'}</p></details></article>)}{state.runs.length > runLimit && <IconButton text={`再显示 ${Math.min(20, state.runs.length - runLimit)} 条记录`} bordered onClick={() => setRunLimit(current => current + 20)} />}</div>}
          </>}
          </div>
        </main>
      </div>
    </div>
    <footer className="rw-footer"><span>{working || hasRunning ? '有操作正在执行，可关闭后返回查看。' : '关闭保留本项目草稿。切换项目后，研究资料各自独立。'}</span><span>{currentVersion ? `公共版本：${currentVersion.name}` : '尚未建立原始版本'}</span></footer>
  </div></Modal>;
}
