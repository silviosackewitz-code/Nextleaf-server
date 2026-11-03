import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskChanges, taskExpected } from '../src/taskEdit.ts';
import type { Task } from '../src/api.ts';
const task = {title:'Title',notes:'Notes',status:'next',tags:['Laptop'],project_id:'project',area_id:'area',starred:false,estimated_minutes:45,energy:0,defer_until:'2026-10-17T10:30:00Z',due_date:null,waiting_for:null} as Task;

test('partial edits preserve untouched fields and imported timestamps', () => {
  assert.deepEqual(taskChanges(task,{...task,notes:'Updated'}),{notes:'Updated'});
  assert.deepEqual(taskChanges(task,{...task,tags:[...task.tags]}),{});
});
test('clearing relationships, tags, and effort is explicit', () => {
  assert.deepEqual(taskChanges(task,{...task,project_id:null,area_id:null,tags:[],estimated_minutes:null,energy:null}),{project_id:null,area_id:null,tags:[],estimated_minutes:null,energy:null});
});

test('editor preconditions preserve its original changed fields, including nulls and arrays', () => {
  const changes = taskChanges(task, { ...task, notes: 'My edit', due_date: '2026-11-01', tags: [] });
  assert.deepEqual(taskExpected(task, changes), { notes: 'Notes', due_date: null, tags: ['Laptop'] });
  assert.deepEqual(taskExpected(task, {}), {});
});
