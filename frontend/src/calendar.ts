export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function calendarDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1, 12);
  return Array.from({ length: 42 }, (_, day) => new Date(year, month, day + 1 - first.getDay(), 12));
}
