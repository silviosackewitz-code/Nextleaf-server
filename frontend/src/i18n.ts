import { esMX } from './locales/es-MX.ts';

// English source text is the translation key. A missing translation falls back to
// English, so new text never breaks the interface.
export type Locale = 'en' | 'es-MX';

const catalogs: Record<Exclude<Locale, 'en'>, Record<string, string>> = { 'es-MX': esMX };

export function detectLocale(languages: readonly string[] | undefined): Locale {
  for (const language of languages ?? []) {
    const tag = language.toLowerCase();
    if (tag.startsWith('es')) return 'es-MX';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

function deviceLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

let current: Locale = detectLocale(deviceLanguages());

export function locale(): Locale { return current; }
export function setLocale(next: Locale) { current = next; }

/** BCP 47 tag for Intl and toLocale* date formatting. */
export function dateLocale(): string { return current === 'es-MX' ? 'es-MX' : 'en-US'; }

export function translate(target: Locale, source: string, vars?: Record<string, string | number>): string {
  const text = target === 'en' ? source : catalogs[target][source] ?? source;
  return vars ? text.replace(/\{(\w+)\}/g, (match, key: string) => key in vars ? String(vars[key]) : match) : text;
}

export function t(source: string, vars?: Record<string, string | number>): string {
  return translate(current, source, vars);
}

export function catalog(target: Exclude<Locale, 'en'>): Readonly<Record<string, string>> { return catalogs[target]; }

const statusNames: Record<string, string> = { inbox: 'Inbox', next: 'Next', waiting: 'Waiting', scheduled: 'Scheduled', someday: 'Someday', later: 'Later', completed: 'Completed', trash: 'Trash', recurring: 'Recurring' };
/** Display name of a task or project status. */
export function statusName(status: string): string {
  return t(statusNames[status] ?? (status ? status[0].toUpperCase() + status.slice(1) : status));
}
