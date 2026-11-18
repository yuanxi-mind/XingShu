import { useState, type CSSProperties } from 'react';
import { AVATAR_PRESETS, type AvatarPreset } from '@shared/apiCollab';
import { useAvatarUrl, useAvatarPreset } from './AgentVisuals';
import gptCharacter from './assets/characters/gpt.png';
import claudeCharacter from './assets/characters/claude.png';
import deepseekCharacter from './assets/characters/deepseek.png';
import geminiCharacter from './assets/characters/gemini.png';
import grokCharacter from './assets/characters/grok.png';
import companionCharacter from './assets/characters/companion.png';
import gptCompanion from './assets/characters/companion-gpt.png';
import claudeCompanion from './assets/characters/companion-claude.png';
import deepseekCompanion from './assets/characters/companion-deepseek.png';
import grokCompanion from './assets/characters/companion-grok.png';

const characters = [gptCharacter, claudeCharacter, deepseekCharacter, geminiCharacter, grokCharacter];
export const CHARACTER_LABELS = ['白龙', '橙橙', '小鲸', '星喵', '小夜'];
const companions = [gptCompanion, claudeCompanion, deepseekCompanion, companionCharacter, grokCompanion];

const colors = [
  ['#8bd6bd', '#e1f4ee', '#2b7e66'],
  ['#edaf91', '#faeee5', '#a25b3d'],
  ['#8ab9ff', '#eaf0ff', '#3c6baf'],
  ['#b9a0fa', '#f1edfc', '#7852ac'],
  ['#d6b575', '#f8f1df', '#7c6337'],
  ['#9aadb9', '#eef3f6', '#4d6473'],
];

function avatarIndex(id: string): number {
  const known = ['gpt', 'claude', 'deepseek', 'gemini', 'grok', 'human'].indexOf(id.toLowerCase());
  if (known >= 0) return known;
  const family = ['gpt', 'claude', 'deepseek', 'gemini', 'grok'].findIndex((name) => id.toLowerCase().split(/[-_:]/u).includes(name));
  if (family >= 0) return family;
  return [...id].reduce((value, character) => value + character.charCodeAt(0), 0) % 5;
}

export function agentStyle(id: string): CSSProperties {
  const [accent, tint, ink] = colors[avatarIndex(id)];
  return { '--agent-accent': accent, '--agent-tint': tint, '--agent-ink': ink } as CSSProperties;
}

export function AgentAvatar({ id, preset, animated = false, className = '' }: { id: string; preset?: AvatarPreset; animated?: boolean; className?: string }) {
  const configured = useAvatarPreset(id);
  const selected = preset ?? configured;
  const savedPhoto = useAvatarUrl(id);
  const photo = !selected || selected === 'custom' ? savedPhoto : undefined;
  const index = selected && AVATAR_PRESETS.includes(selected as typeof AVATAR_PRESETS[number]) ? AVATAR_PRESETS.indexOf(selected as typeof AVATAR_PRESETS[number]) : avatarIndex(id);
  const group = id === 'workgroup';
  return <span className={['tz-avatar', photo ? 'tz-avatar-photo' : group ? 'tz-avatar-group' : id === 'human' ? 'tz-avatar-human' : 'tz-avatar-character', animated && !photo ? 'tz-avatar-animated' : '', className].filter(Boolean).join(' ')} style={agentStyle(id)} aria-hidden="true">
    {photo ? <img src={photo} alt="" /> : id === 'human' ? <svg viewBox="0 0 48 48" fill="none"><path d="M10 47c1-13 7-17 14-17s13 4 14 17" fill="#8993c7" /><path d="M18 29v7c4 4 8 4 12 0v-7" fill="#efc5ad" /><ellipse cx="24" cy="21" rx="11" ry="13" fill="#ffe1c9" /><path d="M13 23C7 5 25 2 34 12c2 2 2 8 1 11l-4-9c-2 3-8 4-13 3l-5 6Z" fill="#4a3d4a" /><circle cx="20" cy="23" r="1.1" fill="#4a3d4a" /><circle cx="28" cy="23" r="1.1" fill="#4a3d4a" /><path d="M21 28q3 3 6 0" stroke="#a77569" strokeWidth="1.4" strokeLinecap="round" /></svg> : group ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><path d="m17.5 13 4.5 4.5-4.5 4.5-4.5-4.5z" /></svg> : <img src={characters[index]} alt="" draggable={false} />}
  </span>;
}

export function WorkspaceCompanion({ projectId }: { projectId: string }) {
  const key = 'xingshu-companion:' + (projectId || 'home');
  const [index, setIndex] = useState(() => { const saved = Number(localStorage.getItem(key) ?? 3); return Number.isInteger(saved) && saved >= 0 && saved < companions.length ? saved : 3; });
  return <button type="button" className="tz-companion" title="点击切换小伙伴；仅为装饰" aria-label={'切换小伙伴，当前：' + CHARACTER_LABELS[index]} onClick={() => { const next = (index + 1) % companions.length; localStorage.setItem(key, String(next)); setIndex(next); }}><img src={companions[index]} alt={CHARACTER_LABELS[index]} draggable={false} /><div><strong>让好想法慢慢发光。</strong><span>{CHARACTER_LABELS[index]} · 点击换一位</span></div></button>;
}
