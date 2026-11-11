import test from 'node:test';
import assert from 'node:assert/strict';
import { initialReview, nextReview, reviewAfter, reviewDate, reviewProgress, reviewQueue, reviewStep, reviewTaskGroups, type ReviewUnit } from '../src/reviews.ts';
import type { Task } from '../src/api.ts';
test('skip leaves source due state intact and upcoming units are never selected automatically', () => {
  const units = [{ id: 'one', due: true }, { id: 'two', due: true }, { id: 'later', due: false }] as ReviewUnit[];
  assert.equal(nextReview(units, ['one']), 'two');
  assert.equal(nextReview(units, ['one'], 'two'), '');
  assert.equal(units[0].due, true);
  assert.equal(nextReview(units, []), 'one');
});
test('review shows blocked, waiting, deferred and repeating actions, without Top 3 limits', () => {
  const rows = ['next', 'next', 'next', 'next', 'waiting', 'scheduled', 'recurring', 'later', 'someday'].map((status, i) => ({ id: String(i), status, available: false, blocked_by_sequence: true })) as Task[];
  const groups = reviewTaskGroups(rows);
  assert.equal(groups.reduce((n, g) => n + g.tasks.length, 0), rows.length);
  assert.equal(groups[0].tasks.length, 4);
  assert.deepEqual(groups.map(g => g.name), ['Next actions', 'Waiting', 'Scheduled', 'Repeating templates', 'Later', 'Someday']);
});

test('explicit project review opens that project even with Inbox items or a future schedule', () => {
  const units = [{ id: 'project:due', project_id: 'due', due: true }, { id: 'project:later', project_id: 'later', due: false }] as ReviewUnit[];
  const overview = { today: '2026-10-26', inbox_count: 2, units };
  assert.equal(initialReview(overview, 'later'), 'project:later');
  assert.equal(initialReview(overview, 'due'), 'project:due');
  assert.equal(initialReview(overview), 'inbox');
  assert.equal(initialReview(overview, 'missing'), 'inbox');
  assert.equal(initialReview({ ...overview, inbox_count: 0 }), 'project:due');
  assert.equal(initialReview({ ...overview, inbox_count: 0, units: [] }), '');
});

test('the queue keeps the order of this visit, so a confirmed unit does not jump', () => {
  const before = [{ id: 'a', due: true }, { id: 'b', due: true }, { id: 'later', due: false }] as ReviewUnit[];
  const order = before.map(unit => unit.id);
  // After confirming "a" the server sorts it behind "b" and it is no longer due.
  const after = [{ id: 'b', due: true }, { id: 'a', due: false }, { id: 'later', due: false }] as ReviewUnit[];
  assert.deepEqual(reviewQueue(after, 'b', ['a'], false, order).map(unit => unit.id), ['a', 'b']);
  assert.deepEqual(reviewQueue(after, 'b', [], false, order).map(unit => unit.id), ['b']);
  assert.deepEqual(reviewQueue(after, 'later', [], false, order).map(unit => unit.id), ['b', 'later']);
  assert.deepEqual(reviewQueue(after, 'b', [], true, order).map(unit => unit.id), ['a', 'b', 'later']);
  assert.deepEqual(reviewQueue([...after, { id: 'new', due: true } as ReviewUnit], 'b', [], false, order).map(unit => unit.id), ['b', 'new']);
});

test('stepping follows queue order and never wraps into a confirmation', () => {
  const ids = ['inbox', 'a', 'b'];
  assert.equal(reviewStep(ids, 'inbox', 1), 'a');
  assert.equal(reviewStep(ids, 'b', 1), '');
  assert.equal(reviewStep(ids, 'a', -1), 'inbox');
  assert.equal(reviewStep(ids, 'inbox', -1), 'inbox');
  assert.equal(reviewStep(ids, '', -1), 'b');
  assert.equal(reviewStep(ids, '', 1), '');
  assert.equal(reviewStep([], 'gone', 1), '');
});

test('after a confirmation the next due unit below is chosen before earlier ones', () => {
  const units = [{ id: 'a', due: true }, { id: 'b', due: false }, { id: 'c', due: true }, { id: 'd', due: true }] as ReviewUnit[];
  const order = ['a', 'b', 'c', 'd'];
  assert.equal(reviewAfter(order, units, [], 'b'), 'c');
  assert.equal(reviewAfter(order, units, ['c'], 'b'), 'd');
  assert.equal(reviewAfter(order, units, ['c', 'd'], 'b'), 'a');
  assert.equal(reviewAfter(order, units, ['a', 'c', 'd'], 'b'), '');
  assert.equal(reviewAfter(order, units, [], 'd'), 'a');
});

test('progress counts confirmed units against confirmed plus still due', () => {
  const units = [{ id: 'a', due: false }, { id: 'b', due: true }, { id: 'later', due: false }] as ReviewUnit[];
  assert.deepEqual(reviewProgress(units, ['a']), { done: 1, total: 2 });
  assert.deepEqual(reviewProgress(units, []), { done: 0, total: 1 });
  assert.deepEqual(reviewProgress([], []), { done: 0, total: 0 });
});

test('review dates are short and only show another year', () => {
  assert.equal(reviewDate('2026-11-17', '2026-11-10'), 'Nov 17');
  assert.equal(reviewDate('2027-02-10', '2026-11-10'), 'Feb 10, 2027');
  assert.equal(reviewDate('2026-11-17T08:00:00Z', '2026-11-10'), 'Nov 17');
  assert.equal(reviewDate(null, '2026-11-10'), '');
});
