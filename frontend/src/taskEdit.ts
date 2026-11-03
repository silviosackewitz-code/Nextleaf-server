import type { Task } from './api';

export const editableFields = ['title', 'notes', 'status', 'project_id', 'area_id', 'tags', 'starred', 'waiting_for', 'due_date', 'defer_until', 'recurrence', 'estimated_minutes', 'energy'] as const;
export type TaskChanges = Partial<Pick<Task, typeof editableFields[number]>>;

export function taskChanges(original: Task, draft: Task): TaskChanges {
  return Object.fromEntries(editableFields.filter(field => JSON.stringify(original[field]) !== JSON.stringify(draft[field])).map(field => [field, draft[field]]));
}

export function taskExpected(original: Task, changes: TaskChanges): TaskChanges {
  return Object.fromEntries(editableFields.filter(field => Object.hasOwn(changes, field)).map(field => [field, original[field]]));
}
