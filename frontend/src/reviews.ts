import type { Task } from './api';
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
  return states.map(([state, name]) => ({ name, tasks: tasks.filter(t => t.status === state) })).filter(g => g.tasks.length);
}
