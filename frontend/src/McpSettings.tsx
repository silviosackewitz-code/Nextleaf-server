import { useEffect, useState } from 'react';
import { api } from './api';
import { presetPermissions, type McpAccess, type McpPolicy, type McpPreset } from './mcpPermissions';
import { t } from './i18n.ts';

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
  return <>
    <p className="settingshint">{t('Controls agents connected to this server.')} {t('These permissions are not synchronized.')}</p>
    {draft && access && <fieldset className="settingsfieldset" disabled={busy}><div className="settingsstack">
      <div className="settingscard">
        <label className="settingsrow"><span className="settingsrowtitle">{t('Allow MCP access')}</span><input type="checkbox" role="switch" className="switch" checked={draft.enabled} onChange={e => change({ ...draft, enabled: e.target.checked })}/></label>
        <div className="settingsrow mcppresetrow">
          <div className="segmented" role="group" aria-label={t('MCP permission presets')}>
            {([['read', 'Read only'], ['capture', 'Capture only'], ['tasks', 'Tasks only'], ['full', 'Full access']] as [McpPreset, string][]).map(([value, label]) =>
              <button type="button" key={value} aria-pressed={JSON.stringify([...draft.allowed].sort()) === JSON.stringify(presetPermissions(value, access.permissions).sort())} onClick={() => change({ ...draft, allowed: presetPermissions(value, access.permissions) })}>{t(label)}</button>)}
          </div>
          <p className="settingshint">{t('Capture only allows reading and creating tasks. Tasks only also allows editing, completing and moving tasks to Trash. Existing tags and projects can still be assigned.')}</p>
        </div>
        <details><summary className="settingsrow">{t('Individual permissions')}</summary><div className="mcppermissiongroups">
          {[...new Set(access.permissions.map(p => p.group))].map(group => <div key={group}><h4>{t(group)}</h4>
            {access.permissions.filter(p => p.group === group).map(p => <label className="mcpcheck" key={p.id}>
              <input type="checkbox" checked={draft.allowed.includes(p.id)} onChange={e => change({ ...draft, allowed: e.target.checked ? [...draft.allowed, p.id] : draft.allowed.filter(id => id !== p.id) })}/>{t(p.label)}
            </label>)}
          </div>)}
        </div></details>
      </div>
      <p className="settingshint">{t('Rights apply to every MCP client on this installation. New calls use saved permissions immediately; already running calls may finish. Projects and tasks can only be moved to Trash; permanent deletion is unavailable. Agents cannot change these settings.')}</p>
      <div className="settingsactions"><button type="button" className="settingsbutton primary" disabled={!dirty} onClick={() => void save()}>{t('Save MCP permissions')}</button><button type="button" className="settingsbutton" onClick={() => void load()}>{t('Reload saved permissions')}</button></div>
    </div></fieldset>}
    {!draft && <div className="settingsactions"><button type="button" className="settingsbutton" disabled={busy} onClick={() => void load()}>{t('Reload MCP permissions')}</button></div>}
    {error && <p role="alert" className="error">{error}</p>}
    {saved && <p role="status" className="settingshint">{t('MCP permissions saved.')}</p>}
  </>;
}
