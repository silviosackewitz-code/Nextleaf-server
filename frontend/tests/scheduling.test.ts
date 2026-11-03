import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleChange, waitingChange, repeatChange, repeatPreview, stateLabel, type RepeatRule } from '../src/scheduling.ts';
const rule: RepeatRule = { id: 'id', frequency: 'monthly', interval: 1, start: '2027-01-31', until: null, due_days: null, paused: false };
test('start date and waiting choices are atomic and exit an old repeat cycle', () => {
  assert.deepEqual(scheduleChange('2026-10-20'), { status: 'scheduled', defer_until: '2026-10-20', recurrence: null, starred: false });
  assert.deepEqual(scheduleChange(null), { status: 'next', defer_until: null, recurrence: null });
  assert.deepEqual(waitingChange(' Contact '), { status: 'waiting', defer_until: null, recurrence: null, waiting_for: 'Contact' });
  assert.deepEqual(repeatChange(rule), { status: 'recurring', defer_until: null, recurrence: rule, starred: false });
});
test('repeat preview keeps the anchor day across short months and respects the end', () => {
  assert.deepEqual(repeatPreview(rule), ['2027-01-31', '2027-02-28', '2027-03-31']);
  assert.deepEqual(repeatPreview({ ...rule, until: '2027-02-28' }), ['2027-01-31', '2027-02-28']);
  assert.deepEqual(repeatPreview({ ...rule, frequency: 'weekly', start: '2026-10-18', interval: 2 }), ['2026-10-18', '2026-11-01', '2026-11-15']);
});

test('scheduled labels retain the date and use compact English month names', () => {
  for (const defer_until of ['2026-10-19', '2026-10-19T00:00:00Z']) {
    assert.equal(stateLabel({ status: 'scheduled', defer_until } as import('../src/api.ts').Task), 'Scheduled: Oct 19, 2026');
  }
});

test('completion and trash preserve start dates and repeat rules for reopening', async () => {
  const { stateChange } = await import('../src/scheduling.ts');
  assert.deepEqual(stateChange('completed'), { status: 'completed' });
  assert.deepEqual(stateChange('trash'), { status: 'trash' });
  assert.deepEqual(stateChange('next'), { status: 'next', defer_until: null, recurrence: null });
});
