import { useId, useRef } from 'react';
import type { View } from './api';

export const captureViews = ['inbox', 'next', 'waiting', 'scheduled', 'someday', 'later', 'focus'] as const;
export const viewLabel = (view: string) => view.charAt(0).toUpperCase() + view.slice(1);

export default function NewItemMenu({ disabled, onTask, onProject, onTag, mobile = false }: {
  mobile?: boolean; disabled: boolean; onTask: (view: View) => void; onProject: () => void; onTag: () => void;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  function choose(callback: () => void) { panel.current?.hidePopover(); callback(); }
  return <div className="newitem">
    <button className={mobile ? "mobilefab" : "newitemtrigger dropdownfield"} aria-label="New item" disabled={disabled} popoverTarget={id} onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (panel.current) { panel.current.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 232))}px`; panel.current.style.top = `${rect.bottom + 6}px`; }
    }}>{mobile ? '+' : '+ New Item'}</button>
    <div id={id} ref={panel} popover="auto" className={`newitemmenu ${mobile ? 'mobilemenu' : ''}`} aria-label="New Item">
      {captureViews.map(view => <button key={view} onClick={() => choose(() => onTask(view))}>Action → {viewLabel(view)}</button>)}
      <hr/><button onClick={() => choose(onProject)}>Project</button><button onClick={() => choose(onTag)}>Tag</button>
    </div>
  </div>;
}
