import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, detectLocale, setLocale, statusName, t, translate } from '../src/i18n.ts';
import { stateLabel } from '../src/scheduling.ts';
import type { Task } from '../src/api';

test('device languages choose Mexican Spanish for any Spanish preference and English otherwise', () => {
  assert.equal(detectLocale(['es-MX']), 'es-MX');
  assert.equal(detectLocale(['es', 'en-US']), 'es-MX');
  assert.equal(detectLocale(['de-DE', 'es-ES']), 'es-MX');
  assert.equal(detectLocale(['en-GB', 'es-MX']), 'en');
  assert.equal(detectLocale(['de-DE']), 'en');
  assert.equal(detectLocale([]), 'en');
});

test('missing translations fall back to English and placeholders are filled', () => {
  assert.equal(translate('es-MX', 'Not a catalog entry'), 'Not a catalog entry');
  assert.equal(translate('en', '{n} tasks', { n: 3 }), '3 tasks');
  assert.equal(translate('es-MX', '{n} tasks', { n: 3 }), '3 tareas');
  assert.equal(translate('es-MX', 'Keep {missing}', {}), 'Keep {missing}');
});

test('every Spanish entry keeps the placeholders of its English source', () => {
  const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [source, text] of Object.entries(catalog('es-MX'))) {
    assert.ok(text.trim(), `empty translation for ${source}`);
    assert.deepEqual(names(text), names(source), source);
  }
});

test('active locale changes task labels', () => {
  const task = { status: 'waiting', waiting_for: 'Ana', recurrence: null, defer_until: null } as unknown as Task;
  try {
    setLocale('es-MX');
    assert.equal(t('Inbox'), 'Bandeja de entrada');
    assert.equal(statusName('someday'), 'Algún día');
    assert.equal(stateLabel(task), 'En espera · Ana');
  } finally { setLocale('en'); }
  assert.equal(stateLabel(task), 'Waiting · Ana');
});
