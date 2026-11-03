export type McpPolicy = { enabled: boolean; allowed: string[]; revision: number };
export type McpPermission = { id: string; label: string; group: string };
export type McpAccess = { policy: McpPolicy; permissions: McpPermission[] };
export type McpPreset = 'read' | 'capture' | 'tasks' | 'full';
export function presetPermissions(preset: McpPreset, permissions: McpPermission[]): string[] {
  return permissions.filter(({ id }) => preset === 'full' || id === 'read'
    || preset === 'capture' && id === 'tasks.create'
    || preset === 'tasks' && id.startsWith('tasks.')).map(({ id }) => id);
}
