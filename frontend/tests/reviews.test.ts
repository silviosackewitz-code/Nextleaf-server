import test from 'node:test';
import assert from 'node:assert/strict';
import { initialReview, nextReview, reviewTaskGroups, type ReviewUnit } from '../src/reviews.ts';
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
