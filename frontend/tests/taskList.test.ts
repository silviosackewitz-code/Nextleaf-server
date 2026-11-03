import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNTAGGED, withRecentCompletions, groupTasks, filterTasksByTag, isOverdue, emptyTaskFilters, filterTaskProperties, navigationCounts, sequentialTasks, taskGroups, taskPeople, sidebarFilterGroups } from '../src/taskList.ts';
import type { Project, Tag, Task } from '../src/api.ts';

const task = (id: string, status = 'next'): Task => ({
  id, title: id, status, project_id: null, area_id: null, notes: '', available: true,
  blocked_by_sequence: false, sort_order: 100, due_date: null, defer_until: null,
  completed_at: null, starred: false, tags: [], waiting_for: null, estimated_minutes: null, energy: null,
});

test('multiple completed tasks keep their positions while a newly available task appears', () => {
  const fresh = [task('a'), task('c'), task('newly available')];
  const completed = [
    { task: task('d', 'completed'), previousStatus: 'waiting', index: 3 },
    { task: task('b', 'completed'), previousStatus: 'next', index: 1 },
  ];
  const result = withRecentCompletions(fresh, completed);
  assert.deepEqual(result.map(row => row.id), ['a', 'b', 'c', 'd', 'newly available']);
  assert.equal(result[1].status, 'completed');
  assert.equal(fresh.length, 3);
});

test('fresh server data takes precedence and no task appears twice', () => {
  const reopened = task('a', 'waiting');
  assert.deepEqual(withRecentCompletions([reopened], [{ task: task('a', 'completed'), previousStatus: 'waiting', index: 0 }]), [reopened]);
});

test('the last completed task stays visible; clearing the session removes it', () => {
  const done = task('a', 'completed');
  assert.deepEqual(withRecentCompletions([], [{ task: done, previousStatus: 'next', index: 0 }]), [done]);
  assert.deepEqual(withRecentCompletions([], []), []);
});

test('project groups keep sidebar order and task order, omit empty groups, and retain standalone tasks', () => {
  const projects = [{ id: 'p2', name: 'Second' }, { id: 'p1', name: 'First' }, { id: 'empty', name: 'Empty' }] as Project[];
  const rows = [task('loose'), { ...task('a'), project_id: 'p1' }, { ...task('b'), project_id: 'p2' }, { ...task('c', 'completed'), project_id: 'p1' }];
  assert.deepEqual(groupTasks(rows, projects, '').map(g => [g.title, g.tasks.map(t => t.id)]), [
    ['Actions', ['loose']], ['Second', ['b']], ['First', ['a', 'c']],
  ]);
  assert.equal(groupTasks(rows.slice(1, 2), projects, 'p1')[0].title, null);
  assert.deepEqual(groupTasks([], projects, ''), []);
});
test('a task whose project is missing from metadata is never lost', () => {
  const row = { ...task('orphan'), project_id: 'missing' };
  assert.deepEqual(groupTasks([row], [], '')[0].tasks, [row]);
});

test('tag filter preserves server eligibility and order; All restores untagged tasks too', () => {
  const rows = [{ ...task('a'), tags: ['Laptop'] }, task('b'), { ...task('c', 'completed'), tags: ['Laptop', 'Phone'] }];
  assert.deepEqual(filterTasksByTag(rows, 'Laptop').map(t => t.id), ['a', 'c']);
  assert.deepEqual(filterTasksByTag(rows, 'Missing'), []);
  assert.deepEqual(filterTasksByTag(rows, null), rows);
});

test('overdue uses the local calendar date and never marks today, completed or trash', () => {
  const now = new Date(2026, 9, 17, 0, 15);
  assert.equal(isOverdue({ due_date: '2026-10-16', status: 'next' }, now), true);
  assert.equal(isOverdue({ due_date: '2026-10-17', status: 'next' }, now), false);
  assert.equal(isOverdue({ due_date: '2026-10-18', status: 'next' }, now), false);
  assert.equal(isOverdue({ due_date: null, status: 'next' }, now), false);
  for (const status of ['completed', 'trash', 'recurring']) assert.equal(isOverdue({ due_date: '2026-10-16', status }, now), false);
  assert.equal(isOverdue({ due_date: '2026-10-16', status: 'waiting' }, now), true);
});

test('mobile property filters intersect without adding unavailable tasks or changing order', () => {
  const now = new Date(2026, 9, 17, 23, 30);
  const rows = [
    { ...task('first'), due_date: '2026-10-17', estimated_minutes: 5, energy: 1 },
    { ...task('second'), due_date: '2026-10-16', estimated_minutes: 15, energy: 2 },
    { ...task('third'), due_date: '2026-10-17', estimated_minutes: 45, energy: 1 },
    task('unset'),
  ];
  assert.deepEqual(filterTaskProperties(rows, emptyTaskFilters, now), rows);
  assert.deepEqual(filterTaskProperties(rows, { due: 'today', minutes: 15, energy: 1 }, now).map(t => t.id), ['first']);
  assert.deepEqual(filterTaskProperties(rows, { ...emptyTaskFilters, due: 'overdue' }, now).map(t => t.id), ['second']);
  assert.deepEqual(filterTaskProperties(rows, { ...emptyTaskFilters, energy: 1 }, now).map(t => t.id), ['first', 'third']);
});

test('navigation badges split open Focus tasks into overdue and remaining tasks', () => {
  const now = new Date(2026, 9, 18, 0, 10);
  const tagged = { ...task('tagged'), tags: ['Laptop'], due_date: '2026-10-17', starred: true };
  const today = { ...task('today'), due_date: '2026-10-18', starred: true };
  const views = {
    inbox: [{ ...tagged, status: 'inbox' }, task('untagged', 'inbox'), task('completed', 'completed')],
    focus: [tagged, today, { ...tagged, status: 'trash' }, { ...tagged, status: 'recurring' }],
    waiting: [{ ...tagged, status: 'waiting' }],
  };
  assert.deepEqual(navigationCounts(views, null, now), { inbox: 2, focus: 1, focusOverdue: 1, waiting: 1 });
  assert.deepEqual(navigationCounts(views, 'Laptop', now), { inbox: 1, focus: 0, focusOverdue: 1, waiting: 1 });
  assert.deepEqual(navigationCounts(views, 'Missing', now), { inbox: 0, focus: 0, focusOverdue: 0, waiting: 0 });
});


test('untagged includes area-only tasks, excludes real tags, and filters counts', () => {
  const rows = [task('bare'), { ...task('area'), area_id: 'personal' },
    { ...task('tagged'), tags: ['Laptop'] }, { ...task('dash'), tags: ['—'] },
    { ...task('named'), tags: ['untagged'] }];
  assert.deepEqual(filterTasksByTag(rows, UNTAGGED).map(t => t.id), ['bare', 'area']);
  assert.deepEqual(filterTasksByTag(rows, '—').map(t => t.id), ['dash']);
  assert.deepEqual(filterTasksByTag(rows, 'untagged').map(t => t.id), ['named']);
  assert.deepEqual(navigationCounts({ inbox: rows, focus: [], waiting: rows }, UNTAGGED),
    { inbox: 2, focus: 0, focusOverdue: 0, waiting: 2 });
});


test('sequential display only selects first eligible project action before tag filters', () => {
  const rows = [
    { ...task('later'), project_id: 'p', sort_order: 20, tags: ['Laptop'] },
    { ...task('first'), project_id: 'p', sort_order: 10 },
    { ...task('blocked'), project_id: 'q', sort_order: 1, available: false },
    task('standalone'), { ...task('done', 'completed'), project_id: 'p' },
  ];
  assert.deepEqual(sequentialTasks(rows).map(t => t.id), ['first', 'standalone', 'done']);
  assert.deepEqual(filterTasksByTag(sequentialTasks(rows), 'Laptop'), []);
});
test('Waiting preserves free text contacts and deduplicates typed People', () => {
  const row = { ...task('waiting', 'waiting'), waiting_for: ' Alex ', tags: ['Alex', 'Laptop', 'Sam'] };
  assert.deepEqual(taskPeople(row, ['Alex', 'Sam']), ['Alex', 'Sam']);
  assert.deepEqual(filterTasksByTag([{ ...row, tags: [] }], 'Alex').map(t => t.id), ['waiting']);
  assert.deepEqual(filterTasksByTag([{ ...row, tags: [] }], UNTAGGED), []);
});
test('state groups and scheduled date groups keep rows without imposing new eligibility', () => {
  const rows = [task('wait', 'waiting'), task('next'), task('done', 'completed')];
  assert.deepEqual(taskGroups(rows, [], '', 'state', 'focus').map(g => [g.title, g.tasks.map(t => t.id)]), [['Next', ['next']], ['Waiting', ['wait']], ['Completed', ['done']]]);
  const scheduled = [{ ...task('later'), defer_until: '2026-11-03' }, { ...task('earlier'), defer_until: '2026-11-01' }, task('no date')];
  assert.deepEqual(taskGroups(scheduled, [], '', 'unified', 'scheduled').map(g => g.title), ['2026-11-01', '2026-11-03', 'No start date']);
});

test('sidebar separates typed contacts from ordinary tags and retains waiting text without reclassification', () => {
  const tags: Tag[] = [
    { id: '1', name: 'Laptop', kind: 'tag', archived: false },
    { id: '2', name: 'People', kind: 'tag', archived: false },
    { id: '3', name: 'Supplier', kind: 'person', archived: false },
    { id: '4', name: 'Archived contact', kind: 'person', archived: true },
    { id: '5', name: 'Old tag', kind: 'tag', archived: true },
  ];
  const waiting = [' Supplier ', 'Test team', 'Test team', '', 'Archived contact'].map((name, i) => ({ ...task(String(i), 'waiting'), waiting_for: name }));
  waiting.push({ ...task('done', 'completed'), waiting_for: 'Finished contact' });
  assert.deepEqual(sidebarFilterGroups(tags, waiting), { tags: ['Laptop', 'People'], contacts: ['Supplier', 'Test team'] });
  assert.deepEqual(sidebarFilterGroups([], []), { tags: [], contacts: [] });
  assert.equal(tags[1].kind, 'tag');
  assert.equal(filterTasksByTag(waiting, 'Test team').length, 2);
});
