import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ApiAgentConfig, CollabTask, ProjectSnapshot } from '@shared/apiCollab';
import { AgentAvatar } from './AgentAvatar';
import { Icon, IconButton, Modal } from './NextChat';
import './TaskWorkspace.css';

interface Props {
  open: boolean;
  projectId: string;
  snapshot: ProjectSnapshot;
  assignee: string;
  onAssigneeChange(id: string): void;
  busy: boolean;
  onBusyChange(busy: boolean): void;
  onRefresh(): Promise<void>;
  onClose(): void;
}

interface Step {
  key: string;
  description: string;
  assignedAgentId: string;
  runtimeRole: string;
  dependsOnKeys: string[];
  reviewerAgentId: string;
  includeDependencyResults: boolean;
  publishResult: boolean;
  maxRevisions: number;
}

const statusNames: Record<string, string> = { pending: '待开始', running: '进行中', review: '待验收', done: '已完成', blocked: '需处理', failed: '执行失败', rework: '待修改' };
const toggle = (list: string[], value: string): string[] => list.includes(value) ? list.filter(item => item !== value) : [...list, value];
const resultPath = (task: CollabTask, agentId: string): string => {
  const prefix = `AgentChats/${agentId}/data/`;
  const reference = task.resultReference?.replace(/\\/g, '/') ?? '';
  return task.assignedAgentId === agentId && reference.startsWith(prefix) ? reference.slice(prefix.length) : '';
};

export function TaskWorkspace({ open, projectId, snapshot, assignee, onAssigneeChange, busy, onBusyChange, onRefresh, onClose }: Props) {
  const [tab, setTab] = useState<'tasks' | 'workflow' | 'files'>('tasks');
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('all');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [revisions, setRevisions] = useState(2);
  const [proposal, setProposal] = useState('');
  const [baseline, setBaseline] = useState('');
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [shareDependencies, setShareDependencies] = useState(false);
  const [publish, setPublish] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [workflowName, setWorkflowName] = useState('');
  const [supervisor, setSupervisor] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  const [fileMode, setFileMode] = useState<'handoff' | 'backup'>('handoff');
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [handoffPath, setHandoffPath] = useState('');
  const [archiveAgent, setArchiveAgent] = useState('');
  const [archivePath, setArchivePath] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState('');
  const operation = useRef(false);
  const enabled = snapshot.agents.filter(agent => agent.enabled);
  const name = (id?: string): string => snapshot.agents.find(agent => agent.id === id)?.displayName ?? (id ? '原负责人已移除' : '尚未指定');
  const options = (agents: ApiAgentConfig[] = enabled) => agents.map(agent => <option key={agent.id} value={agent.id}>{agent.displayName}</option>);
  const clearFeedback = (): void => { setError(''); setNotice(''); setReceipt(''); };

  const perform = async (work: () => Promise<void>): Promise<void> => {
    if (busy || operation.current) return;
    operation.current = true; onBusyChange(true); clearFeedback();
    try { await work(); await onRefresh(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message.includes('ENOENT') ? '找不到这份文件或文件夹。请检查路径和文件是否存在；普通任务可以先留空资料路径。' : message.replace(/^Error invoking remote method '[^']+':\s*/u, '').replace(/^Error:\s*/u, ''));
      await onRefresh().catch(() => {});
    }
    finally { operation.current = false; onBusyChange(false); }
  };
  const createTask = () => perform(async () => {
    if (!description.trim() || !enabled.some(agent => agent.id === assignee)) throw new Error('先选择负责人，再写清要做什么。');
    await window.cth.apiCollabCreateTask({ projectId, assignedAgentId: assignee, description: description.trim(), runtimeRole: role.trim() || undefined,
      reviewerAgentId: reviewer || undefined, maxRevisions: reviewer ? revisions : 0, dependsOn: dependencies, includeDependencyResults: shareDependencies,
      publishResult: publish, proposalReference: proposal.trim() || undefined, baselineReference: baseline.trim() || undefined });
    setDescription(''); setRole(''); setReviewer(''); setRevisions(2); setProposal(''); setBaseline(''); setDependencies([]); setShareDependencies(false); setPublish(false);
    setCreating(false); setFilter('all'); setNotice('任务已创建。点击任务上的“开始任务”才会调用模型。');
  });
  const taskAction = (task: CollabTask, action: 'run' | 'approve' | 'rework') => perform(async () => {
    if (action === 'run') await window.cth.apiCollabRunTask(projectId, task.id);
    else await window.cth.apiCollabResolveTask(projectId, task.id, action, notes[task.id]?.trim());
    setResults(current => { const next = { ...current }; delete next[task.id]; return next; });
    setNotice(action === 'run' ? '任务请求已结束。请查看任务状态和成果。' : action === 'approve' ? '已通过验收。' : '修改意见已保存，点击“重新执行”让负责人继续修改。');
  });
  const preview = (task: CollabTask) => {
    if (results[task.id] !== undefined) { setResults(current => { const next = { ...current }; delete next[task.id]; return next; }); return; }
    void perform(async () => { const content = await window.cth.apiCollabReadTaskResult(projectId, task.id); setResults(current => ({ ...current, [task.id]: content })); });
  };
  const addStep = () => setSteps(current => [...current, { key: `task-${crypto.randomUUID()}`, description: '', assignedAgentId: '', runtimeRole: '', dependsOnKeys: [], reviewerAgentId: '', includeDependencyResults: false, publishResult: false, maxRevisions: 2 }]);
  const patchStep = (key: string, patch: Partial<Step>) => setSteps(current => current.map(step => step.key === key ? { ...step, ...patch } : step));
  const createWorkflow = () => perform(async () => {
    const result = await window.cth.apiCollabCreatePaperWorkflow({ projectId, name: workflowName.trim() || undefined, supervisorAgentId: supervisor || undefined,
      tasks: steps.map(step => ({ ...step, description: step.description.trim(), runtimeRole: step.runtimeRole.trim() || undefined, reviewerAgentId: step.reviewerAgentId || undefined, maxRevisions: step.reviewerAgentId ? step.maxRevisions : 0 })) });
    setSteps([]); setWorkflowName(''); setTab('tasks'); setCreating(false); setFilter('all'); setNotice('协作任务已创建。先查看每项分工，再点击“开始待办”。'); setReceipt(result.reportReference);
  });
  const runPending = () => perform(async () => {
    const result = await window.cth.apiCollabRunWorkflow(projectId, supervisor || undefined);
    setResults({});
    if (result.supervisionReport || result.finalReportReference) setReceipt(result.supervisionReport || result.finalReportReference || '');
    const stopped = result.tasks.find(task => task.id === result.stoppedTaskId);
    const waitingForReview = result.error === '任务需要人工审核' && stopped?.status === 'review' && !stopped.error;
    const waitingForDependency = result.error === '等待前置任务完成' && stopped?.status === 'pending';
    if ((result.error && !waitingForReview && !waitingForDependency) || result.supervisorError) throw new Error([!waitingForReview && !waitingForDependency && result.error, result.supervisorError && `进度汇报失败：${result.supervisorError}`].filter(Boolean).join('；'));
    setNotice(waitingForReview ? '已完成本次任务，等你验收。通过后，再点击“开始待办”继续下一步。' : waitingForDependency ? '正在等待前置任务通过验收。处理完成后，再点击“开始待办”。' : result.finalReportReference ? '待办已完成，并生成汇总稿。' : '本次待办处理结束，请查看任务状态。');
  });
  const handoff = () => perform(async () => {
    const reference = await window.cth.apiCollabHandoffFile(projectId, source, target, handoffPath.trim());
    setNotice(`已把文件复制给${name(target)}，原文件保留。`); setReceipt(reference); setHandoffPath('');
  });
  const archive = () => perform(async () => {
    const reference = await window.cth.apiCollabArchiveFile(projectId, archivePath.trim(), archiveAgent || undefined);
    setNotice('已保存一份独立备份，原文件保留。'); setReceipt(reference); setArchivePath('');
  });

  if (!open) return null;
  const filters = [
    { id: 'all', label: '全部任务', count: snapshot.tasks.length },
    { id: 'pending', label: '待开始', count: snapshot.tasks.filter(task => ['pending', 'rework'].includes(task.status)).length },
    { id: 'review', label: '待验收', count: snapshot.tasks.filter(task => task.status === 'review').length },
    { id: 'done', label: '已完成', count: snapshot.tasks.filter(task => task.status === 'done').length }
  ];
  const visibleTasks = snapshot.tasks.filter(task => filter === 'all' || (filter === 'pending' ? ['pending', 'rework'].includes(task.status) : task.status === filter)).slice().reverse();
  const sourceResults = snapshot.tasks.filter(task => resultPath(task, source));
  const archiveResults = snapshot.tasks.filter(task => resultPath(task, archiveAgent));

  return <Modal title="任务与资料" onClose={onClose}><div className="tz-task-workspace">
    <nav className="tw-tabs" aria-label="任务与资料分区">{([
      ['tasks', '任务进度', 'discovery'], ['workflow', '多步协作', 'plugin'], ['files', '文件交接', 'folder']
    ] as const).map(([id, label, icon]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => { setTab(id); clearFeedback(); }}><Icon name={icon} />{label}</button>)}</nav>
    {(error || notice || receipt) && <div className={'tw-feedback ' + (error ? 'tw-feedback-error' : '')} role={error ? 'alert' : 'status'}>{error || notice}{receipt && <details className="tw-receipt"><summary>查看保存位置</summary><code>{receipt}</code></details>}</div>}
    <div className="tw-content">
      {tab === 'tasks' && <>
        {!creating ? <>
          <header className="tw-heading"><div><span className="tw-eyebrow">当前项目 · {projectId}</span><h2>事情进行到哪一步了？</h2><p>创建任务 → 开始执行 → 查看成果 → 验收或提出修改。</p></div><IconButton text="新建任务" icon="add" type="primary" className="tw-primary" disabled={busy} onClick={() => setCreating(true)} /></header>
          <div className="tw-counts" aria-label="按任务状态筛选">{filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}><span>{item.label}</span><strong>{item.count}</strong></button>)}</div>
          {snapshot.tasks.length === 0 ? <div className="tw-empty"><div className="tw-empty-crew">{enabled.slice(0, 4).map(agent => <AgentAvatar key={agent.id} id={agent.id} />)}</div><h3>先把一件事交给一位伙伴。</h3><p>{enabled.length ? '写清楚要做什么、由谁负责、谁来验收。其他设置可以先不填。' : '当前项目还没有启用的智能体。先到设置中添加并启用伙伴，再来分配任务。'}</p><IconButton text="创建第一个任务" icon="add" type="primary" className="tw-primary" disabled={busy || !enabled.length} onClick={() => setCreating(true)} /></div> : <>
            <div className="tw-list-toolbar"><span>{busy ? '正在处理请求，请稍候…' : '只有点击开始，才会调用相应模型。'}</span><IconButton text={busy ? '正在处理…' : '开始待办'} icon="play" bordered disabled={busy || !snapshot.tasks.some(task => task.status === 'pending')} onClick={() => void runPending()} /></div>
            {!visibleTasks.length && <p className="tw-no-results">这个分类暂时没有任务，切换“全部任务”查看。</p>}
            <div className="tw-task-list">{visibleTasks.map(task => <article className="tw-task-card" key={task.id} aria-label={'任务：' + task.description.split('\n')[0]}>
              <div className="tw-card-top"><div className="tw-owner"><AgentAvatar id={task.assignedAgentId || 'assistant'} /><strong>{name(task.assignedAgentId)}</strong></div><span className="tw-status" data-status={task.status}>{statusNames[task.status] ?? task.status}</span></div>
              <h3>{task.description.split('\n')[0]}</h3>
              <div className="tw-task-meta"><span>验收：{task.reviewerAgentId ? name(task.reviewerAgentId) : '我来验收'}</span>{task.revisionCount > 0 && <span>已修改 {task.revisionCount} 次</span>}{task.dependsOn?.length ? <span>前置任务：{task.dependsOn.length} 项</span> : null}</div>
              {task.error && <p className="tw-inline-error" role="alert">{task.error}</p>}
              {task.reviewNote && <blockquote className="tw-review-note">修改意见：{task.reviewNote}</blockquote>}
              <div className="tw-card-actions">{['pending', 'failed', 'rework'].includes(task.status) && <IconButton text={task.status === 'pending' ? '开始任务' : '重新执行'} icon="play" type="primary" className="tw-primary" disabled={busy} onClick={() => void taskAction(task, 'run')} />}{task.resultReference && <IconButton text={results[task.id] !== undefined ? '收起成果' : '查看成果'} icon="discovery" bordered disabled={busy} onClick={() => preview(task)} />}</div>
              {results[task.id] !== undefined && <section className="tw-result" aria-label="任务成果"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> }}>{results[task.id]}</ReactMarkdown></section>}
              {task.status === 'review' && <div className="tw-review"><label>修改意见<textarea aria-label="修改意见" rows={2} value={notes[task.id] ?? ''} onChange={event => setNotes(current => ({ ...current, [task.id]: event.target.value }))} placeholder="哪里不满意、希望改成什么样？要求修改时必填。" /></label><div className="tw-card-actions"><IconButton text="通过验收" type="primary" className="tw-primary" disabled={busy} onClick={() => void taskAction(task, 'approve')} /><IconButton text="要求修改" bordered disabled={busy || !notes[task.id]?.trim()} onClick={() => void taskAction(task, 'rework')} /></div></div>}
              <details className="tw-details"><summary>任务设置与文件</summary><div className="tw-details-body"><p className="tw-full-description">{task.description}</p>{task.runtimeRole && <p>这次的职责：{task.runtimeRole}</p>}{task.dependsOn?.length ? <p>先完成：{task.dependsOn.map(id => snapshot.tasks.find(item => item.id === id)?.description.split('\n')[0] || '原任务已移除').join('；')}</p> : null}
                {['pending', 'failed'].includes(task.status) && !task.resultReference && <label>改派给<select aria-label="更改任务负责人" value={enabled.some(agent => agent.id === task.assignedAgentId) ? task.assignedAgentId : ''} disabled={busy} onChange={event => { const id = event.target.value; if (id) void perform(async () => { await window.cth.apiCollabAssignTask(projectId, task.id, id); setNotice('负责人已更新。'); }); }}><option value="">选择负责人</option>{options()}</select></label>}
                {task.resultReference && <p>成果文件<code>{task.resultReference}</code></p>}{task.workspaceReference && <p>本次工作目录<code>{task.workspaceReference}</code></p>}{task.proposalReference && <p>采用的方案<code>{task.proposalReference}</code></p>}{task.baselineReference && <p>参考基线<code>{task.baselineReference}</code></p>}
                {task.checkerVerdict && <p>检查结论：{{ pass: '检查通过', rework: '需要修改', reject: '未通过' }[task.checkerVerdict]}</p>}{task.publishStatus && <p>成果存放：{{ private: '负责人私人资料', proposed: '共享区草稿，待确认', accepted: '已确认归档' }[task.publishStatus]}</p>}{task.changedFiles?.length ? <p>涉及的文件<code>{task.changedFiles.join('\n')}</code></p> : null}
                {task.checkerVerdict === 'pass' && task.publishStatus === 'proposed' && <IconButton text="确认归档成果" bordered disabled={busy} onClick={() => void perform(async () => { await window.cth.apiCollabAcceptTaskResult(projectId, task.id); setNotice('成果已确认归档。'); })} />}
              </div></details>
            </article>)}</div>
            <details className="tw-details tw-supervision"><summary>需要有人汇报进度？</summary><div className="tw-details-body"><label>进度汇报人（可选）<select aria-label="进度汇报人" value={supervisor} onChange={event => setSupervisor(event.target.value)}><option value="">暂不安排</option>{options()}</select></label><p>运行待办暂停或遇到问题时，让它依据任务简介和状态汇报；不会因此共享其他伙伴的私人文件。</p></div></details>
          </>}
        </> : <form className="tw-create" onSubmit={event => { event.preventDefault(); void createTask(); }}>
          <header className="tw-heading"><div><span className="tw-eyebrow">分配一件具体的事</span><h2>谁来做，做到什么程度？</h2><p>先填下面三项。创建后不会立即调用模型。</p></div><IconButton text="返回任务" bordered onClick={() => setCreating(false)} /></header>
          {!enabled.length && <p className="tw-inline-error">当前没有启用的智能体，请先到设置中添加并启用。</p>}
          <label className="tw-field"><span><b className="tw-step-number">1</b>谁来负责</span><select aria-label="任务负责人" value={assignee} onChange={event => { onAssigneeChange(event.target.value); if (reviewer === event.target.value) setReviewer(''); }}><option value="">选择一位已启用的伙伴</option>{options()}</select></label>
          <label className="tw-field"><span><b className="tw-step-number">2</b>要做什么</span><textarea aria-label="任务内容" value={description} onChange={event => setDescription(event.target.value)} rows={4} placeholder="例如：阅读项目中的 baseline 论文，对照代码整理各模块的作用，交付一份带文件位置的对照清单。" /><small>把要交付的内容和完成标准一起写清楚。</small></label>
          <div className="tw-two-col"><label className="tw-field"><span><b className="tw-step-number">3</b>谁来验收</span><select aria-label="审核人" value={reviewer} onChange={event => setReviewer(event.target.value)}><option value="">我来验收</option>{options(enabled.filter(agent => agent.id !== assignee))}</select></label>{reviewer && <label className="tw-field"><span>最多自动修改几次</span><input aria-label="最多自动返工次数" type="number" min={0} max={3} value={revisions} onChange={event => setRevisions(Math.max(0, Math.min(3, Number(event.target.value) || 0)))} /></label>}</div>
          <details className="tw-details"><summary>更多设置 <small>职责、参考资料、先后关系与共享</small></summary><div className="tw-details-body tw-form-stack">
            <label>这次的职责（可选）<input aria-label="本轮职责" value={role} onChange={event => setRole(event.target.value)} placeholder="例如：代码分析。仅用于这次任务。" /></label>
            <div className="tw-help"><strong>普通任务可以跳过资料路径。</strong><p>只有要关联某份方案或基线时才填写。使用当前项目内、以 WorkGroup/ 开头的路径。</p></div>
            <label>采用哪份创新方案（可选）<input aria-label="创新方案路径" value={proposal} onChange={event => setProposal(event.target.value)} placeholder="例如：WorkGroup/data/创新方案.md" /></label>
            <label>参考哪份基线代码或文件（可选）<input aria-label="基线路径" value={baseline} onChange={event => setBaseline(event.target.value)} placeholder="例如：WorkGroup/data/baseline" /></label>
            {snapshot.tasks.length > 0 && <fieldset><legend>需要先等哪些任务通过验收？</legend><p className="tw-help-text">不选表示不依赖其他任务；选择后，必须等它们完成。</p>{snapshot.tasks.map(task => <label className="tw-check" key={task.id}><input type="checkbox" checked={dependencies.includes(task.id)} onChange={() => setDependencies(current => toggle(current, task.id))} /><span>{task.description.split('\n')[0]}</span></label>)}<label className="tw-check"><input type="checkbox" checked={shareDependencies} onChange={event => setShareDependencies(event.target.checked)} /><span>把选中任务的成果交给负责人参考</span></label></fieldset>}
            <label className="tw-check"><input type="checkbox" checked={publish} onChange={event => setPublish(event.target.checked)} /><span>完成后，把成果副本放到共享资料<small>默认只存入负责人私人资料。</small></span></label>
          </div></details>
          <div className="tw-submit"><p>{reviewer || shareDependencies ? '选中的审核人或负责人会收到相应成果，内容将发往它使用的中转站。' : '完成后先由你查看成果，再决定通过验收或要求修改。'}</p><IconButton text={busy ? '正在保存…' : '创建任务'} type="primary" className="tw-primary" buttonType="submit" disabled={busy || !description.trim() || !enabled.some(agent => agent.id === assignee)} /></div>
        </form>}
      </>}
      {tab === 'workflow' && <>
        <header className="tw-heading"><div><span className="tw-eyebrow">需要接力完成时使用</span><h2>把一件大事拆成几步。</h2><p>每一步做什么、谁来做、先等谁完成，都由你决定。</p></div><IconButton text="添加步骤" icon="add" type="primary" className="tw-primary" disabled={busy || steps.length >= 50} onClick={addStep} /></header>
        {!steps.length ? <div className="tw-empty"><Icon name="plugin" /><h3>先加第一步，再安排接力。</h3><p>例如：整理材料 → 分别撰写 → 汇总验收。先后关系需要在步骤里明确选择。</p><IconButton text="添加第一步" icon="add" type="primary" className="tw-primary" disabled={busy} onClick={addStep} /></div> : <form className="tw-form-stack" onSubmit={event => { event.preventDefault(); void createWorkflow(); }}>
          <label>这组协作叫什么（可选）<input aria-label="协作名称" value={workflowName} onChange={event => setWorkflowName(event.target.value)} placeholder="例如：baseline 分析与方案整理" /></label>
          {steps.map((step, index) => <section className="tw-workflow-step" key={step.key} aria-label={`步骤 ${index + 1}`}><div className="tw-step-title"><strong><b className="tw-step-number">{index + 1}</b>步骤 {index + 1}</strong><IconButton text="移除步骤" disabled={busy} onClick={() => setSteps(current => current.filter(item => item.key !== step.key).map(item => ({ ...item, dependsOnKeys: item.dependsOnKeys.filter(key => key !== step.key) })))} /></div>
            <div className="tw-two-col"><label>谁来做<select aria-label={`步骤 ${index + 1} 负责人`} value={step.assignedAgentId} onChange={event => patchStep(step.key, { assignedAgentId: event.target.value, reviewerAgentId: step.reviewerAgentId === event.target.value ? '' : step.reviewerAgentId })}><option value="">选择负责人</option>{options()}</select></label><label>谁来验收<select aria-label={`步骤 ${index + 1} 审核人`} value={step.reviewerAgentId} onChange={event => patchStep(step.key, { reviewerAgentId: event.target.value })}><option value="">我来验收</option>{options(enabled.filter(agent => agent.id !== step.assignedAgentId))}</select></label></div>
            <label>这一步做什么<textarea aria-label={`步骤 ${index + 1} 内容`} rows={2} value={step.description} onChange={event => patchStep(step.key, { description: event.target.value })} placeholder="写清要交付的内容和完成标准" /></label>
            {steps.length > 1 && <fieldset><legend>先等哪些步骤通过验收？</legend>{steps.map((candidate, candidateIndex) => candidate.key !== step.key && <label className="tw-check" key={candidate.key}><input type="checkbox" checked={step.dependsOnKeys.includes(candidate.key)} onChange={() => patchStep(step.key, { dependsOnKeys: toggle(step.dependsOnKeys, candidate.key) })} /><span>步骤 {candidateIndex + 1}：{candidate.description.trim().split('\n')[0] || '尚未填写内容'}</span></label>)}<small className="tw-help-text">不选表示没有前置依赖；上下排列本身不决定先后。</small></fieldset>}
            <details className="tw-details"><summary>这一步的更多设置</summary><div className="tw-details-body tw-form-stack"><label>临时职责<input aria-label={`步骤 ${index + 1} 职责`} value={step.runtimeRole} onChange={event => patchStep(step.key, { runtimeRole: event.target.value })} placeholder="可不填，不会变成固定身份" /></label><label className="tw-check"><input type="checkbox" checked={step.includeDependencyResults} onChange={event => patchStep(step.key, { includeDependencyResults: event.target.checked })} /><span>允许读取选中前置步骤的成果</span></label><label className="tw-check"><input type="checkbox" checked={step.publishResult} onChange={event => patchStep(step.key, { publishResult: event.target.checked })} /><span>完成后把成果副本放到共享资料</span></label>{step.reviewerAgentId && <label>最多自动修改几次<input aria-label={`步骤 ${index + 1} 最多返工次数`} type="number" min={0} max={3} value={step.maxRevisions} onChange={event => patchStep(step.key, { maxRevisions: Math.max(0, Math.min(3, Number(event.target.value) || 0)) })} /></label>}</div></details>
          </section>)}
          <details className="tw-details"><summary>流程遇到问题时，安排谁汇报？</summary><div className="tw-details-body"><label>进度汇报人<select aria-label="协作进度汇报人" value={supervisor} onChange={event => setSupervisor(event.target.value)}><option value="">暂不安排</option>{options()}</select></label><p>只接收任务简介、职责和状态，不自动读取其他伙伴的私人文件。</p></div></details>
          <div className="tw-submit"><p>创建只保存分工；回到任务进度后再启动。审核或授权共享的成果将发往对应中转站。</p><IconButton text={busy ? '正在保存…' : '创建协作任务'} type="primary" className="tw-primary" buttonType="submit" disabled={busy || !steps.length || steps.some(step => !step.description.trim() || !enabled.some(agent => agent.id === step.assignedAgentId))} /></div>
        </form>}
      </>}
      {tab === 'files' && <>
        <header className="tw-heading"><div><span className="tw-eyebrow">文件仍留在当前项目</span><h2>把资料交给谁，留好哪一版？</h2><p>这里处理已有文件的复制与备份，不会调用模型。</p></div></header>
        <div className="tw-file-switch" aria-label="文件操作">{([['handoff', '交给另一位伙伴'], ['backup', '备份一个版本']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={fileMode === id} onClick={() => setFileMode(id)}>{label}</button>)}</div>
        {fileMode === 'handoff' ? <form className="tw-form-stack" onSubmit={event => { event.preventDefault(); void handoff(); }}><div className="tw-help"><strong>私人资料默认不会互相看见。</strong><p>在这里选择一份文件，明确交给某位伙伴。交接会复制文件，接收方的同名旧文件会先备份。</p></div>
          <div className="tw-two-col"><label>文件原来属于谁<select aria-label="交付人" value={source} onChange={event => { setSource(event.target.value); setHandoffPath(''); if (target === event.target.value) setTarget(''); }}><option value="">选择文件所有者</option>{options(snapshot.agents)}</select></label><label>交给谁<select aria-label="接收人" value={target} onChange={event => setTarget(event.target.value)}><option value="">选择接收人</option>{options(snapshot.agents.filter(agent => agent.id !== source))}</select></label></div>
          {sourceResults.length > 0 && <label>从任务成果中选择<select aria-label="选择交接成果" value={sourceResults.some(task => resultPath(task, source) === handoffPath) ? handoffPath : ''} onChange={event => setHandoffPath(event.target.value)}><option value="">选择一份已保存的成果</option>{sourceResults.map(task => <option key={task.id} value={resultPath(task, source)}>{task.description.split('\n')[0]}</option>)}</select></label>}
          <label>要交接的文件<input aria-label="交接文件路径" value={handoffPath} onChange={event => setHandoffPath(event.target.value)} placeholder="例如：notes/论文分析.md" /><small>也可填写相对于这位伙伴私人 data 文件夹的路径。{source && <code>{`AgentChats/${source}/data/`}</code>}</small></label>
          <div className="tw-submit"><p>仅复制你指定的这一份文件，不会开放整个私人资料夹。</p><IconButton text={busy ? '正在交接…' : '复制给接收人'} type="primary" className="tw-primary" buttonType="submit" disabled={busy || !source || !target || source === target || !handoffPath.trim()} /></div>
        </form> : <form className="tw-form-stack" onSubmit={event => { event.preventDefault(); void archive(); }}><div className="tw-help"><strong>修改之前，先保留一份旧版本。</strong><p>备份会另存到版本目录，不覆盖或删除当前文件。</p></div>
          <label>备份谁的成果<select aria-label="成果位置" value={archiveAgent} onChange={event => { setArchiveAgent(event.target.value); setArchivePath(''); }}><option value="">共享成果区</option>{snapshot.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.displayName} 的私人文件</option>)}</select></label>
          {archiveResults.length > 0 && <label>从任务成果中选择<select aria-label="选择备份成果" value={archiveResults.some(task => resultPath(task, archiveAgent) === archivePath) ? archivePath : ''} onChange={event => setArchivePath(event.target.value)}><option value="">选择要保留的成果</option>{archiveResults.map(task => <option key={task.id} value={resultPath(task, archiveAgent)}>{task.description.split('\n')[0]}</option>)}</select></label>}
          <label>要备份的文件<input aria-label="备份文件路径" value={archivePath} onChange={event => setArchivePath(event.target.value)} placeholder={archiveAgent ? '例如：notes/论文分析.md' : '例如：论文初稿.md'} /><small>相对于 <code>{archiveAgent ? `AgentChats/${archiveAgent}/data/` : 'WorkGroup/artifacts/'}</code> 的路径；共享成果区不是原始资料 data 文件夹。</small></label>
          <div className="tw-submit"><p>备份成功后会显示保存位置。</p><IconButton text={busy ? '正在备份…' : '保存备份'} type="primary" className="tw-primary" buttonType="submit" disabled={busy || !archivePath.trim()} /></div>
        </form>}
      </>}
    </div>
  </div></Modal>;
}
