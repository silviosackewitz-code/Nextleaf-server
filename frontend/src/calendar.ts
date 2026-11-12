export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
/** Six weeks of local dates around a month; `firstWeekday` is 0 for Sunday or 1 for Monday. */
export function calendarDays(year: number, month: number, firstWeekday: 0 | 1 = 0): Date[] {
  const first = new Date(year, month, 1, 12);
  const lead = (first.getDay() - firstWeekday + 7) % 7;
  return Array.from({ length: 42 }, (_, day) => new Date(year, month, day + 1 - lead, 12));
}
/** English short weekday names, the translation keys, in calendar column order. */
export function weekdayKeys(firstWeekday: 0 | 1 = 0): string[] {
  const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  return [...days.slice(firstWeekday), ...days.slice(0, firstWeekday)];
}
