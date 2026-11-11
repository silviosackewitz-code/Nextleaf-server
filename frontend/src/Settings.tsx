import { useEffect, useRef, type ReactNode } from 'react';
import Icon, { type IconName } from './icons';
import { activeSection } from './settingsSections';
import { t } from './i18n.ts';
import './Settings.css';

export type SettingsSection = { id: string; title: string; icon: IconName; content: ReactNode };

/**
 * Desktop shows the section list beside one section. A phone shows the list first
 * and opens one section at a time. Every section stays mounted so unsaved input
 * in one section survives a visit to another.
 */
export default function Settings({ sections, section, onSection, mobile, onOpenNavigation }: {
  sections: SettingsSection[]; section: string | null; onSection: (id: string | null) => void;
  mobile: boolean; onOpenNavigation: () => void;
}) {
  const active = activeSection(sections.map(s => s.id), section, mobile);
  const current = sections.find(s => s.id === active);
  const detail = mobile && !!current;
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(active);
  useEffect(() => {
    if (shown.current === active) return;
    shown.current = active;
    if (!mobile) return;
    window.scrollTo(0, 0);
    heading.current?.focus();
  }, [active, mobile]);
  return <>
    <header className="topbar">
      {mobile && (detail
        ? <button className="settingsback" aria-label={t('Back to Settings')} onClick={() => onSection(null)}><span aria-hidden="true">‹</span>{t('Settings')}</button>
        : <button className="iconbutton navigationtrigger" aria-label={t('Open navigation')} aria-haspopup="dialog" onClick={onOpenNavigation}>☰</button>)}
      <div className="viewtitle"><h1 ref={heading} tabIndex={-1}>{detail ? current.title : t('Settings')}</h1></div>
    </header>
    <div className="settingspage">
      <nav className="settingsnavlist" aria-label={t('Settings sections')} hidden={detail}>
        {sections.map(s => <button key={s.id} aria-current={!mobile && s.id === active ? 'page' : undefined} onClick={() => onSection(s.id)}>
          <Icon name={s.icon}/>
          <span className="settingsnavtitle">{s.title}</span>
          <span className="settingschevron" aria-hidden="true"/>
        </button>)}
      </nav>
      <div className="settingspanes" hidden={!current}>
        {sections.map(s => <section key={s.id} className="settingspane" aria-labelledby={`settings-${s.id}`} hidden={s.id !== active}>
          <h2 id={`settings-${s.id}`}>{s.title}</h2>
          {s.content}
        </section>)}
      </div>
    </div>
  </>;
}
