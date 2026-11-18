import { useState } from 'react';
import { IconButton } from './NextChat';

export function ChatBackgroundPanel({ projectId, conversationId, title, imageUrl, onSaved }: { projectId: string; conversationId: string; title: string; imageUrl: string; onSaved: () => Promise<void> }) {
  const [path, setPath] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const run = async (action: () => Promise<boolean | void>, success: string): Promise<void> => {
    setWorking(true); setError(''); setNotice('');
    try { if (await action() === false) return; await onSaved(); setNotice(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setWorking(false); }
  };
  return <div className="tz-chat-background-panel">
    <p className="tz-dialog-intro">正在设置：<strong>{title}</strong>。只影响当前项目中的这个会话，重新打开后仍然保留。设置已有图片不调用模型，也不产生生图费用。</p>
    {imageUrl ? <img className="tz-background-preview" src={imageUrl} alt="当前聊天背景预览" /> : <div className="tz-background-empty">当前使用主题默认背景</div>}
    <div className="nc-button-row"><IconButton icon="image" text="选择本地图片" bordered disabled={working} onClick={() => void run(() => window.cth.apiCollabChooseChatBackground(projectId, conversationId), '已设置当前聊天背景')} /><IconButton text="恢复默认背景" bordered disabled={working} onClick={() => void run(() => window.cth.apiCollabSetChatBackground(projectId, conversationId, null), '已恢复主题默认背景')} /></div>
    <form className="tz-background-path" onSubmit={(event) => { event.preventDefault(); void run(() => window.cth.apiCollabSetChatBackground(projectId, conversationId, path.trim()), '已设置当前聊天背景'); }}>
      <label htmlFor="tz-background-path">也可以粘贴当前项目中的图片路径</label>
      <input id="tz-background-path" aria-label="项目内图片路径" value={path} onChange={(event) => setPath(event.target.value)} placeholder="WorkGroup/artifacts/images/图片.png" maxLength={4096} disabled={working} />
      <p className="nc-hint">支持 PNG、JPEG、WebP，最大 10 MB。图片会另存至 D 盘，保留原文件和旧版本。</p>
      <IconButton text="使用项目图片" type="primary" buttonType="submit" disabled={working || !path.trim()} />
    </form>
    {working && <p role="status" className="nc-hint">正在保存背景…</p>}
    {notice && <p role="status" className="tz-background-notice">{notice}</p>}
    {error && <p role="alert" className="nc-error">{error}</p>}
  </div>;
}
