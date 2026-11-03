import type { Area, Project, Task } from './api';
import type { TaskChanges } from './taskEdit';

export const timeOptions = [5, 10, 15, 30, 45, 60, 120, 180, 240, 360, 480];
export type QuickChoice = { label: string; checked: boolean; changes: TaskChanges };
export function quickChoices(group: string, task: Task, projects: Project[], areas: Area[], tags: string[], people: string[] = []): QuickChoice[] {
  switch (group) {
    case 'Time': return [null, ...new Set([...timeOptions, ...(task.estimated_minutes == null ? [] : [task.estimated_minutes])])].map(value => ({ label: value == null ? 'None' : value < 60 ? `${value} minutes` : `${value / 60} ${value === 60 ? 'hour' : 'hours'}`, checked: task.estimated_minutes === value, changes: { estimated_minutes: value } }));
    case 'Energy': return ['None', 'Low', 'Medium', 'High'].map((label, value) => ({ label, checked: (task.energy || 0) === value, changes: { energy: value || null } }));
    case 'Status': return ['inbox', 'next', 'waiting', 'scheduled', 'someday', 'later', 'completed', 'trash'].map(value => ({ label: value[0].toUpperCase() + value.slice(1), checked: task.status === value, changes: { status: value } }));
    case 'Project': return [{ id: null, name: 'Standalone' }, ...projects.filter(p => p.status !== 'completed' || p.id === task.project_id)].map(p => ({ label: p.name, checked: task.project_id === p.id, changes: { project_id: p.id, area_id: null } }));
    case 'Area': return [{ id: null, name: 'No area' }, ...areas.filter(area => !area.archived || area.id === task.area_id)].map(a => ({ label: a.name, checked: task.area_id === a.id, changes: { area_id: a.id } }));
    case 'Waiting for': return [...new Set([...people, ...(task.waiting_for ? [task.waiting_for] : [])])].map(person => ({ label: person, checked: task.waiting_for === person, changes: { waiting_for: person } }));
    case 'Focus': return [true, false].map(value => ({ label: value ? 'In Focus' : 'Not in Focus', checked: task.starred === value, changes: { starred: value } }));
    case 'Tags': return [...new Set([...tags, ...task.tags])].map(tag => ({ label: tag, checked: task.tags.includes(tag), changes: { tags: task.tags.includes(tag) ? task.tags.filter(t => t !== tag) : [...task.tags, tag] } }));
    default: return [];
  }
}

// A narrow screen uses the available width; desktop submenus always open to the left.
export function submenuPosition(parent: { left: number; right: number }, rowTop: number, width: number, height: number, viewport: { width: number; height: number }) {
  const left = parent.left >= width + 8 ? parent.left - width : Math.min(viewport.width - width - 8, parent.right);
  return { left: Math.max(8, left), top: Math.max(8, Math.min(rowTop, viewport.height - height - 8)) };
}
