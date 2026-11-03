import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshEditor, editorConflicts } from '../src/editorState.ts';

test('clean fields refresh while unsaved drafts and their expected values survive reloads', () => {
  const original = { title: 'Before', notes: 'Notes' };
  const editor = { original, draft: { ...original, title: 'My draft' } };
  const latest = { title: 'Their title', notes: 'Fresh notes' };
  const refreshed = refreshEditor(editor, latest, ['title', 'notes']);
  assert.deepEqual(refreshed, { original: { title: 'Before', notes: 'Fresh notes' }, draft: { title: 'My draft', notes: 'Fresh notes' } });
  assert.deepEqual(editorConflicts(refreshed, latest, ['title', 'notes']), ['title']);
  const accepted = { ...refreshed, original: latest };
  assert.deepEqual(editorConflicts(accepted, latest, ['title', 'notes']), []);
});
test('unchanged editors and matching concurrent edits rebase without false conflicts', () => {
  const latest = { title: 'New' };
  assert.deepEqual(refreshEditor({ original: { title: 'Old' }, draft: { title: 'Old' } }, latest, ['title']), { original: latest, draft: latest });
  assert.deepEqual(refreshEditor({ original: { title: 'Old' }, draft: latest }, latest, ['title']), { original: latest, draft: latest });
});
