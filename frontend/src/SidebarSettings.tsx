import Icon, { type IconName } from './icons';
import type { Perspective } from './perspectives';
import type { SidebarPreferences } from './sidebarPreferences';
import { t } from './i18n.ts';

export default function SidebarSettings({ preferences, onChange, views, perspectives, busy, error, onOpen, onEdit, onNew, onCapture, captureTitle }: {
  preferences: SidebarPreferences; onChange: (value: SidebarPreferences) => void;
  views: { view: string; title: string; icon: IconName }[]; perspectives: Perspective[];
  busy: boolean; error: string; onOpen: (id: string) => void; onEdit: (p: Perspective) => void;
  onNew: () => void; onCapture: () => void; captureTitle?: string;
}) {
  return <>
    <p className="settingshint">{t('Choose your everyday views. Saved on this device.')}</p>
    <h3 id="sidebar-task-views">{t('Task views')}</h3>
    <div className="settingscard" role="group" aria-labelledby="sidebar-task-views">
      {views.map(({ view, title, icon }) => <label className="settingsrow" key={view}>
        <span className="navsymbol" aria-hidden="true"><Icon name={icon}/></span><span className="settingsrowtitle">{title}</span>
        <input type="checkbox" role="switch" className="switch" disabled={busy} checked={!preferences.hiddenViews.includes(view)} onChange={e => onChange({ ...preferences, hiddenViews: e.target.checked ? preferences.hiddenViews.filter(v => v !== view) : [...preferences.hiddenViews, view] })}/>
      </label>)}
    </div>
    <h3 id="sidebar-perspectives">{t('Perspectives')}</h3>
    <p className="settingshint">{t('Select the Perspectives you want in your sidebar. Use Edit to change their icon or rules.')}</p>
    <div className="settingscard" role="group" aria-labelledby="sidebar-perspectives">
      {perspectives.map(p => <div className="settingsrow" key={p.id}>
        <span className="navsymbol" aria-hidden="true">{p.definition.icon}</span><span className="settingsrowtitle">{p.name}</span>
        <button className="settingsbutton quiet" disabled={busy} aria-label={t('Open Perspective: {name}', { name: p.name })} onClick={() => onOpen(p.id)}>{t('Open')}</button>
        <button className="settingsbutton quiet" disabled={busy} aria-label={t('Edit Perspective: {name}', { name: p.name })} onClick={() => onEdit(p)}>{t('Edit')}</button>
        <input type="checkbox" role="switch" className="switch" disabled={busy} aria-label={t('Show {name} in sidebar', { name: p.name })} checked={preferences.perspectiveIds.includes(p.id)} onChange={e => onChange({ ...preferences, perspectiveIds: e.target.checked ? [...preferences.perspectiveIds, p.id] : preferences.perspectiveIds.filter(id => id !== p.id) })}/>
      </div>)}
      {!perspectives.length && <p className="settingsrow settingshint">{t('No saved Perspectives yet.')}</p>}
    </div>
    <div className="settingsactions">
      <button className="settingsbutton" disabled={busy} onClick={onNew}>{t('New Perspective…')}</button>
      {captureTitle && <button className="settingsbutton" disabled={busy} onClick={onCapture}>{t('Save {name} as Perspective…', { name: captureTitle })}</button>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </>;
}
