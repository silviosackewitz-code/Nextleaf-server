import { UNTAGGED } from '../src/taskList.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectChanges, projectRows, projectExpected } from '../src/projectEdit.ts';
import type { Project, Task } from '../src/api.ts';
const project: Project = { id: 'p', name: 'Project', notes: 'Keep', area_id: 'a', project_type: 'parallel', status: 'active', completed_at: null, sort_order: 100, due_date: null, starred: false, tags: ['Work'] };
test('project edits send only changed fields, including clears', () => {
  assert.deepEqual(projectChanges(project, { ...project, area_id: null, project_type: 'sequential', tags: [] }), { area_id: null, project_type: 'sequential', tags: [] });
  assert.deepEqual(projectChanges(project, { ...project }), {});
});
test('overview includes empty projects, counts unfinished actions, and filters project tags', () => {
  const rows = ['next', 'waiting', 'completed', 'trash', 'recurring'].map(status => ({ project_id: 'p', status })) as Task[];
  const empty = { ...project, id: 'empty', tags: [] };
  assert.deepEqual(projectRows([empty, project], rows, null).map(row => row.count), [0, 2]);
  assert.deepEqual(projectRows([empty, project], rows, 'Work').map(row => row.project.id), ['p']);
  assert.deepEqual(projectRows([empty, project], rows, UNTAGGED).map(row => row.project.id), ['empty']);
});

test('project editor sends original values only for changed fields', () => {
  const changes = projectChanges(project, { ...project, project_type: 'sequential', tags: [], due_date: '2026-11-01' });
  assert.deepEqual(projectExpected(project, changes), { project_type: 'parallel', due_date: null, tags: ['Work'] });
});
