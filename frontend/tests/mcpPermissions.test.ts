import test from 'node:test';
import assert from 'node:assert/strict';
import { presetPermissions } from '../src/mcpPermissions.ts';

test('MCP presets never grant metadata, project or Perspective writes through task presets', () => {
  const ids = ['read', 'tasks.create', 'tasks.edit', 'tasks.trash', 'projects.edit', 'tags.create', 'perspectives.edit', 'import'];
  const permissions = ids.map(id => ({ id, label: id, group: '' }));
  assert.deepEqual(presetPermissions('read', permissions), ['read']);
  assert.deepEqual(presetPermissions('capture', permissions), ['read', 'tasks.create']);
  assert.deepEqual(presetPermissions('tasks', permissions), ['read', 'tasks.create', 'tasks.edit', 'tasks.trash']);
  assert.deepEqual(presetPermissions('full', permissions), ids);
});
