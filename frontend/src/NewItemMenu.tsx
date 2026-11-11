import { useId, useRef } from 'react';
import type { View } from './api';
import { statusName, t } from './i18n.ts';

export const captureViews = ['inbox', 'next', 'waiting', 'scheduled', 'someday', 'later', 'focus'] as const;
export const viewLabel = (view: string) => view === 'focus' ? t('Focus') : statusName(view);

export default function NewItemMenu({ disabled, onTask, onProject, onTag, mobile = false }: {
  mobile?: boolean; disabled: boolean; onTask: (view: View) => void; onProject: () => void; onTag: () => void;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  function choose(callback: () => void) { panel.current?.hidePopover(); callback(); }
  return <div className="newitem">
    <button className={mobile ? "mobilefab" : "newitemtrigger dropdownfield"} aria-label={t('New item')} disabled={disabled} popoverTarget={id} onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (panel.current) { panel.current.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 232))}px`; panel.current.style.top = `${rect.bottom + 6}px`; }
    }}>{mobile ? '+' : t('+ New Item')}</button>
    <div id={id} ref={panel} popover="auto" className={`newitemmenu ${mobile ? 'mobilemenu' : ''}`} aria-label={t('New Item')}>
      {captureViews.map(view => <button key={view} onClick={() => choose(() => onTask(view))}>{t('Action → {view}', { view: viewLabel(view) })}</button>)}
      <hr/><button onClick={() => choose(onProject)}>{t('Project')}</button><button onClick={() => choose(onTag)}>{t('Tag')}</button>
    </div>
  </div>;
}
