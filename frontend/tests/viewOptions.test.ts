import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureTarget, defaultDisplay, readDisplayOptions, viewGrouping } from '../src/viewOptions.ts';

test('New Item respects the selected destination and treats Focus as a flag', () => {
  assert.deepEqual(captureTarget('focus'), { status: 'next', starred: true });
  assert.deepEqual(captureTarget('waiting'), { status: 'waiting', starred: false });
  assert.deepEqual(captureTarget('completed'), { status: 'inbox', starred: false });
});
test('broken or outdated display preferences cannot hide fields accidentally', () => {
  for (const value of ['{', 'null', '[]', '{"next":null}', '{"next":{"project":false}}']) assert.deepEqual(readDisplayOptions(value), {});
  assert.deepEqual(readDisplayOptions('{"next":{"project":false,"tags":true,"due":true}}'), { next: { ...defaultDisplay, project: false } });
});


test('view grouping is scoped to Next and Focus, with project views kept unified', () => {
  assert.equal(viewGrouping('waiting', '', { ...defaultDisplay, grouping: 'state' }), 'unified');
  assert.equal(viewGrouping('scheduled', '', defaultDisplay), 'unified');
  assert.equal(viewGrouping('all', 'p1', defaultDisplay), 'unified');
  assert.equal(viewGrouping('next', '', { ...defaultDisplay, grouping: 'state' }), 'project');
  assert.equal(viewGrouping('focus', '', { ...defaultDisplay, grouping: 'sequential' }), 'unified');
  assert.equal(viewGrouping('focus', '', { ...defaultDisplay, grouping: 'state' }), 'state');
});
test('stored note and project limits validate old or corrupt values', () => {
  for (const value of [0, 10, -1, 1.5, 'all']) {
    const next = readDisplayOptions(JSON.stringify({ next: { ...defaultDisplay, projectLimit: value, notes: 'bad' } })).next;
    assert.equal(next.projectLimit, 3);
    assert.equal(next.notes, 'none');
  }
  assert.equal(readDisplayOptions(JSON.stringify({ next: { ...defaultDisplay, projectLimit: null, notes: 'full' } })).next.projectLimit, null);
});
