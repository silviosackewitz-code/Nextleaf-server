export const sidebarPreferencesKey = 'nextleaf_sidebar';
export const optionalViews = ['focus', 'next', 'waiting', 'scheduled', 'someday', 'later', 'review'] as const;
export type SidebarPreferences = { hiddenViews: string[]; perspectiveIds: string[] };

export function readSidebarPreferences(raw: string | null): SidebarPreferences {
  let value;
  try { value = JSON.parse(raw ?? 'null'); } catch { /* Use defaults for invalid storage. */ }
  const strings = (items: unknown): string[] => Array.isArray(items) ? [...new Set(items.filter((v): v is string => typeof v === 'string' && v.length > 0))] : [];
  return {
    hiddenViews: strings(value?.hiddenViews).filter(v => optionalViews.some(view => view === v)),
    perspectiveIds: strings(value?.perspectiveIds),
  };
}
export function loadSidebarPreferences(): SidebarPreferences {
  try { return readSidebarPreferences(localStorage.getItem(sidebarPreferencesKey)); }
  catch { return readSidebarPreferences(null); }
}
