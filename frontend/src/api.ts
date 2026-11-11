import type { ReviewOverview, ReviewRecord, ReviewSchedule } from './reviews';
import type { McpAccess, McpPolicy } from './mcpPermissions';
import type { Perspective, PerspectiveDefinition, PerspectiveInput } from './perspectives';
import type { ProjectChanges } from './projectEdit';
import type { RepeatRule } from './scheduling';
import type { TaskChanges } from './taskEdit';
import { t } from './i18n.ts';
export type View = 'inbox' | 'next' | 'waiting' | 'scheduled' | 'someday' | 'completed' | 'later' | 'focus' | 'trash' | 'all';
export type Tag = { id: string; name: string; kind: 'tag' | 'person'; archived: boolean };
export type Area = { id: string; name: string; sort_order: number; archived: boolean };
type TagChanges = Partial<Pick<Tag, 'name' | 'kind' | 'archived'>>;
type AreaChanges = Partial<Pick<Area, 'name' | 'archived'>>;
const normalizeTag = (tag: Tag): Tag => ({ ...tag, kind: tag.kind ?? 'tag', archived: tag.archived ?? false });
const normalizeArea = (area: Area): Area => ({ ...area, archived: area.archived ?? false });
export type Project = { id: string; area_id: string | null; name: string; notes: string; project_type: 'sequential' | 'parallel'; completed_at: string | null; status: string; sort_order: number; due_date: string | null; starred: boolean; trashed: boolean; tags: string[] };
export type Task = { id: string; project_id: string | null; area_id: string | null; title: string; notes: string; status: string; available: boolean; blocked_by_sequence: boolean; sort_order: number; due_date: string | null; defer_until: string | null; recurrence: RepeatRule | null; completed_at: string | null; starred: boolean; tags: string[]; waiting_for: string | null; estimated_minutes: number | null; energy: number | null ; project_trashed?: boolean };

export const getStoredApiUrl = () => localStorage.getItem('taskmanager_api_url') ?? '';
export function getApiBase() {
  const override = getStoredApiUrl().trim().replace(/\/$/, '');
  if (override) return override;
  return '';
}
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { const body = await response.json() as { error?: string }; message = body.error ? t(body.error) : message; } catch { /* ignore */ }
    throw new Error(message);
  }
  return await response.json() as T;
}
export const api = {
  reviews: () => request<ReviewOverview>('/reviews'),
  reviewTasks: (id: string) => request<Task[]>(`/reviews/${encodeURIComponent(id)}/tasks`),
  reviewSchedule: (id: string, expected_revision: string | null, schedule: ReviewSchedule) => request<ReviewRecord>('/reviews', { method: 'PATCH', body: JSON.stringify({ id, expected_revision, interval: schedule.interval, unit: schedule.unit, next_review: schedule.next_review }) }),
  confirmReview: (id: string, expected_revision: string | null, expected_day: string) => request<ReviewRecord>('/reviews/confirm', { method: 'POST', body: JSON.stringify({ id, expected_revision, expected_day }) }),
  undoReview: (id: string, expected_revision: string) => request<ReviewRecord>('/reviews/undo', { method: 'POST', body: JSON.stringify({ id, expected_revision }) }),
  mcpAccess: () => request<McpAccess>('/mcp/permissions'),
  saveMcpAccess: (policy: McpPolicy) => request<McpPolicy>('/mcp/permissions', { method: 'PATCH', body: JSON.stringify(policy) }),
  perspectives: () => request<Perspective[]>('/perspectives'),
  perspectiveTasks: (id: string) => request<Task[]>(`/perspectives/${id}/tasks`),
  previewPerspective: (definition: PerspectiveDefinition) => request<Task[]>('/perspectives/preview', {method:'POST',body:JSON.stringify(definition)}),
  savePerspective: (input: PerspectiveInput, original?: Perspective, deleted = false) => request<Perspective>(original ? `/perspectives/${original.id}` : '/perspectives', {method:original?'PATCH':'POST', body:JSON.stringify({...input, deleted, expected_updated_at:original?.updated_at ?? null})}),
  repeatBacklog: (template_id: string, rule: RepeatRule) => request<{ count: number; through: string }>('/schedule/preview', { method: 'POST', body: JSON.stringify({ template_id, rule }) }),
  reportTimezone: async () => {
    if (!(await api.health()).capabilities?.includes('scheduling')) return;
    await request('/schedule/timezone', { method: 'POST', body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
  },
  health: () => request<{ capabilities?: string[] }>('/health'),
  tags: async () => (await request<Tag[]>('/tags')).map(normalizeTag),
  addTag: async (name: string, kind?: Tag['kind']) => {
    const health = await api.health();
    if (!health.capabilities?.includes(kind === undefined ? 'item-creation' : 'tag-management')) throw new Error(t('Update the Nextleaf server before creating tags or contacts.'));
    return normalizeTag(await request<Tag>('/tags', { method: 'POST', body: JSON.stringify({ name, kind }) }));
  },
  updateTag: async (id: string, changes: TagChanges, expected?: TagChanges) => {
    if (!(await api.health()).capabilities?.includes('tag-management')) throw new Error(t('Update the Nextleaf server before managing tags or contacts. Your changes have not been saved.'));
    return normalizeTag(await request<Tag>(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(expected ? { ...changes, expected } : changes) }));
  },
  areas: async () => (await request<Area[]>('/areas')).map(normalizeArea),
  updateArea: async (id: string, changes: AreaChanges, expected?: AreaChanges) => {
    if (!(await api.health()).capabilities?.includes('tag-management')) throw new Error(t('Update the Nextleaf server before managing areas. Your changes have not been saved.'));
    return normalizeArea(await request<Area>(`/areas/${id}`, { method: 'PATCH', body: JSON.stringify(expected ? { ...changes, expected } : changes) }));
  },
  /** Projects in Trash are hidden; `trash` lists only those and needs a server with project Trash. */
  projects: async (trash = false) => (await request<Project[]>(trash ? '/projects?trash=true' : '/projects')).map(project => ({ ...project, due_date: project.due_date ?? null, starred: project.starred ?? false, trashed: project.trashed ?? false, tags: project.tags ?? [] })),
  updateProject: async (id: string, changes: ProjectChanges, expected?: ProjectChanges) => {
    const health = await api.health();
    if (!health.capabilities?.includes('project-editing')) throw new Error(t('Update the Nextleaf server before editing projects. Your changes have not been saved.'));
    if (expected && !health.capabilities?.includes('conditional-updates')) throw new Error(t('Update the Nextleaf server before saving. Your changes have not been saved.'));
    if (Object.hasOwn(changes, 'trashed') && !health.capabilities?.includes('project-trash')) throw new Error(t('Update the Nextleaf server before moving projects to Trash.'));
    return request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(expected ? { ...changes, expected } : changes) });
  },
  task: (id: string) => request<Task>(`/tasks/${id}`),
  tasks: (view: View, areaId?: string, projectId?: string) => {
    const p = new URLSearchParams({ view });
    if (areaId) p.set('area_id', areaId);
    if (projectId) p.set('project_id', projectId);
    return request<Task[]>(`/tasks?${p.toString()}`);
  },
  addArea: async (name: string) => normalizeArea(await request<Area>('/areas', { method: 'POST', body: JSON.stringify({ name }) })),
  addProject: (name: string, area_id: string | null, project_type: Project['project_type']) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify({ name, area_id, project_type }) }),
  addTask: async (title: string, status: View, project_id: string | null, area_id: string | null, starred = false, defer_until: string | null = null) => {
    if (defer_until && !(await api.health()).capabilities?.includes('scheduling')) throw new Error(t('Update the Nextleaf server before scheduling tasks.'));
    if (starred && !(await api.health()).capabilities?.includes('item-creation')) throw new Error(t('Update the Nextleaf server before creating Focus tasks.'));
    return request<Task>('/tasks', { method: 'POST', body: JSON.stringify({ title, status, project_id, area_id, starred, ...(defer_until ? { defer_until } : {}) }) });
  },
  updateTask: async (id: string, changes: TaskChanges, expected?: TaskChanges) => {
    if (Object.hasOwn(changes, 'recurrence') && !(await api.health()).capabilities?.includes('scheduling')) throw new Error(t('Update the Nextleaf server before changing schedules. Your changes have not been saved.'));
    // Older servers ignore unknown fields; never silently drop part of an edit.
    if (expected || Object.keys(changes).some(field => field !== 'title' && field !== 'status')) {
      const health = await request<{ capabilities?: string[] }>('/health');
      if (!health.capabilities?.includes('task-editing')) throw new Error(t('Update the Nextleaf server before editing task details. Your changes have not been saved.'));
      if (expected && !health.capabilities?.includes('conditional-updates')) throw new Error(t('Update the Nextleaf server before saving. Your changes have not been saved.'));
    }
    return request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(expected ? { ...changes, expected } : changes) });
  },
};
