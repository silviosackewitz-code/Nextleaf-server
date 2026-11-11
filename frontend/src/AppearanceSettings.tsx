import { useState } from 'react';
import { appearanceKey, applyAppearance, loadAppearance, themes, type Appearance } from './appearance';
import { t } from './i18n.ts';

const labels = { dark: 'Dark', industrial: 'Industrial', terminal: 'Terminal', cappuccino: 'Cappuccino' };
const descriptions = { dark: 'Midnight & teal', industrial: 'Graphite & safety orange', terminal: 'Tokyo Night & blue', cappuccino: 'Warm cream & espresso' };

export default function AppearanceSettings() {
  const [appearance, setAppearance] = useState(loadAppearance);
  const [error, setError] = useState('');
  function update(changes: Partial<Appearance>) {
    const next = { ...appearance, ...changes };
    setAppearance(next);
    applyAppearance(next);
    try { localStorage.setItem(appearanceKey, JSON.stringify(next)); setError(''); }
    catch { setError(t('This appearance is applied, but could not be saved on this device.')); }
  }
  return <>
    <p className="settingshint">{t('Saved on this device. All fonts work offline.')}</p>
    <h3 id="appearance-theme">{t('Theme')}</h3>
    <div className="themechoices" role="group" aria-labelledby="appearance-theme">
      {themes.map(theme => <button key={theme} type="button" className="themechoice" aria-pressed={appearance.theme === theme} onClick={() => update({ theme })}>
        <span className="themepreview" data-theme={theme} aria-hidden="true"><i/><span><b/><i/><i/><i/></span></span>
        <strong>{t(labels[theme])}<span aria-hidden="true">{appearance.theme === theme ? '✓' : ''}</span></strong>
        <small>{t(descriptions[theme])}</small>
      </button>)}
    </div>
    <div className="settingscard">
      <div className="settingsrow"><label className="settingsrowtitle" htmlFor="appearance-font">{t('Font')}</label><select id="appearance-font" className="dropdownfield settingsfield" value={appearance.font} onChange={event => update({ font: event.target.value as Appearance['font'] })}>
        <option value="plex">IBM Plex</option><option value="jetbrains">JetBrains Mono</option>
      </select></div>
      <p className="settingsrow fontsample">{t('A clear mind. A next action.')} <span>0123456789</span></p>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
  </>;
}
