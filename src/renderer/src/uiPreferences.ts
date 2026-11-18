export interface Appearance {
  designVersion?: 2;
  theme: 'dark' | 'light';
  background: 'aurora' | 'grid' | 'plain';
  font: 'system' | 'heiti' | 'songti' | 'mono';
  fontSize: number;
  backgroundColor: string;
}

export const UI_FONT = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
export const CHAT_FONTS: Record<Appearance['font'], string> = {
  system: UI_FONT,
  heiti: '"DengXian", "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", sans-serif',
  songti: '"SimSun", "Songti SC", "Noto Serif SC", serif',
  mono: '"Sarasa Mono SC", "Microsoft YaHei UI", "Microsoft YaHei", monospace'
};

const BACKGROUNDS = { light: '#faf9fe', dark: '#161c30' };
export const DEFAULT_APPEARANCE: Appearance = { designVersion: 2, theme: 'light', background: 'aurora', font: 'system', fontSize: 16, backgroundColor: BACKGROUNDS.light };

export function appearanceForTheme(value: Appearance, theme: Appearance['theme']): Appearance {
  const isDefaultBackground = Object.values(BACKGROUNDS).includes(value.backgroundColor);
  return { ...value, designVersion: 2, theme, backgroundColor: isDefaultBackground ? BACKGROUNDS[theme] : value.backgroundColor };
}

export function projectUiKey(name: string, projectId: string): string { return projectId ? `${name}:project:${projectId}` : name; }

export function readAppearance(key = 'tongzhou-appearance'): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    const currentDesign = saved.designVersion === 2;
    const theme = currentDesign && saved.theme === 'dark' ? 'dark' : 'light';
    const oldDefault = !currentDesign && ['#121416', '#0b0d14'].includes(saved.backgroundColor);
    return {
      designVersion: 2,
      theme,
      background: ['aurora', 'grid', 'plain'].includes(saved.background) ? saved.background : DEFAULT_APPEARANCE.background,
      font: ['system', 'heiti', 'songti', 'mono'].includes(saved.font) ? saved.font : DEFAULT_APPEARANCE.font,
      fontSize: Number.isFinite(saved.fontSize) ? Math.max(12, Math.min(24, saved.fontSize)) : DEFAULT_APPEARANCE.fontSize,
      backgroundColor: !oldDefault && /^#[\da-f]{6}$/i.test(saved.backgroundColor) ? saved.backgroundColor : BACKGROUNDS[theme]
    };
  } catch { return { ...DEFAULT_APPEARANCE }; }
}
