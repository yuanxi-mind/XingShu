import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AgentVisuals, ApiAgentConfig, AvatarPreset } from '@shared/apiCollab';

const AvatarContext = createContext<Record<string, string>>({});
const PresetContext = createContext<Record<string, AvatarPreset | undefined>>({});
export function useAvatarUrl(id: string): string | undefined { return useContext(AvatarContext)[id]; }
export function useAvatarPreset(id: string): AvatarPreset | undefined { return useContext(PresetContext)[id]; }

export function useLocalImage(root: string, path?: string): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    let created = '';
    setUrl('');
    if (path) void window.cth.readBinary(root, path).then((result) => {
      if (!active || !result.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(result.mime)) return;
      created = URL.createObjectURL(new Blob([result.bytes], { type: result.mime })); setUrl(created);
    }).catch(() => {});
    return () => { active = false; if (created) URL.revokeObjectURL(created); };
  }, [root, path]);
  return url;
}

export function AgentVisualProvider({ root, visuals, agents = [], children }: { root: string; visuals?: AgentVisuals; agents?: ApiAgentConfig[]; children: ReactNode }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = JSON.stringify(visuals?.avatars ?? {});
  useEffect(() => {
    let active = true;
    const created: string[] = [];
    const entries = Object.entries(JSON.parse(key) as Record<string, string>);
    void Promise.all(entries.map(async ([id, path]) => {
      try {
        const result = await window.cth.readBinary(root, path);
        if (!active || !result.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(result.mime)) return null;
        const url = URL.createObjectURL(new Blob([result.bytes], { type: result.mime })); created.push(url); return [id, url] as const;
      } catch { return null; }
    })).then((results) => { if (active) setUrls(Object.fromEntries(results.filter((result) => result !== null))); });
    return () => { active = false; for (const url of created) URL.revokeObjectURL(url); };
  }, [root, key]);
  return <PresetContext.Provider value={Object.fromEntries(agents.map((agent) => [agent.id, agent.avatarPreset]))}><AvatarContext.Provider value={urls}>{children}</AvatarContext.Provider></PresetContext.Provider>;
}
