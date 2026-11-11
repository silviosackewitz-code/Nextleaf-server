/** Desktop always shows one section; a phone starts on the section list. */
export function activeSection(ids: readonly string[], requested: string | null, mobile: boolean): string | null {
  if (requested !== null && ids.includes(requested)) return requested;
  return mobile ? null : ids[0] ?? null;
}
