import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ApiAgentConfig } from '@shared/apiCollab';

interface Props {
  agents: ApiAgentConfig[];
  all: boolean;
  selected: string[];
  onChange(all: boolean, ids: string[]): void;
  onOrder(): void;
}

export function MentionPicker({ agents, all, selected, onChange, onOrder }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, bottom: 0 });
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout>>();
  const cancelClose = () => clearTimeout(closing.current);
  const show = () => {
    cancelClose();
    const bounds = anchor.current?.getBoundingClientRect();
    if (bounds) setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 280)), bottom: window.innerHeight - bounds.top + 7 });
    setOpen(true);
  };
  const hideSoon = () => { cancelClose(); closing.current = setTimeout(() => setOpen(false), 180); };
  useEffect(() => () => clearTimeout(closing.current), []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { cancelClose(); anchor.current?.focus(); setOpen(false); } };
    const reposition = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', reposition);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', reposition); };
  }, [open]);
  const enabled = agents.filter((agent) => agent.enabled).map((agent) => agent.id);
  const toggle = (id: string) => {
    const current = all ? enabled : selected;
    onChange(false, current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };
  const summary = all ? '@全体' : agents.filter((agent) => selected.includes(agent.id)).map((agent) => '@' + agent.displayName).join('、');
  return <>
    <button ref={anchor} className="tz-mention-trigger" aria-label="选择发言对象" aria-expanded={open} aria-controls={open ? 'tz-mention-options' : undefined}
      onMouseEnter={show} onMouseLeave={hideSoon} onFocus={show} onBlur={(event) => { if (!panel.current?.contains(event.relatedTarget as Node)) hideSoon(); }}
      onClick={show} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); show(); requestAnimationFrame(() => panel.current?.querySelector('input')?.focus()); } }}>
      <span aria-hidden="true">＠</span> 发言对象{summary && <small title={summary}>{summary}</small>}<span aria-hidden="true">⌃</span>
    </button>
    {open && createPortal(<div id="tz-mention-options" ref={panel} className="tz-mention-popover" role="group" aria-label="发言对象快捷选择" style={position}
      onMouseEnter={cancelClose} onMouseLeave={hideSoon} onFocus={cancelClose} onBlur={(event) => { if (!panel.current?.contains(event.relatedTarget as Node) && event.relatedTarget !== anchor.current) hideSoon(); }}>
      <div className="tz-mention-heading">本轮邀请谁发言？<span>可多选</span></div>
      <div className="tz-mention-options">
        <label><input type="checkbox" aria-label="@全体" checked={all} disabled={!enabled.length} onChange={() => onChange(!all, [])} /><strong>@全体</strong><small>{enabled.length} 位已启用</small></label>
        {agents.map((agent) => <label key={agent.id} aria-disabled={!agent.enabled}><input type="checkbox" aria-label={'@' + agent.displayName} checked={agent.enabled && (all || selected.includes(agent.id))} disabled={!agent.enabled} onChange={() => toggle(agent.id)} /><span>@{agent.displayName}</span>{!agent.enabled && <small>未启用</small>}</label>)}
      </div>
      <div className="tz-mention-footer"><button onClick={() => { setOpen(false); onOrder(); }}>顺序与职责 <span>↗</span></button><button onClick={() => { onChange(false, []); }}>清空</button></div>
      <p>选好后直接发送；仅选中的伙伴回复。</p>
    </div>, document.querySelector('.tz-app') || document.body)}
  </>;
}
