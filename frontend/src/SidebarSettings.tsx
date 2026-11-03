import type { Perspective } from './perspectives';
import type { SidebarPreferences } from './sidebarPreferences';

export default function SidebarSettings({ preferences, onChange, views, perspectives, busy, error, onOpen, onEdit, onNew, onCapture, captureTitle }: {
  preferences: SidebarPreferences; onChange: (value: SidebarPreferences) => void;
  views: { view: string; title: string }[]; perspectives: Perspective[];
  busy: boolean; error: string; onOpen: (id: string) => void; onEdit: (p: Perspective) => void;
  onNew: () => void; onCapture: () => void; captureTitle?: string;
}) {
  return <section className="sidebarsettings" aria-labelledby="sidebar-settings-heading">
    <h3 id="sidebar-settings-heading">Sidebar</h3>
    <p>Choose your everyday views. Saved on this device.</p>
    <fieldset disabled={busy}><legend>Task views</legend><div className="sidebarviewchoices">
      {views.map(({ view, title }) => <label key={view}><input type="checkbox" checked={!preferences.hiddenViews.includes(view)} onChange={e => onChange({ ...preferences, hiddenViews: e.target.checked ? preferences.hiddenViews.filter(v => v !== view) : [...preferences.hiddenViews, view] })}/>{title}</label>)}
    </div></fieldset>
    <h4>Perspectives</h4>
    <p>Select the Perspectives you want in your sidebar. Use Edit to change their icon or rules.</p>
    <div className="sidebarperspectives">
      {perspectives.map(p => <div className="sidebarperspectiverow" key={p.id}>
        <label><input type="checkbox" disabled={busy} aria-label={`Show ${p.name} in sidebar`} checked={preferences.perspectiveIds.includes(p.id)} onChange={e => onChange({ ...preferences, perspectiveIds: e.target.checked ? [...preferences.perspectiveIds, p.id] : preferences.perspectiveIds.filter(id => id !== p.id) })}/><span aria-hidden="true">{p.definition.icon}</span><span>{p.name}</span></label>
        <div><button disabled={busy} aria-label={`Open Perspective: ${p.name}`} onClick={() => onOpen(p.id)}>Open</button><button disabled={busy} aria-label={`Edit Perspective: ${p.name}`} onClick={() => onEdit(p)}>Edit</button></div>
      </div>)}
      {!perspectives.length && <p>No saved Perspectives yet.</p>}
    </div>
    <div className="sidebarsettingsactions"><button disabled={busy} onClick={onNew}>New Perspective…</button>{captureTitle && <button disabled={busy} onClick={onCapture}>Save {captureTitle} as Perspective…</button>}</div>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
