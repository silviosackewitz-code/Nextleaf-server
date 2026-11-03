import { useState } from 'react';
import { appearanceKey, applyAppearance, loadAppearance, themes, type Appearance } from './appearance';

const labels = { dark: 'Dark', industrial: 'Industrial', terminal: 'Terminal', cappuccino: 'Cappuccino' };
const descriptions = { dark: 'Midnight & signal red', industrial: 'Graphite & safety orange', terminal: 'Tokyo Night & blue', cappuccino: 'Warm cream & espresso' };

export default function AppearanceSettings() {
  const [appearance, setAppearance] = useState(loadAppearance);
  const [error, setError] = useState('');
  function update(changes: Partial<Appearance>) {
    const next = { ...appearance, ...changes };
    setAppearance(next);
    applyAppearance(next);
    try { localStorage.setItem(appearanceKey, JSON.stringify(next)); setError(''); }
    catch { setError('This appearance is applied, but could not be saved on this device.'); }
  }
  return <section className="appearance" aria-labelledby="appearance-heading">
    <h3 id="appearance-heading">Appearance</h3>
    <div className="themechoices" role="group" aria-label="Theme">
      {themes.map(theme => <button key={theme} type="button" className="themechoice" aria-pressed={appearance.theme === theme} onClick={() => update({ theme })}>
        <span className="themepreview" data-theme={theme} aria-hidden="true"><i/><span><b/><i/><i/><i/></span></span>
        <strong>{labels[theme]}<span aria-hidden="true">{appearance.theme === theme ? '✓' : ''}</span></strong>
        <small>{descriptions[theme]}</small>
      </button>)}
    </div>
    <div className="fontchoice"><label htmlFor="appearance-font">Font</label><select id="appearance-font" value={appearance.font} onChange={event => update({ font: event.target.value as Appearance['font'] })}>
      <option value="plex">IBM Plex</option><option value="jetbrains">JetBrains Mono</option>
    </select></div>
    <p className="fontsample">A clear mind. A next action. <span>0123456789</span></p>
    <p className="appearancehint">Saved on this device. All fonts work offline.</p>
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
