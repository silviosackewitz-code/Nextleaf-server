import type { Area, Project, Tag, Task, View } from './api';
import type { DisplayOptions } from './viewOptions';
import type { TagFilter, TaskFilters } from './taskList';
export type Rules = {
  completed: boolean; states: string[]; availability: '' | 'available' | 'blocked';
  areas: string[]; projects: string[]; tags: string[]; tag_mode: '' | 'all' | 'any' | 'none' | 'untagged';
  contacts: string[]; waiting: string[]; focus: boolean | null;
  due: '' | 'overdue' | 'today' | 'through_today' | 'week' | 'range' | 'none'; from: string | null; through: string | null;
  minutes: number | null; no_minutes: boolean; energies: number[]; no_energy: boolean; first_per_project: boolean;
};
export type PerspectiveDefinition = { version: number; rules: Rules; grouping: 'unified' | 'project' | 'area' | 'state' | 'due'; sorting: 'order' | 'due' | 'title' | 'minutes' | 'completed'; notes: 'none' | 'preview' | 'full'; icon: string; pinned: boolean; project_limit: number | null };
export type Perspective = { id: string; name: string; definition: PerspectiveDefinition; sort_order: number; updated_at: string; deleted: boolean; count?: number | null; error?: string | null };
export type PerspectiveInput = Pick<Perspective, 'name' | 'definition' | 'sort_order'>;
export function emptyPerspective(): PerspectiveDefinition {
  return { version: 1, rules: { completed: false, states: [], availability: '', areas: [], projects: [], tags: [], tag_mode: 'all', contacts: [], waiting: [], focus: null, due: '', from: null, through: null, minutes: null, no_minutes: false, energies: [], no_energy: false, first_per_project: false }, grouping: 'unified', sorting: 'order', notes: 'none', icon: '◈', pinned: true, project_limit: null };
}
export function capturePerspective(view: View | 'projects', area: string, project: string, tag: TagFilter, person: string, filters: TaskFilters, tags: Tag[], display: DisplayOptions): PerspectiveDefinition {
  const d = emptyPerspective(), r = d.rules;
  r.completed = view === 'completed';
  r.states = !project && ['inbox', 'next', 'waiting', 'scheduled', 'someday', 'later'].includes(view) ? [view] : [];
  r.availability = view === 'next' && !project ? 'available' : '';
  r.focus = view === 'focus' && !project ? true : null;
  r.areas = area ? [area] : []; r.projects = project ? [project] : [];
  if (typeof tag === 'symbol') r.tag_mode = 'untagged';
  else if (tag) {
    const known = tags.find(t => t.name === tag);
    if (known) r.tags = [known.id]; else r.waiting = [tag];
  }
  if (person) {
    const known = tags.find(t => t.name === person && t.kind === 'person');
    if (known) r.contacts = [known.id]; else r.waiting = [...new Set([...r.waiting, person])];
  }
  r.due = filters.due; r.minutes = filters.minutes; r.energies = filters.energy === null ? [] : [filters.energy];
  r.first_per_project = view === 'next' && !project && display.grouping === 'sequential';
  d.grouping = project ? 'unified' : display.grouping === 'sequential' ? 'project' : display.grouping;
  d.sorting = r.completed ? 'completed' : 'order'; d.notes = display.notes;
  d.project_limit = view === 'next' && !project && display.grouping === 'project' ? display.projectLimit : null;
  return d;
}
export function perspectiveGroups(tasks: Task[], d: PerspectiveDefinition, projects: Project[], areas: Area[]) {
  if (d.grouping === 'unified') return tasks.length ? [{ id: 'all', title: null, tasks }] : [];
  const groups = new Map<string, { id: string; title: string; tasks: Task[] }>();
  for (const t of tasks) {
    const id = (d.grouping === 'project' ? t.project_id : d.grouping === 'area' ? t.area_id : d.grouping === 'due' ? t.due_date : t.status) ?? '';
    const title = d.grouping === 'project' ? projects.find(p => p.id === id)?.name ?? 'No project' : d.grouping === 'area' ? areas.find(a => a.id === id)?.name ?? 'No Area' : d.grouping === 'due' ? id || 'No due date' : id.charAt(0).toUpperCase() + id.slice(1);
    if (!groups.has(id)) groups.set(id, { id, title, tasks: [] });
    groups.get(id)!.tasks.push(t);
  }
  const result = [...groups.values()];
  if (d.grouping === 'due') result.sort((a,b) => !a.id ? 1 : !b.id ? -1 : a.id.localeCompare(b.id));
  return result;
}
export function ruleLabels(d: PerspectiveDefinition, areas: Area[], projects: Project[], tags: Tag[]): string[] {
  const r = d.rules;
  const named = (ids: string[], items: {id: string; name: string}[], absent: string) => ids.map(id => id ? items.find(i => i.id === id)?.name ?? 'Missing reference' : absent).join(' or ');
  return [r.completed ? 'Completed' : 'Open', r.states.join(' or '), r.availability === 'available' ? 'Available now' : r.availability === 'blocked' ? 'Unavailable' : '', r.areas.length ? `Area: ${named(r.areas, areas, 'No Area')}` : '', r.projects.length ? `Project: ${named(r.projects, projects, 'No project')}` : '', r.tag_mode === 'untagged' ? 'Untagged' : r.tags.length ? `Tags (${r.tag_mode || 'all'}): ${named(r.tags, tags, '')}` : '', r.contacts.length || r.waiting.length ? `Contacts: ${[named(r.contacts, tags, ''), ...r.waiting].filter(Boolean).join(' or ')}` : '', r.focus === null ? '' : r.focus ? 'Focused' : 'Not focused', r.due ? `Due: ${r.due === 'range' ? `${r.from ?? 'any'} – ${r.through ?? 'any'}` : r.due.replaceAll('_', ' ')}` : '', r.no_minutes ? 'Time unspecified' : r.minutes === null ? '' : `Time ≤ ${r.minutes} min`, r.no_energy ? 'Energy unspecified' : r.energies.length ? `Energy: ${r.energies.join(', ')}` : '', r.first_per_project ? 'First available action per project' : ''].filter(Boolean);
}
