import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quickChoices, submenuPosition } from '../src/quickMenu.ts';
import type { Task, Project } from '../src/api.ts';
const task = { project_id: 'p', area_id: null, tags: ['Laptop'], energy: 0, estimated_minutes: 17, status: 'next' } as Task;
test('quick choices patch only the selected field and preserve unrelated task data', () => {
  assert.deepEqual(quickChoices('Energy', task, [], [], [])[0], { label: 'None', checked: true, changes: { energy: null } });
  assert.deepEqual(quickChoices('Time', task, [], [], []).find(c => c.checked)?.changes, { estimated_minutes: 17 });
  assert.deepEqual(quickChoices('Project', task, [{ id: 'q', name: 'New', status: 'active' } as Project], [], [])[1].changes, { project_id: 'q', area_id: null });
  assert.deepEqual(quickChoices('Tags', task, [], [], ['Laptop', 'Phone'])[0].changes, { tags: [] });
  assert.deepEqual(quickChoices('Tags', task, [], [], ['Laptop', 'Phone'])[1].changes, { tags: ['Laptop', 'Phone'] });
});
test('submenu opens adjacent on the left and stays inside short or narrow windows', () => {
  assert.deepEqual(submenuPosition({ left: 1000, right: 1200 }, 600, 200, 300, { width: 1280, height: 720 }), { left: 800, top: 412 });
  assert.deepEqual(submenuPosition({ left: 100, right: 300 }, 10, 200, 300, { width: 320, height: 600 }), { left: 112, top: 10 });
});

test('archived areas stay visible only for an existing assignment', () => {
  const areas = [
    { id: 'active', name: 'Active', archived: false, sort_order: 0 },
    { id: 'old', name: 'Old', archived: true, sort_order: 1 },
    { id: 'other', name: 'Other archived', archived: true, sort_order: 2 },
  ];
  assert.deepEqual(quickChoices('Area', { ...task, area_id: 'old' }, [], areas, []).map(choice => choice.label), ['No area', 'Active', 'Old']);
  assert.deepEqual(quickChoices('Area', task, [], areas, []).map(choice => choice.label), ['No area', 'Active']);
});

test('contact choices preserve legacy free text and deduplicate existing people', () => {
  const waiting = { ...task, waiting_for: 'Legacy contact' };
  const choices = quickChoices('Waiting for', waiting, [], [], [], ['Alice', 'Alice']);
  assert.deepEqual(choices, [
    { label: 'Alice', checked: false, changes: { waiting_for: 'Alice' } },
    { label: 'Legacy contact', checked: true, changes: { waiting_for: 'Legacy contact' } },
  ]);
  assert.deepEqual(quickChoices('Waiting for', { ...waiting, waiting_for: 'Alice' }, [], [], [], ['Alice']).map(choice => choice.label), ['Alice']);
});
