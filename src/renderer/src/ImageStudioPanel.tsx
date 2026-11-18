import { useState } from 'react';
import { agentApiMode, type ProjectSnapshot, type ImageJob } from '@shared/apiCollab';
import { IconButton, List, ListItem } from './NextChat';

const statusLabels: Record<ImageJob['status'], string> = { pending: '等待你确认', running: '生成中', complete: '已完成', failed: '已停止 · 生成失败', cancelled: '已取消', interrupted: '上次中断 · 请先核查计费' };
const itemLabels = { pending: '尚未提交', running: '正在生成', complete: '已保存', failed: '失败', unknown: '结果未知，需核查' };

export function ImageStudioPanel({ snapshot, conversationId, requesterId, onSaved, onOpenAgent }: { snapshot: ProjectSnapshot; conversationId: string; requesterId?: string; onSaved: () => Promise<void>; onOpenAgent: (id: string) => void }) {
  const [error, setError] = useState('');
  const [working, setWorking] = useState('');
  const [prompts, setPrompts] = useState('');
  const studio = snapshot.imageStudio;
  const generator = snapshot.agents.find((agent) => agent.id === studio?.defaultAgentId);
  const available = snapshot.agents.filter((agent) => agent.enabled && agentApiMode(agent.model || snapshot.providers.find((provider) => provider.id === agent.providerId)?.defaultModel || '', agent.apiMode) === 'image');
  const targets = snapshot.agents.filter((agent) => agent.enabled && agent.id !== studio?.defaultAgentId);
  const parts = prompts.split(/\n\s*\n/u).map((value) => value.trim()).filter(Boolean);
  const run = async (id: string, action: () => Promise<unknown>): Promise<void> => {
    setWorking(id); setError('');
    try { await action(); await onSaved(); } catch (cause) { setError(String(cause)); } finally { setWorking(''); }
  };
  const request = (): void => {
    const agentId = requesterId || generator?.id;
    if (!agentId) return;
    const route = conversationId.startsWith('private:') ? { channel: 'private' as const, conversationId: `private:${agentId}` }
      : conversationId === 'workgroup' ? { channel: 'workgroup' as const, conversationId } : { channel: 'group' as const, conversationId };
    void run('request', () => window.cth.apiCollabRequestImageJob({ projectId: snapshot.projectId, requestedByAgentId: agentId, ...route, purpose: '手动生图申请', items: parts.map((prompt) => ({ prompt })) }));
  };
  return <div className="tz-image-studio">
    <p className="tz-dialog-intro">当前项目的伙伴共用一个默认生图助手。申请不会扣费；只有你点击下方“确认生成 N 张”后才会提交图片请求。生图不自动重试。</p>
    <List>
      <ListItem title="默认生图助手" subTitle="独立于 GPT 的聊天模型，可共用它的中转站与密钥">
        {generator ? <select aria-label="默认生图助手" value={generator.id} onChange={(event) => void run('default', () => window.cth.apiCollabSetDefaultImageAgent(event.target.value, snapshot.projectId))}>{available.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName} · {agent.model || snapshot.providers.find((provider) => provider.id === agent.providerId)?.defaultModel}</option>)}</select>
          : <IconButton text="创建独立生图助手" type="primary" disabled={Boolean(working)} onClick={() => void run('setup', () => window.cth.apiCollabSetupImageStudio(snapshot.projectId))} />}
      </ListItem>
      {generator && <ListItem title="当前生图模型" subTitle={generator.model || snapshot.providers.find((provider) => provider.id === generator.providerId)?.defaultModel}><IconButton text="修改生图模型" bordered onClick={() => onOpenAgent(generator.id)} /></ListItem>}
    </List>
    {generator && <>
      <section className="tz-image-request"><h3>伙伴头像与私聊背景</h3><p>为 {targets.map((agent) => agent.displayName).join('、')} 各准备 1 张头像和 1 张背景。明确成年女性、性感时尚写真；生成成功后自动应用。原图保留，不覆盖已有版本。</p>
        <IconButton icon="add" text={`准备 ${targets.length * 2} 张申请（不立即生成）`} bordered disabled={Boolean(working) || targets.length === 0 || targets.length > 10} onClick={() => void run('portraits', () => window.cth.apiCollabRequestPortraitBatch(snapshot.projectId))} />
      </section>
      <section className="tz-image-request"><h3>新的生图申请</h3><label htmlFor="tz-image-prompts">每段提示词对应 1 张图片；多张之间空一行。</label><textarea id="tz-image-prompts" aria-label="生图提示词" value={prompts} onChange={(event) => setPrompts(event.target.value)} placeholder="描述你想生成的图片…" rows={4} /><IconButton text={`提交 ${parts.length} 张待确认申请`} bordered disabled={Boolean(working) || parts.length === 0 || parts.length > 20} onClick={request} /></section>
    </>}
    {error && <p role="alert" className="nc-error">{error}</p>}
    <h3>申请与生成记录</h3>
    {!(studio?.jobs.length) && <p className="nc-hint">还没有生图申请。</p>}
    {studio?.jobs.slice().reverse().map((job) => <article className="tz-image-job" key={job.id} data-status={job.status} data-job-id={job.id}>
      <div className="tz-image-job-heading"><strong>{job.purpose}</strong><span>{statusLabels[job.status]}</span></div>
      <p className="tz-image-job-model"><b>{job.items.length} 张</b> · {job.generator.model} · {job.generator.providerName}</p>
      <p className="nc-hint">{job.generator.baseUrl} · 每张单独请求，最多 {job.items.length} 次生图调用。具体费用以你的中转站计价为准。</p>
      <details open={job.status === 'pending'}><summary>查看 {job.items.length} 张图片的提示词与状态</summary><ol>{job.items.map((item) => <li key={item.id}><div><strong>{item.targetAgentId ? (snapshot.agents.find((agent) => agent.id === item.targetAgentId)?.displayName || item.targetAgentId) + ' · ' + (item.assetKind === 'avatar' ? '头像' : '私聊背景') : '图片'}</strong><span>{itemLabels[item.status]}{item.size ? ' · ' + item.size : ''}</span></div><p>{item.prompt}</p>{item.resultPath && <code>{item.resultPath}</code>}{item.error && <p className="nc-error">{item.error}</p>}</li>)}</ol></details>
      {job.error && <p className="nc-error">{job.error}</p>}
      {job.status === 'pending' && <div className="tz-image-approval"><p>确认即授权本清单中的 <b>{job.items.length} 张</b>图片生成；失败不自动重试。取消不会提交图片请求。</p><div className="nc-button-row"><IconButton text={`确认生成 ${job.items.length} 张`} type="primary" disabled={Boolean(working) || studio.jobs.some((item) => item.status === 'running')} onClick={() => void run(job.id, () => window.cth.apiCollabApproveImageJob(snapshot.projectId, job.id, job.items.length))} /><IconButton text="取消申请" bordered disabled={Boolean(working)} onClick={() => void run('cancel-' + job.id, () => window.cth.apiCollabCancelImageJob(snapshot.projectId, job.id))} /></div></div>}
      {job.status === 'running' && <div className="tz-image-approval"><p>已确认 {job.approvedCount} 张 · 已保存 {job.items.filter((item) => item.status === 'complete').length} 张。可关闭此面板，后台继续生成。</p><IconButton text="停止后续图片" bordered onClick={() => { setError(''); void window.cth.apiCollabCancelImageJob(snapshot.projectId, job.id).then(onSaved).catch((cause) => setError(String(cause))); }} /></div>}
      {['failed', 'cancelled', 'interrupted'].includes(job.status) && job.items.some((item) => item.status !== 'complete') && <IconButton text={`重新申请未完成的 ${job.items.filter((item) => item.status !== 'complete').length} 张`} bordered disabled={Boolean(working)} onClick={() => void run('retry-' + job.id, () => window.cth.apiCollabRequestImageJob({ projectId: snapshot.projectId, requestedByAgentId: job.requestedByAgentId, conversationId: job.conversationId, channel: job.channel, purpose: job.purpose + ' · 重新申请（需确认）', items: job.items.filter((item) => item.status !== 'complete').map(({ prompt, targetAgentId, assetKind, size }) => ({ prompt, targetAgentId, assetKind, size })) }))} />}
    </article>)}
  </div>;
}
