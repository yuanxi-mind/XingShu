import { useEffect, useRef, useState } from 'react';
import { AVATAR_PRESETS, type ApiAgentConfig, type ProviderConfig, type ReasoningEffort } from '@shared/apiCollab';
import { relayModels, modeForModel } from '@shared/relayModels';
import { AgentAvatar, agentStyle, CHARACTER_LABELS } from './AgentAvatar';
import { useAvatarUrl } from './AgentVisuals';
import { AgentApiModePicker } from './AgentApiModePicker';
import { Icon, IconButton } from './NextChat';

export function AgentManager({ projectId, agents, providers, onSaved, onConnections }: {
  projectId: string;
  agents: ApiAgentConfig[];
  providers: ProviderConfig[];
  onSaved: () => Promise<void>;
  onConnections: (providerId: string) => void;
}) {
  const [draft, setDraft] = useState<ApiAgentConfig | null>(agents[0] ?? null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<ApiAgentConfig | null>(null);
  const [showAvatars, setShowAvatars] = useState(false);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelError, setModelError] = useState('');
  const modelRequest = useRef(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const saved = agents.find((agent) => agent.id === draft?.id);
  const photo = useAvatarUrl(draft?.id ?? '');
  const provider = providers.find((item) => item.id === draft?.providerId);
  const models = relayModels(provider, agents, remoteModels);
  if (draft?.model && !models.includes(draft.model)) models.unshift(draft.model);
  useEffect(() => { modelRequest.current++; setRemoteModels([]); setModelError(''); setModelsLoading(false); }, [draft?.providerId, provider?.baseUrl, provider?.defaultModel, JSON.stringify(provider?.models)]);
  const loadModels = async () => {
    if (!provider) return;
    const request = ++modelRequest.current;
    setModelsLoading(true); setModelError('');
    try { const result = await window.cth.apiCollabListModels(provider.id); if (modelRequest.current === request) { setRemoteModels(result); if (!result.length) setModelError('中转站未返回模型；可在中转站配置中添加可选模型。'); } }
    catch (cause) { if (modelRequest.current === request) setModelError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (modelRequest.current === request) setModelsLoading(false); }
  };
  const dirty = Boolean(draft && JSON.stringify(draft) !== JSON.stringify(saved));
  const filtered = agents.filter((agent) => agent.displayName.toLowerCase().includes(query.trim().toLowerCase()));
  const patch = (value: Partial<ApiAgentConfig>) => setDraft((current) => current ? { ...current, ...value } : current);
  const choose = (next: ApiAgentConfig) => {
    if (saving) return;
    if (next.id === draft?.id) return;
    if (dirty && next.id !== draft?.id) { setPendingSelection(next); return; }
    setDraft(next); setPendingSelection(null); setError(''); setNotice(''); setConfirmDelete(false); setShowAvatars(false);
  };
  const create = () => choose({ id: `agent-${crypto.randomUUID()}`, displayName: '', providerId: '',
    enabled: true, apiMode: 'agent', permissionProfile: 'assistant', reasoningEffort: 'default' });
  const save = async (switchTo?: ApiAgentConfig) => {
    if (!draft || saving) return;
    if (!draft.displayName.trim()) { setError('请输入智能体名称'); nameRef.current?.focus(); return; }
    if (!draft.providerId) { setError('请先配置中转站，再为智能体选择连接'); return; }
    if (!draft.model?.trim() && !saved) { setError('请从所选中转站的模型列表中选择一个模型'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const next = { ...draft, displayName: draft.displayName.trim(), model: draft.model?.trim() || undefined };
      const updated = await window.cth.apiCollabSaveAgent(next, projectId);
      setDraft(updated.find((agent) => agent.id === next.id) ?? next); await onSaved();
      if (switchTo) { setDraft(updated.find((agent) => agent.id === switchTo.id) ?? switchTo); setPendingSelection(null); setShowAvatars(false); }
      setPendingSelection(null);
      setNotice(switchTo ? '已保存，并切换到所选智能体' : saved ? '智能体配置已保存' : '智能体已创建，可以开始聊天');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!draft || !saved) return;
    setSaving(true); setError('');
    try {
      const next = await window.cth.apiCollabDeleteAgent(draft.id, projectId);
      setDraft(next[0] ?? null); setConfirmDelete(false); await onSaved();
      setNotice('智能体已删除，聊天记录和私人文件已保留');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const uploadAvatar = async () => {
    if (!saved) return;
    setSaving(true); setError('');
    try {
      if (await window.cth.apiCollabChooseAgentAvatar(projectId, saved.id)) {
        patch({ avatarPreset: 'custom' }); await onSaved(); setNotice('自定义头像已保存，仅用于当前项目；其他配置仍按保存按钮提交');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };

  return <div className="tz-agent-manager">
    <div className="tz-agent-heading"><div><h2>智能体管理 <span>{agents.length}</span></h2><p>选择一位伙伴进行编辑，职责由你在聊天中安排。</p></div>
      <IconButton text="新建智能体" type="primary" onClick={create} disabled={saving} /></div>
    <div className="tz-agent-layout">
      <aside className="tz-agent-directory" aria-label="智能体列表">
        <div className="tz-agent-search"><Icon name="search" /><input aria-label="搜索智能体" name="agent-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索智能体…" autoComplete="off" /></div>
        <div className="tz-agent-rows">
          {filtered.map((agent) => <button type="button" key={agent.id} className="tz-agent-row" aria-label={'编辑 ' + agent.displayName} aria-pressed={draft?.id === agent.id} disabled={saving} onClick={() => choose(agent)} style={agentStyle(agent.id)}>
            <AgentAvatar id={agent.id} /><span className="tz-agent-row-copy"><strong>{agent.displayName}</strong><small>{providers.find((provider) => provider.id === agent.providerId)?.name ?? '未配置连接'}</small></span>
            <span className="tz-agent-status" data-enabled={agent.enabled}>{agent.enabled ? '启用' : '停用'}</span>
          </button>)}
          {!filtered.length && <p className="tz-agent-empty">{agents.length ? '没有找到匹配的智能体' : '还没有智能体。点击“新建智能体”添加第一位伙伴。'}</p>}
        </div>
        <div className="tz-agent-directory-note">智能体仅属于当前项目<br />私人记忆互不共享</div>
      </aside>
      <section className="tz-agent-editor" aria-label="智能体编辑器" aria-busy={saving}>
        {draft ? <>
          <div className="tz-agent-editor-header"><div className="tz-agent-identity"><button type="button" className="tz-agent-avatar-trigger" aria-label="选择智能体头像" aria-expanded={showAvatars} disabled={saving} onClick={() => setShowAvatars(!showAvatars)}><AgentAvatar id={draft.id} preset={draft.avatarPreset} /><small>换头像</small></button><div><h3>{saved ? saved.displayName : '新建智能体'}</h3><span>{dirty ? '有未保存的更改' : '配置已保存'}</span></div></div>
            <div className="tz-agent-editor-actions">{saved && <button type="button" className="tz-agent-delete" disabled={saving} onClick={() => { setConfirmDelete(true); setError(''); }}>删除智能体</button>}
              <IconButton className="tz-agent-save" text={saving ? '正在保存…' : saved ? '保存更改' : '创建智能体'} type="primary" disabled={saving} onClick={() => void save()} /></div>
          </div>
          {pendingSelection && <div className="tz-agent-warning" role="alert"><strong>当前配置还未保存</strong><p>可以先保存，再切换到另一位智能体。</p><div><button type="button" className="tz-save-switch" disabled={saving} onClick={() => void save(pendingSelection)}>保存并切换</button><button type="button" disabled={saving} onClick={() => { setDraft(pendingSelection); setPendingSelection(null); setConfirmDelete(false); setShowAvatars(false); setError(''); setNotice(''); }}>放弃修改并切换</button><button type="button" disabled={saving} onClick={() => setPendingSelection(null)}>继续编辑</button></div></div>}
          {confirmDelete && <div className="tz-agent-warning" role="alert"><strong>删除“{saved?.displayName}”？</strong><p>只移除当前项目中的智能体配置和群成员身份；已有聊天、私人文件和中转站密钥保留。</p><div><button type="button" className="tz-agent-delete" disabled={saving} onClick={() => void remove()}>确认删除</button><button type="button" disabled={saving} onClick={() => setConfirmDelete(false)}>取消</button></div></div>}
          {error && <p className="tz-agent-feedback nc-error" role="alert">{error}</p>}
          {notice && <p className="tz-agent-feedback" role="status">{notice}</p>}
          <form className="tz-agent-fields" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <fieldset disabled={saving}>
              {showAvatars && <section className="tz-avatar-picker" aria-label="智能体头像"><div><strong>选择系统小人</strong><button type="button" aria-label="收起头像选择" onClick={() => setShowAvatars(false)}>完成</button></div><div className="tz-avatar-choices">{AVATAR_PRESETS.map((preset, index) => <button type="button" key={preset} aria-label={'头像：' + CHARACTER_LABELS[index]} aria-pressed={draft.avatarPreset === preset} onClick={() => patch({ avatarPreset: preset })}><AgentAvatar id={draft.id} preset={preset} /><span>{CHARACTER_LABELS[index]}</span></button>)}</div><div className="tz-avatar-actions"><button type="button" onClick={() => patch({ avatarPreset: 'auto' })}>系统默认</button><button type="button" disabled={!saved} onClick={() => void uploadAvatar()}>上传头像</button>{photo && <button type="button" onClick={() => patch({ avatarPreset: 'custom' })}>使用已上传图片</button>}</div><p>系统头像随配置保存，仅用于当前项目。{saved ? '上传图片会立即保存；支持 PNG / JPEG / WebP，最大 10 MB。' : '创建智能体后即可上传自定义图片。'}</p></section>}
              <div className="tz-agent-field-grid">
                <label className="tz-agent-field">智能体名称<input ref={nameRef} name="agent-name" aria-label="智能体名称" value={draft.displayName} onChange={(event) => patch({ displayName: event.target.value })} placeholder="例如：研究助理…" maxLength={80} autoComplete="off" /></label>
                <label className="tz-agent-field">中转站<select name="agent-provider" aria-label="智能体中转站" value={draft.providerId} onChange={(event) => patch({ providerId: event.target.value, model: undefined, apiMode: 'agent' })}><option value="">请选择已保存的中转站</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
                <div className="tz-agent-field"><label htmlFor="agent-model-select">模型</label><select id="agent-model-select" aria-label="智能体模型" value={draft.model ?? ''} disabled={!provider} onChange={(event) => patch({ model: event.target.value || undefined, apiMode: modeForModel(event.target.value, draft.apiMode) })}><option value="">{saved && provider?.defaultModel ? '旧配置使用中转站默认：' + provider.defaultModel : '请选择模型'}</option>{models.map((model) => <option key={model} value={model}>{model}{modeForModel(model) === 'image' ? ' · 生图' : ''}</option>)}</select><div className="tz-agent-model-tools"><span>使用所选中转站的模型名称</span><button type="button" disabled={!provider || modelsLoading} onClick={() => void loadModels()}>{modelsLoading ? '读取中…' : '读取模型列表'}</button></div>{modelError && <small role="status" className="nc-error">{modelError}</small>}<details className="tz-model-manual"><summary>列表没有？手动填写</summary><input name="agent-model" aria-label="智能体模型 ID" value={draft.model ?? ''} onChange={(event) => patch({ model: event.target.value, apiMode: modeForModel(event.target.value, draft.apiMode) })} placeholder="填写中转站支持的准确模型名称" autoComplete="off" spellCheck={false} /></details></div>
                <label className="tz-agent-field">推理强度<select name="agent-effort" aria-label="智能体推理强度" value={draft.reasoningEffort ?? 'default'} onChange={(event) => patch({ reasoningEffort: event.target.value as ReasoningEffort })}><option value="default">默认</option><option value="minimal">最少</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="xhigh">极高</option><option value="max">最大</option></select></label>
              </div>
              <div className="tz-agent-connection-note"><span>接口地址与 API Key 在中转站中保存。</span><button type="button" onClick={() => { if (dirty) { setError('请先保存当前智能体配置，再编辑连接与密钥'); return; } onConnections(draft.providerId); }}>编辑连接与密钥</button></div>
              <label className="tz-agent-enable"><input type="checkbox" checked={draft.enabled} onChange={(event) => patch({ enabled: event.target.checked })} /><span>启用此智能体<small>启用后可在项目中聊天和接收任务</small></span></label>
              <details className="tz-agent-advanced"><summary>高级设置<span>权限、运行配置与系统提示词</span></summary>
                <label className="tz-agent-field">权限类型<select name="agent-permission" aria-label="智能体权限类型" value={draft.permissionProfile ?? 'assistant'} onChange={(event) => patch({ permissionProfile: event.target.value as ApiAgentConfig['permissionProfile'] })}><option value="assistant">协作型 · 只读汇报</option><option value="worker">执行型 · 工作区产出</option><option value="checker">检查型 · 只读验收</option></select></label>
                <AgentApiModePicker model={draft.model || providers.find((provider) => provider.id === draft.providerId)?.defaultModel || ''} value={draft.apiMode} onChange={(apiMode) => patch({ apiMode })} />
                <label className="tz-agent-field">系统提示词<textarea name="agent-prompt" aria-label="智能体系统提示词" value={draft.systemPrompt ?? ''} onChange={(event) => patch({ systemPrompt: event.target.value })} placeholder="可选：定义回答方式与证据要求；本轮职责由你在聊天中指定…" rows={4} /></label>
              </details>
            </fieldset>
          </form>
        </> : <div className="tz-agent-empty tz-agent-empty-editor"><Icon name="add" /><h3>添加你的第一位智能体</h3><p>点击右上角“新建智能体”，选择连接和模型。</p>{notice && <p role="status">{notice}</p>}</div>}
      </section>
    </div>
  </div>;
}
