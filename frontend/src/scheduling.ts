import type { Task } from './api';
import type { TaskChanges } from './taskEdit';
import { dateKey } from './calendar.ts';

export type RepeatRule = { id: string; frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number; start: string; until: string | null; due_days: number | null; paused: boolean; catch_up_through?: string | null };
export function stateChange(status: string): TaskChanges {
  return ['completed', 'trash'].includes(status) ? { status } : { status, defer_until: null, recurrence: null };
}
export function scheduleChange(date: string | null): TaskChanges {
  return { ...stateChange(date ? 'scheduled' : 'next'), defer_until: date, ...(date ? { starred: false } : {}) };
}
export function waitingChange(contact: string | null): TaskChanges {
  return { ...stateChange('waiting'), waiting_for: contact?.trim() || null };
}
export function repeatChange(rule: RepeatRule): TaskChanges {
  return { status: 'recurring', defer_until: null, recurrence: rule, starred: false };
}
export function repeatPreview(rule: RepeatRule): string[] {
  const [year, month, day] = rule.start.split('-').map(Number);
  if (!year || !month || !day || rule.interval < 1) return [];
  return [0, 1, 2].map(index => {
    const count = rule.interval * index;
    const date = new Date(year, month - 1, day, 12);
    if (rule.frequency === 'daily' || rule.frequency === 'weekly') date.setDate(day + count * (rule.frequency === 'weekly' ? 7 : 1));
    else {
      date.setDate(1);
      date.setMonth(month - 1 + count * (rule.frequency === 'yearly' ? 12 : 1));
      date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
    }
    return dateKey(date);
  }).filter(date => !rule.until || date <= rule.until);
}
export function stateLabel(task: Task): string {
  if (task.status === 'recurring') return task.recurrence?.paused ? 'Repeating · Paused' : 'Repeating';
  if (task.status === 'scheduled' && task.defer_until) return `Scheduled: ${new Date(`${task.defer_until.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
  if (task.status === 'waiting' && task.waiting_for) return `Waiting · ${task.waiting_for}`;
  return task.status[0].toUpperCase() + task.status.slice(1);
}
