import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarDays, dateKey } from '../src/calendar.ts';
test('calendar keeps local dates across leap years and year boundaries', () => {
  const leap = calendarDays(2028, 1).map(dateKey);
  assert.equal(leap.length, 42);
  assert.equal(new Set(leap).size, 42);
  assert.ok(leap.includes('2028-02-29'));
  assert.ok(calendarDays(2026, 11).map(dateKey).includes('2027-01-01'));
  assert.equal(calendarDays(2026, 9)[0].getDay(), 0);
});
