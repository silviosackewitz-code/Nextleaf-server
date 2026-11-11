/**
 * The navigation glyphs as one line-icon set: 20px grid, one path each, drawn
 * with the same stroke so they have equal weight and size on every platform.
 */
export const iconPaths = {
  brand: 'M10 3v14M3 10h14M5.05 5.05l9.9 9.9M14.95 5.05l-9.9 9.9',
  inbox: 'M10 3v8M6.5 7.5 10 11l3.5-3.5M4 13v3h12v-3',
  focus: 'M10 2.7l1.94 4.93 5.29.32-4.09 3.37 1.33 5.13L10 13.6l-4.47 2.85 1.33-5.13-4.09-3.37 5.29-.32z',
  next: 'M3.5 10h13M12 5.5l4.5 4.5-4.5 4.5',
  waiting: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM10 6v4h3.5',
  scheduled: 'M4 4h12v12H4zM4 8h12M4 12h12M8 4v12M12 4v12',
  someday: 'M10 3l7 7-7 7-7-7z',
  later: 'M5 10a.5.5 0 1 0-1 0 .5.5 0 0 0 1 0zM10.5 10a.5.5 0 1 0-1 0 .5.5 0 0 0 1 0zM16 10a.5.5 0 1 0-1 0 .5.5 0 0 0 1 0z',
  review: 'M4 8h10v4.5a3.5 3.5 0 0 1-3.5 3.5h-3A3.5 3.5 0 0 1 4 12.5zM14 9h1.2a2.3 2.3 0 0 1 0 4.6H14M7 3.5v2M10.5 3v2.5',
  completed: 'M4 10.5l4 4 8-9',
  all: 'M4 6h12M4 10h12M4 14h12',
  trash: 'M7 5h9.5v10H7L2.5 10zM10 8l4 4M14 8l-4 4',
  settings: 'M10 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM10 8.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM10 2.5V5M10 15v2.5M2.5 10H5M15 10h2.5M4.7 4.7l1.8 1.8M13.5 13.5l1.8 1.8M4.7 15.3l1.8-1.8M13.5 6.5l1.8-1.8',
  parallel: 'M4 4h12v12H4zM10 4v12',
  sequential: 'M3 10h10M9.5 6.5 13 10l-3.5 3.5M16.5 5v10',
  sidebar: 'M3.5 4.5h13v11h-13zM8 4.5v11',
  appearance: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM10 3v14',
  tags: 'M3.5 3.5h6l7 7-6 6-7-7zM7 7h.01',
  sync: 'M4 8a6.3 6.3 0 0 1 11.5-2M16 3v3.2h-3.2M16 12a6.3 6.3 0 0 1-11.5 2M4 17v-3.2h3.2',
  mcp: 'M7 3v4M13 3v4M5 7h10v3a5 5 0 0 1-10 0zM10 15v2.5',
  about: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM10 9v5M10 6.5h.01',
} as const;

export type IconName = keyof typeof iconPaths;

export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]}/></svg>;
}
