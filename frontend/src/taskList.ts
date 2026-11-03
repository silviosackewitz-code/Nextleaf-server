import type { Project, Tag, Task } from './api';
import type { Grouping } from './viewOptions';

export type RecentCompletion = { task: Task; previousStatus: string; index: number };

// Keep just-completed rows in place until the user leaves or refreshes the view.
export function withRecentCompletions(tasks: Task[], completed: Iterable<RecentCompletion>): Task[] {
  const result = [...tasks];
  for (const entry of [...completed].sort((a, b) => a.index - b.index)) {
    if (!result.some(task => task.id === entry.task.id)) {
      result.splice(Math.min(entry.index, result.length), 0, entry.task);
    }
  }
  return result;
}

export function groupTasks(tasks: Task[], projects: Project[], projectId: string) {
  if (projectId) return tasks.length ? [{ id: projectId, title: null, tasks }] : [];
  const groups = new Map<string, { id: string; title: string; tasks: Task[] }>([
    ['', { id: '', title: 'Actions', tasks: [] }],
  ]);
  for (const project of projects) groups.set(project.id, { id: project.id, title: project.name, tasks: [] });
  for (const task of tasks) {
    const id = task.project_id ?? '';
    if (!groups.has(id)) groups.set(id, { id, title: 'Unknown project', tasks: [] });
    groups.get(id)!.tasks.push(task);
  }
  return [...groups.values()].filter(group => group.tasks.length);
}

export const UNTAGGED = Symbol('untagged');
export type TagFilter = string | null | typeof UNTAGGED;
export function matchesTagFilter(tags: string[], tag: TagFilter): boolean {
  return tag === null || (tag === UNTAGGED ? tags.length === 0 : tags.includes(tag));
}
export function filterTasksByTag(tasks: Task[], tag: TagFilter): Task[] {
  return tasks.filter(task => (matchesTagFilter(task.tags, tag) || (typeof tag === 'string' && task.waiting_for?.trim() === tag)) && (tag !== UNTAGGED || !task.waiting_for?.trim()));
}

export function isOverdue(task: Pick<Task, 'due_date' | 'status'>, now = new Date()): boolean {
  if (!task.due_date || ['completed', 'trash', 'recurring'].includes(task.status)) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return task.due_date.slice(0, 10) < today;
}

export type TaskFilters = { due: '' | 'today' | 'overdue'; minutes: number | null; energy: number | null };
export const emptyTaskFilters: TaskFilters = { due: '', minutes: null, energy: null };
export function filterTaskProperties(tasks: Task[], filters: TaskFilters, now = new Date()): Task[] {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return tasks.filter(task =>
    (!filters.due || (filters.due === 'overdue' ? isOverdue(task, now) : task.due_date?.slice(0, 10) === today)) &&
    (filters.minutes === null || (task.estimated_minutes !== null && task.estimated_minutes <= filters.minutes)) &&
    (filters.energy === null || task.energy === filters.energy));
}

export function navigationCounts(views: { inbox: Task[]; focus: Task[]; waiting: Task[] }, tag: TagFilter, now = new Date()) {
  const open = (tasks: Task[]) => filterTasksByTag(tasks, tag).filter(task => !['completed', 'trash', 'recurring'].includes(task.status));
  const focus = open(views.focus);
  const focusOverdue = focus.filter(task => isOverdue(task, now)).length;
  return { inbox: open(views.inbox).length, focus: focus.length - focusOverdue, focusOverdue, waiting: open(views.waiting).length };
}

// Select before tag/property filters so a later task cannot replace the next action.
export function sequentialTasks(tasks: Task[]): Task[] {
  const first = new Map<string, Task>();
  for (const task of tasks) {
    if (!task.project_id || task.status === 'completed' || !task.available) continue;
    const previous = first.get(task.project_id);
    if (!previous || task.sort_order < previous.sort_order) first.set(task.project_id, task);
  }
  return tasks.filter(task => !task.project_id || task.status === 'completed' || first.get(task.project_id)?.id === task.id);
}

export function taskGroups(tasks: Task[], projects: Project[], projectId: string, grouping: Grouping, view: string) {
  if (projectId) return groupTasks(tasks, projects, projectId);
  if (grouping === 'project') return groupTasks(tasks, projects, '');
  if (grouping === 'sequential') return [
    { id: 'actions', title: 'Actions', tasks: tasks.filter(task => !task.project_id) },
    { id: 'project-actions', title: 'Project actions', tasks: tasks.filter(task => task.project_id) },
  ].filter(group => group.tasks.length);
  if (grouping === 'state') {
    const labels: Record<string, string> = { inbox: 'Inbox', next: 'Next', waiting: 'Waiting', scheduled: 'Scheduled', someday: 'Someday', later: 'Later', completed: 'Completed', trash: 'Trash', recurring: 'Recurring' };
    return Object.entries(labels).map(([id, title]) => ({ id, title, tasks: tasks.filter(task => task.status === id) })).filter(group => group.tasks.length);
  }
  if (view === 'scheduled') {
    const dates = [...new Set(tasks.filter(task => task.status !== 'recurring').map(task => task.defer_until?.slice(0, 10) ?? ''))].sort((a, b) => !a ? 1 : !b ? -1 : a.localeCompare(b));
    const groups = dates.map(date => ({ id: `date:${date}`, title: date || 'No start date', tasks: tasks.filter(task => task.status !== 'recurring' && (task.defer_until?.slice(0, 10) ?? '') === date) }));
    const repeating = tasks.filter(task => task.status === 'recurring');
    if (repeating.length) groups.push({ id: 'repeating', title: 'Repeating', tasks: repeating });
    return groups;
  }
  return tasks.length ? [{ id: 'all', title: view === 'waiting' ? 'Waiting for' : null, tasks }] : [];
}

export function taskPeople(task: Task, people: string[]): string[] {
  return [...new Set([...(task.waiting_for?.trim() ? [task.waiting_for.trim()] : []), ...task.tags.filter(tag => people.includes(tag))])];
}

// Free-text waiting contacts remain usable without creating or reclassifying tags.
export function sidebarFilterGroups(tags: Tag[], waiting: Task[]) {
  const archivedContacts = new Set(tags.filter(tag => tag.kind === 'person' && tag.archived).map(tag => tag.name));
  return {
    tags: tags.filter(tag => tag.kind === 'tag' && !tag.archived).map(tag => tag.name),
    contacts: [...new Set([
      ...tags.filter(tag => tag.kind === 'person' && !tag.archived).map(tag => tag.name),
      ...waiting.filter(task => task.status === 'waiting').map(task => task.waiting_for?.trim() ?? '')
        .filter(name => name && !archivedContacts.has(name)),
    ])].sort((a, b) => a.localeCompare(b)),
  };
}
