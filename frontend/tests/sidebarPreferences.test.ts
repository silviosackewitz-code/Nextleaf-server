import test from 'node:test';
import assert from 'node:assert/strict';
import { readSidebarPreferences } from '../src/sidebarPreferences.ts';

test('sidebar preferences recover from invalid storage and keep essential navigation available', () => {
  const defaults = { hiddenViews: [], perspectiveIds: [] };
  for (const raw of [null, '{', 'null', '[]', '42', 'true', '"text"']) assert.deepEqual(readSidebarPreferences(raw), defaults);
  assert.deepEqual(readSidebarPreferences(JSON.stringify({ hiddenViews: ['inbox', 'settings', 'projects', 'completed', 'unknown', null], perspectiveIds: false })), defaults);
});

test('sidebar choices survive serialization, deduplicate and tolerate missing Perspectives', () => {
  const prefs = readSidebarPreferences(JSON.stringify({ hiddenViews: ['next', 'someday', 'review', 'next', 4], perspectiveIds: ['saved-view', 'not-loaded-yet', 'saved-view', '', null] }));
  assert.deepEqual(prefs, { hiddenViews: ['next', 'someday', 'review'], perspectiveIds: ['saved-view', 'not-loaded-yet'] });
  assert.deepEqual(readSidebarPreferences(JSON.stringify(prefs)), prefs);
  assert.deepEqual(readSidebarPreferences('{"hiddenViews":false,"perspectiveIds":["p"]}'), { hiddenViews: [], perspectiveIds: ['p'] });
});
