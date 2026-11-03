import { matchesTagFilter, type TagFilter } from './taskList.ts';
import type { Project, Task } from './api';
export const projectFields = ['name', 'notes', 'area_id', 'project_type', 'status', 'due_date', 'starred', 'tags'] as const;
export type ProjectChanges = Partial<Pick<Project, typeof projectFields[number]>>;
export function projectChanges(original: Project, draft: Project): ProjectChanges {
  return Object.fromEntries(projectFields.filter(field => JSON.stringify(original[field]) !== JSON.stringify(draft[field])).map(field => [field, draft[field]]));
}
export function projectRows(projects: Project[], tasks: Task[], tag: TagFilter) {
  const counts = new Map<string, number>();
  for (const task of tasks) if (task.project_id && !['completed', 'trash', 'recurring'].includes(task.status)) counts.set(task.project_id, (counts.get(task.project_id) ?? 0) + 1);
  return projects.filter(project => matchesTagFilter(project.tags, tag)).map(project => ({ project, count: counts.get(project.id) ?? 0 }));
}

export function projectExpected(original: Project, changes: ProjectChanges): ProjectChanges {
  return Object.fromEntries(projectFields.filter(field => Object.hasOwn(changes, field)).map(field => [field, original[field]]));
}
