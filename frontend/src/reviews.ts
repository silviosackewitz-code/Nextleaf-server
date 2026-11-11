import type { Task } from './api';
import { dateLocale, t } from './i18n.ts';
export type ReviewSchedule = { interval: number; unit: 'days' | 'weeks' | 'months'; last_reviewed: string | null; next_review: string | null };
export type ReviewUnit = { id: string; name: string; project_id: string | null; status: string | null; schedule: ReviewSchedule; revision: string | null; count: number; due: boolean; confirm_next: string | null; can_undo: boolean };
export type ReviewOverview = { today: string; inbox_count: number; units: ReviewUnit[] };
export type ReviewRecord = { id: string; data_json: string; revision: string; undo_json: string | null };
export function initialReview(overview: ReviewOverview, projectId?: string): string {
  const project = projectId && overview.units.find(unit => unit.project_id === projectId);
  return project ? project.id : overview.inbox_count ? 'inbox' : nextReview(overview.units, []);
}
export function nextReview(units: ReviewUnit[], skipped: string[], except = ''): string {
  return units.find(u => u.due && u.id !== except && !skipped.includes(u.id))?.id ?? '';
}
export function reviewTaskGroups(tasks: Task[]): { name: string; tasks: Task[] }[] {
  const states = [['inbox', 'Inbox'], ['next', 'Next actions'], ['waiting', 'Waiting'], ['scheduled', 'Scheduled'], ['recurring', 'Repeating templates'], ['later', 'Later'], ['someday', 'Someday']] as const;
  return states.map(([state, name]) => ({ name: t(name), tasks: tasks.filter(t => t.status === state) })).filter(g => g.tasks.length);
}
/**
 * Units listed in the queue: everything due, anything reviewed during this visit, and the selected one.
 * `order` is the order first seen in this visit, so a confirmed unit keeps its place instead of
 * jumping to its new position by next review date.
 */
export function reviewQueue(units: ReviewUnit[], selected: string | null, reviewed: string[], all: boolean, order: string[] = []): ReviewUnit[] {
  const position = (id: string) => { const index = order.indexOf(id); return index < 0 ? order.length : index; };
  return units.filter(u => all || u.due || u.id === selected || reviewed.includes(u.id))
    .map((unit, index) => ({ unit, index })).sort((a, b) => position(a.unit.id) - position(b.unit.id) || a.index - b.index).map(item => item.unit);
}
/** The neighbouring step in queue order. Past the last step the result is '', which shows the summary. */
export function reviewStep(ids: string[], current: string | null, delta: 1 | -1): string {
  const index = current ? ids.indexOf(current) : -1;
  if (index < 0) return delta < 0 ? ids[ids.length - 1] ?? '' : '';
  return ids[index + delta] ?? (delta > 0 ? '' : ids[0]);
}
/** After a confirmation: the next due unit below the confirmed one, then any other due unit. */
export function reviewAfter(order: string[], units: ReviewUnit[], skipped: string[], confirmed: string): string {
  const due = (id: string) => id !== confirmed && !skipped.includes(id) && units.some(u => u.id === id && u.due);
  return order.slice(order.indexOf(confirmed) + 1).find(due) ?? nextReview(units, skipped, confirmed);
}
/** Progress of this visit: confirmed units against confirmed plus still due. */
export function reviewProgress(units: ReviewUnit[], reviewed: string[]): { done: number; total: number } {
  return { done: reviewed.length, total: reviewed.length + units.filter(u => u.due && !reviewed.includes(u.id)).length };
}
/** A date-only value as a short localized label; the year appears only when it differs from today's. */
export function reviewDate(value: string | null, today: string): string {
  if (!value) return '';
  const day = value.slice(0, 10);
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric', timeZone: 'UTC', ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }) });
}
