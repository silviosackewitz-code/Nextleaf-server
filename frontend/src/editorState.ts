export type EditorState<T> = { original: T; draft: T };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function refreshEditor<T>(editor: EditorState<T>, latest: T, fields: readonly (keyof T)[]): EditorState<T> {
  const original = { ...editor.original }, draft = { ...editor.draft };
  for (const field of fields) {
    if (equal(original[field], draft[field]) || equal(draft[field], latest[field])) {
      original[field] = latest[field]; draft[field] = latest[field];
    }
  }
  return { original, draft };
}
export function editorConflicts<T>(editor: EditorState<T>, latest: T, fields: readonly (keyof T)[]): (keyof T)[] {
  return fields.filter(field => !equal(editor.original[field], editor.draft[field]) && !equal(editor.original[field], latest[field]) && !equal(editor.draft[field], latest[field]));
}
