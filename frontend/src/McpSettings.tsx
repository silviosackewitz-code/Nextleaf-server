import { useEffect, useState } from 'react';
import { api } from './api';
import { presetPermissions, type McpAccess, type McpPolicy, type McpPreset } from './mcpPermissions';

export default function McpSettings() {
  const [access, setAccess] = useState<McpAccess | null>(null);
  const [draft, setDraft] = useState<McpPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function load() {
    setBusy(true); setError(''); setSaved(false);
    try { const value = await api.mcpAccess(); setAccess(value); setDraft(value.policy); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  function change(next: McpPolicy) { setDraft(next); setSaved(false); }
  async function save() {
    if (!draft || !access) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const policy = await api.saveMcpAccess(draft);
      setDraft(policy); setAccess({ ...access, policy }); setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const dirty = !!access && !!draft && JSON.stringify(access.policy) !== JSON.stringify(draft);
  return <section className="mcpaccess" aria-labelledby="mcp-access-heading">
    <h3 id="mcp-access-heading">MCP access</h3>
    <p>Controls agents connected to this server. These permissions are not synchronized.</p>
    {draft && access && <fieldset disabled={busy}>
      <label className="mcpcheck"><input type="checkbox" checked={draft.enabled} onChange={e => change({ ...draft, enabled: e.target.checked })}/>Allow MCP access</label>
      <div className="mcppresets" role="group" aria-label="MCP permission presets">
        {([['read', 'Read only'], ['capture', 'Capture only'], ['tasks', 'Tasks only'], ['full', 'Full access']] as [McpPreset, string][]).map(([value, label]) =>
          <button type="button" key={value} aria-pressed={JSON.stringify([...draft.allowed].sort()) === JSON.stringify(presetPermissions(value, access.permissions).sort())} onClick={() => change({ ...draft, allowed: presetPermissions(value, access.permissions) })}>{label}</button>)}
      </div>
      <p className="appearancehint">Capture only allows reading and creating tasks. Tasks only also allows editing, completing and moving tasks to Trash. Existing tags and projects can still be assigned.</p>
      <details><summary>Individual permissions</summary><div className="mcppermissiongroups">
        {[...new Set(access.permissions.map(p => p.group))].map(group => <div key={group}><h4>{group}</h4>
          {access.permissions.filter(p => p.group === group).map(p => <label className="mcpcheck" key={p.id}>
            <input type="checkbox" checked={draft.allowed.includes(p.id)} onChange={e => change({ ...draft, allowed: e.target.checked ? [...draft.allowed, p.id] : draft.allowed.filter(id => id !== p.id) })}/>{p.label}
          </label>)}
        </div>)}
      </div></details>
      <p className="appearancehint">Rights apply to every MCP client on this installation. New calls use saved permissions immediately; already running calls may finish. Project deletion and permanent task deletion are unavailable. Agents cannot change these settings.</p>
      <div className="mcpactions"><button type="button" disabled={!dirty} onClick={() => void save()}>Save MCP permissions</button><button type="button" onClick={() => void load()}>Reload saved permissions</button></div>
    </fieldset>}
    {!draft && <button type="button" disabled={busy} onClick={() => void load()}>Reload MCP permissions</button>}
    {error && <p role="alert" className="error">{error}</p>}
    {saved && <p role="status">MCP permissions saved.</p>}
  </section>;
}
