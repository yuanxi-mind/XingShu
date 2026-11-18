// Adapted from NextChat 1d3dc33 (MIT). See vendor/nextchat/NOTICE.md.
import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { m, useReducedMotion } from 'framer-motion';
import type { ApiAgentConfig, CollabMessage } from '@shared/apiCollab';
import { AgentAvatar, agentStyle } from './AgentAvatar';
import button from './vendor/nextchat/components/button.module.scss';
import chat from './vendor/nextchat/components/chat.module.scss';
import ui from './vendor/nextchat/components/ui-lib.module.scss';

const icons = import.meta.glob('./vendor/nextchat/icons/*.svg', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

const symbols: Record<string, ReactNode> = {
  add: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  discovery: <><rect x="3" y="5" width="18" height="15" rx="2.5" /><path d="M3 9h18M8 5V3m8 2V3" /></>,
  settings: <><path d="m9.5 3-.6 2.3-2 .9-2.1-.7L2.5 9l1.6 1.7v2.6L2.5 15l2.3 3.5 2.1-.7 2 .9.6 2.3h5l.6-2.3 2-.9 2.1.7 2.3-3.5-1.6-1.7v-2.6L21.5 9l-2.3-3.5-2.1.7-2-.9-.6-2.3z" /><circle cx="12" cy="12" r="3" /></>,
  robot: <><path d="M12 3v3M8 21v-2m8 2v-2M3 10v5m18-5v5" /><rect x="5" y="6" width="14" height="13" rx="4" /><path d="M9 11v2m6-2v2m-5 3h4" /></>,
  github: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
  reload: <><path d="M20 10a8 8 0 0 0-13.5-4L3 9m0-5v5h5M4 14a8 8 0 0 0 13.5 4L21 15m0 5v-5h-5" /></>,
  rename: <><path d="m15 4 5 5M4 20l5-1 12-12-5-5L4 14z" /></>,
  share: <><path d="M12 15V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></>,
  export: <><path d="M13 4h7v7m0-7L10 14M9 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4" /></>,
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  max: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
  min: <path d="M3 9h6V3m6 0v6h6M9 21v-6H3m12 6v-6h6" />,
  'chat-settings': <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="8" cy="18" r="2" /></>,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  plugin: <><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="m8 9 1 1 2-2m2 1h3m-8 6 1 1 2-2m2 1h3" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 3-3 6 6" /></>,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  'send-white': <path d="M12 20V4m-6 6 6-6 6 6" />,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5a9 9 0 0 1 18 0Z" />,
  members: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v2" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  drag: <><path d="M8 7h.01M16 7h.01M8 12h.01M16 12h.01M8 17h.01M16 17h.01" /></>,
};

export function Icon({ name }: { name: string }) {
  if (symbols[name]) return <span className="nc-icon" aria-hidden="true"><svg className="nc-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{symbols[name]}</svg></span>;
  // Only bundled, pinned upstream SVGs enter this HTML sink; never message content.
  return <span className="nc-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons['./vendor/nextchat/icons/' + name + '.svg'] ?? '' }} />;
}

export function ToolMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false; };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return <details ref={ref} className="tz-tool-menu" onKeyDown={(event) => { if (event.key === 'Escape' && ref.current?.open) { event.preventDefault(); ref.current.open = false; ref.current.querySelector('summary')?.focus(); } }}>
    <summary aria-label="更多会话操作" title="更多会话操作"><Icon name="more" /></summary>
    <div className="tz-tool-menu-panel" role="group" aria-label="会话工具" onClick={(event) => { if ((event.target as HTMLElement).closest('button') && ref.current) ref.current.open = false; }}>{children}</div>
  </details>;
}

export function IconButton(props: {
  onClick?: () => void; icon?: string; type?: 'primary' | 'danger'; text?: string;
  bordered?: boolean; shadow?: boolean; className?: string; title?: string;
  disabled?: boolean; style?: CSSProperties; buttonType?: 'button' | 'submit';
}) {
  return <button type={props.buttonType ?? 'button'}
    className={['clickable', button['icon-button'], props.bordered && button.border, props.shadow && button.shadow, props.type && button[props.type], props.className].filter(Boolean).join(' ')}
    onClick={props.onClick} title={props.title} disabled={props.disabled} style={props.style} aria-label={props.title ?? props.text}>
    {props.icon && <div className={[button['icon-button-icon'], props.type === 'primary' && 'no-dark'].filter(Boolean).join(' ')}><Icon name={props.icon} /></div>}
    {props.text && <div className={button['icon-button-text']}>{props.text}</div>}
  </button>;
}

export function ChatAction({ icon, text, onClick, disabled }: { icon: string; text: string; onClick: () => void; disabled?: boolean }) {
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({ full: 16, icon: 16 });
  const updateWidth = () => {
    if (!iconRef.current || !textRef.current) return;
    const iconWidth = iconRef.current.getBoundingClientRect().width;
    setWidth({ full: iconWidth + textRef.current.getBoundingClientRect().width, icon: iconWidth });
  };
  const activate = () => { if (!disabled) onClick(); };
  return <div role="button" tabIndex={disabled ? -1 : 0} className={chat['chat-input-action'] + ' clickable'} title={text} aria-label={text} aria-disabled={disabled || undefined}
    onClick={activate} onMouseEnter={updateWidth} onTouchStart={updateWidth}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } }}
    style={{ '--icon-width': width.icon + 'px', '--full-width': width.full + 'px' } as CSSProperties}>
    <div ref={iconRef} className={chat.icon}><Icon name={icon} /></div><div ref={textRef} className={chat.text}>{text}</div>
  </div>;
}

export function List({ children }: { children: ReactNode }) { return <div className={ui.list + ' nc-list'}>{children}</div>; }

export function ListItem({ title, subTitle, children }: { title: string; subTitle?: string; children: ReactNode }) {
  const generatedId = useId();
  const elements = Children.toArray(children);
  const control = elements.find((item) => isValidElement<{ id?: string }>(item) && typeof item.type === 'string' && ['input', 'select', 'textarea'].includes(item.type));
  const inputId = isValidElement<{ id?: string }>(control) ? control.props.id ?? generatedId : undefined;
  return <div className={ui['list-item'] + ' nc-list-item'}><div className={ui['list-header'] + ' nc-list-header'}><div>
    <div className={ui['list-item-title'] + ' nc-list-title'}><label htmlFor={inputId}>{title}</label></div>{subTitle && <div className={ui['list-item-sub-title'] + ' nc-list-subtitle'}>{subTitle}</div>}
  </div></div>{elements.map((item) => item === control && isValidElement<{ id?: string }>(item) ? cloneElement(item, { id: inputId }) : item)}</div>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const reducedMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab' || !dialog) return;
      const fields = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter((field) => field.offsetParent !== null);
      const first = fields[0]; const last = fields.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className="modal-mask" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <m.div initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.18 }} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={ui['modal-container'] + ' nc-dialog'}>
      <div className={ui['modal-header'] + ' nc-dialog-header'}><div className={ui['modal-title'] + ' nc-dialog-title'}>{title}</div><IconButton icon="close" title="关闭" onClick={onClose} /></div>
      <div className={ui['modal-content'] + ' nc-dialog-content'}>{children}</div>
    </m.div>
  </div>;
}

function GeneratedImage({ path, projectRoot, onSetBackground }: { path: string; projectRoot: string; onSetBackground?: (path: string) => Promise<void> }) {
  const [resource, setResource] = useState<{ url: string; file: string } | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    let url = '';
    setResource(null); setError('');
    void window.cth.readBinary(projectRoot, path).then((result) => {
      if (!active) return;
      if (!result.ok) { setError('图片读取失败：' + result.error); return; }
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(result.mime)) { setError('图片格式不支持'); return; }
      url = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }));
      setResource({ url, file: result.path });
    }).catch((cause) => { if (active) setError('图片读取失败：' + String(cause)); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [projectRoot, path]);
  return <figure className="tz-generated-image">
    <button className="tz-image-thumbnail" title="点击放大" aria-label="放大生成图片" disabled={!resource || Boolean(error)} onClick={() => setExpanded(true)}>
      {error ? <span role="alert">{error}</span> : resource ? <img src={resource.url} alt="生成图片" onError={() => setError('图片无法解码，请检查中转返回的文件')} /> : <span>正在读取本地图片…</span>}
    </button>
    {resource && <figcaption><span>图片已保存到当前项目</span>{onSetBackground && <IconButton icon="image" text="设为当前聊天背景" disabled={applying || Boolean(error)} onClick={() => { setApplying(true); setNotice(''); void onSetBackground(path).then(() => setNotice('已设为当前聊天背景')).catch((cause) => setError(String(cause))).finally(() => setApplying(false)); }} />}<IconButton icon="export" text="打开图片所在文件夹" onClick={() => { void window.cth.revealPath(resource.file).then((result) => { if (!result.ok) setError(result.error ?? '打开文件夹失败'); }).catch((cause) => setError(String(cause))); }} /></figcaption>}
    {notice && <p className="tz-background-notice" role="status">{notice}</p>}
    {expanded && resource && <Modal title="生成图片" onClose={() => setExpanded(false)}><img className="tz-image-full" src={resource.url} alt="生成图片大图" /></Modal>}
  </figure>;
}

export function MessageBubble({ message, agents, projectRoot, onOpenImageStudio, onSetBackground, preset = false, delivery, streaming = false }: { message: CollabMessage; agents: ApiAgentConfig[]; projectRoot?: string; onOpenImageStudio?: () => void; onSetBackground?: (path: string) => Promise<void>; preset?: boolean; delivery?: string; streaming?: boolean }) {
  const human = message.senderId === 'human';
  const name = human ? '你' : agents.find((agent) => agent.id === message.senderId)?.displayName ?? (message.senderId === 'assistant' ? '助手' : message.senderId);
  const content = message.status === 'error' ? '错误：' + (message.error ?? '请求失败') : message.content;
  return <div data-state={streaming ? 'streaming' : message.status === 'error' ? 'error' : 'complete'} className={'tz-message ' + (human ? 'tz-message-human ' + chat['chat-message-user'] : chat['chat-message'])} style={agentStyle(message.senderId)}>
    <div className={chat['chat-message-container']}>
      <div className={chat['chat-message-header'] + ' tz-message-header'}>
        <AgentAvatar id={message.senderId} />
        <span className="tz-message-name">{name}</span>
        {message.generatedByAgentId && <small className="tz-message-time">由{agents.find((agent) => agent.id === message.generatedByAgentId)?.displayName || '生图助手'}生成</small>}
        {message.createdAt && <time className="tz-message-time" dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>}
        {!preset && <div className={chat['chat-message-actions']}><div className={chat['chat-input-actions']}><ChatAction icon="copy" text="复制消息" onClick={() => { void navigator.clipboard.writeText(content); }} /></div></div>}
      </div>
      <div className={chat['chat-message-item'] + ' tz-message-content'}><div className="markdown-body">
        {streaming ? <div className="tz-stream-text">{content.slice(0, -12)}<span key={content.length} className="tz-stream-tail">{content.slice(-12)}</span><i className="tz-stream-caret" /></div> : <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} skipHtml components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> }}>{content}</ReactMarkdown>}
      </div>{message.imageJobId && !message.images?.length && onOpenImageStudio && <IconButton text="查看生图申请" bordered onClick={onOpenImageStudio} />}{message.status !== 'error' && projectRoot && message.images?.map((image) => <GeneratedImage key={image.path} path={image.path} projectRoot={projectRoot} onSetBackground={onSetBackground} />)}</div>
      {human && <span className={'tz-delivery' + (delivery?.startsWith('未发送') ? ' tz-delivery-failed' : '')}>{delivery ?? '✓ 已发送'}</span>}
    </div>
  </div>;
}
