import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSection } from '../src/settingsSections.ts';

test('desktop always shows a section and a phone starts on the section list', () => {
  const ids = ['sidebar', 'appearance', 'sync'];
  assert.equal(activeSection(ids, null, false), 'sidebar');
  assert.equal(activeSection(ids, null, true), null);
  assert.equal(activeSection(ids, 'sync', false), 'sync');
  assert.equal(activeSection(ids, 'sync', true), 'sync');
});

test('a section that is unavailable on this device falls back safely', () => {
  // MCP access is hidden on phones, and a web client has no license section.
  assert.equal(activeSection(['sidebar', 'sync'], 'mcp', false), 'sidebar');
  assert.equal(activeSection(['sidebar', 'sync'], 'mcp', true), null);
  assert.equal(activeSection([], null, false), null);
});
