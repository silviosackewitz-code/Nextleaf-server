export const themes = ['dark', 'industrial', 'terminal', 'cappuccino'] as const;
export const fonts = ['plex', 'jetbrains'] as const;
export type Appearance = { theme: typeof themes[number]; font: typeof fonts[number] };
export const appearanceKey = 'nextleaf_appearance';

export function readAppearance(raw: string | null): Appearance {
  let value;
  try { value = JSON.parse(raw ?? 'null'); } catch { /* Invalid preferences use defaults. */ }
  return {
    theme: themes.includes(value?.theme) ? value.theme : 'dark',
    font: value?.font === 'cascadia' ? 'jetbrains' : fonts.includes(value?.font) ? value.font : 'plex',
  };
}

export function loadAppearance(): Appearance {
  try { return readAppearance(localStorage.getItem(appearanceKey)); }
  catch { return readAppearance(null); }
}

export function applyAppearance(value: Appearance) {
  document.documentElement.dataset.theme = value.theme;
  document.documentElement.dataset.font = value.font;
}
