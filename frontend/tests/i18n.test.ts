import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, dateLocale, detectLocale, setLocale, statusName, t, translate, weekStart } from '../src/i18n.ts';
import { calendarDays, dateKey, weekdayKeys } from '../src/calendar.ts';
import { reviewDate } from '../src/reviews.ts';
import { stateLabel } from '../src/scheduling.ts';
import type { Task } from '../src/api';

test('device languages choose the first supported language: Mexican Spanish for any Spanish, German for any German', () => {
  assert.equal(detectLocale(['es-MX']), 'es-MX');
  assert.equal(detectLocale(['es', 'en-US']), 'es-MX');
  assert.equal(detectLocale(['de-DE', 'es-ES']), 'de');
  assert.equal(detectLocale(['es-ES', 'de-DE']), 'es-MX');
  assert.equal(detectLocale(['en-GB', 'es-MX']), 'en');
  assert.equal(detectLocale(['en-GB', 'de-DE']), 'en');
  assert.equal(detectLocale(['de-DE']), 'de');
  assert.equal(detectLocale(['de']), 'de');
  assert.equal(detectLocale(['de-AT']), 'de');
  assert.equal(detectLocale(['DE-ch']), 'de');
  assert.equal(detectLocale(['fr-FR', 'de-DE']), 'de');
  assert.equal(detectLocale(['fr-FR']), 'en');
  assert.equal(detectLocale([]), 'en');
});

test('date formatting follows the active locale', () => {
  try {
    setLocale('en'); assert.equal(dateLocale(), 'en-US'); assert.equal(weekStart(), 0);
    setLocale('es-MX'); assert.equal(dateLocale(), 'es-MX'); assert.equal(weekStart(), 0);
    setLocale('de');
    assert.equal(dateLocale(), 'de-DE');
    assert.equal(weekStart(), 1);
    assert.equal(reviewDate('2026-11-05', '2026-01-01'), '5. Nov.');
    assert.equal(reviewDate('2027-03-05', '2026-01-01'), '5. März 2027');
    assert.deepEqual(weekdayKeys(weekStart()).map(day => t(day)), ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
  } finally { setLocale('en'); }
});

test('the calendar starts on Sunday or Monday and still covers the whole month', () => {
  assert.deepEqual(weekdayKeys(0), ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
  assert.deepEqual(weekdayKeys(1), ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
  for (const [year, month] of [[2026, 10], [2026, 1], [2028, 1], [2027, 7]]) {
    const monday = calendarDays(year, month, 1);
    assert.equal(monday[0].getDay(), 1);
    assert.ok(monday.map(dateKey).includes(dateKey(new Date(year, month, 1, 12))));
    assert.ok(monday.map(dateKey).includes(dateKey(new Date(year, month + 1, 0, 12))));
  }
  // November 2026 begins on a Sunday: a Monday week shows six days of October first.
  assert.equal(dateKey(calendarDays(2026, 10, 1)[0]), '2026-10-26');
  assert.equal(dateKey(calendarDays(2026, 10, 0)[0]), '2026-11-01');
});

test('missing translations fall back to English and placeholders are filled', () => {
  assert.equal(translate('es-MX', 'Not a catalog entry'), 'Not a catalog entry');
  assert.equal(translate('en', '{n} tasks', { n: 3 }), '3 tasks');
  assert.equal(translate('es-MX', '{n} tasks', { n: 3 }), '3 tareas');
  assert.equal(translate('es-MX', 'Keep {missing}', {}), 'Keep {missing}');
});

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('every Spanish and German entry keeps the placeholders of its English source', () => {
  for (const target of ['es-MX', 'de'] as const) {
    for (const [source, text] of Object.entries(catalog(target))) {
      assert.ok(text.trim(), `empty ${target} translation for ${source}`);
      assert.deepEqual(placeholders(text), placeholders(source), `${target}: ${source}`);
    }
  }
});

test('the German and Spanish catalogs have the same keys in the same order', () => {
  const spanish = Object.keys(catalog('es-MX'));
  const german = Object.keys(catalog('de'));
  assert.deepEqual(german.filter(key => !spanish.includes(key)), [], 'only in de.ts');
  assert.deepEqual(spanish.filter(key => !german.includes(key)), [], 'only in es-MX.ts');
  assert.deepEqual(german, spanish);
});

test('the German interface uses the informal address', () => {
  for (const [source, text] of Object.entries(catalog('de'))) {
    assert.doesNotMatch(text, /\b(Sie|Ihnen)\b/, source);
  }
});

test('active locale changes task labels', () => {
  const task = { status: 'waiting', waiting_for: 'Ana', recurrence: null, defer_until: null } as unknown as Task;
  try {
    setLocale('es-MX');
    assert.equal(t('Inbox'), 'Bandeja de entrada');
    assert.equal(statusName('someday'), 'Algún día');
    assert.equal(stateLabel(task), 'En espera · Ana');
    setLocale('de');
    assert.equal(t('Inbox'), 'Eingang');
    assert.equal(statusName('next'), 'Als Nächstes');
    assert.equal(stateLabel(task), 'Warten auf Ana');
    assert.equal(translate('de', '{n} tasks', { n: 3 }), '3 Aufgaben');
  } finally { setLocale('en'); }
  assert.equal(stateLabel(task), 'Waiting · Ana');
});
