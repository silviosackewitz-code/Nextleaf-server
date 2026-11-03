import type { View } from './api';

export type NoteDisplay = 'none' | 'preview' | 'full';
export type Grouping = 'project' | 'unified' | 'sequential' | 'state';
export type DisplayOptions = { project: boolean; tags: boolean; due: boolean; notes: NoteDisplay; grouping: Grouping; projectLimit: number | null };
export const defaultDisplay: DisplayOptions = { project: true, tags: true, due: true, notes: 'none', grouping: 'project', projectLimit: 3 };
export function readDisplayOptions(value: string | null): Record<string, DisplayOptions> {
  try {
    const parsed = JSON.parse(value ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => {
      if (!value || typeof value !== 'object') return [];
      const options = value as Record<string, unknown>;
      if (!['project', 'tags', 'due'].every(key => typeof options[key] === 'boolean')) return [];
      return [[key, {
        project: options.project, tags: options.tags, due: options.due,
        notes: ['none', 'preview', 'full'].includes(String(options.notes)) ? options.notes : 'none',
        grouping: ['project', 'unified', 'sequential', 'state'].includes(String(options.grouping)) ? options.grouping : 'project',
        projectLimit: options.projectLimit === null ? null : Number.isInteger(options.projectLimit) && Number(options.projectLimit) >= 1 && Number(options.projectLimit) <= 9 ? options.projectLimit : 3,
      } as DisplayOptions]];
    }));
  } catch { return {}; }
}
export function viewGrouping(view: View | 'projects', projectId: string, display: DisplayOptions): Grouping {
  if (projectId) return 'unified';
  if (view === 'next') return display.grouping === 'state' ? 'project' : display.grouping;
  if (view === 'focus') return display.grouping === 'sequential' ? 'unified' : display.grouping;
  return view === 'waiting' || view === 'scheduled' ? 'unified' : 'project';
}
export function captureTarget(view: View): { status: View; starred: boolean } {
  if (view === 'focus') return { status: 'next', starred: true };
  return { status: ['inbox', 'next', 'waiting', 'scheduled', 'someday', 'later'].includes(view) ? view : 'inbox', starred: false };
}
