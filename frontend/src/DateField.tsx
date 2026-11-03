import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { calendarDays, dateKey } from './calendar';

export default function DateField({ label, value, disabled, onChange, initialAnchor, onClose }: {
  initialAnchor?: { right: number; bottom: number }; onClose?: () => void;
  label: string; value: string | null; disabled: boolean; onChange: (date: string | null) => void | Promise<boolean>;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [open, setOpen] = useState(!!initialAnchor);
  const [month, setMonth] = useState(value ? new Date(`${value.slice(0, 10)}T12:00:00`) : new Date());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    element.showModal();
    const rect = initialAnchor ?? trigger.current!.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(rect.right - element.offsetWidth, window.innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - element.offsetHeight - 8))}px`;
    element.querySelector<HTMLButtonElement>('[aria-pressed="true"], [data-today="true"]')?.focus();
    return () => { element.close(); trigger.current?.focus(); };
  }, [open]);
  function close() { setOpen(false); onClose?.(); }
  async function choose(date: string | null) {
    if (pending || disabled) return;
    setPending(true); setError('');
    try {
      if (await onChange(date) === false) setError('Could not save. Please try again.');
      else close();
    } catch { setError('Could not save. Please try again.'); }
    finally { setPending(false); }
  }
  return <>
    <button hidden={!!initialAnchor} ref={trigger} type="button" className={`datefield dropdownfield ${value ? '' : 'unset'}`} aria-label={label} aria-haspopup="dialog" disabled={disabled} onClick={() => { setMonth(value ? new Date(`${value.slice(0, 10)}T12:00:00`) : new Date()); setError(''); setOpen(true); }}><span aria-hidden="true">⚑</span>{value?.slice(0, 10) || label}</button>
    {open && createPortal(<dialog ref={dialog} className="calendar" aria-labelledby={heading} onCancel={event => { event.preventDefault(); if (!pending) close(); }} onKeyDown={event => event.stopPropagation()}>
      <h2 id={heading}>{label === 'Due' ? 'Due Date' : label}</h2>
      <div className="calendarmonth"><button type="button" aria-label="Previous month" disabled={pending} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))}>‹</button><span aria-live="polite">{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span><button type="button" aria-label="Next month" disabled={pending} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))}>›</button></div>
      <div className="calendarweek" aria-hidden="true">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <span key={day}>{day}</span>)}</div>
      <div className="calendardays">{calendarDays(month.getFullYear(), month.getMonth()).map(date => {
        const key = dateKey(date);
        return <button type="button" key={key} className={date.getMonth() !== month.getMonth() ? 'othermonth' : ''} aria-label={key} aria-pressed={key === value?.slice(0, 10)} data-today={key === dateKey(new Date())} disabled={pending || disabled} onClick={() => void choose(key)}>{date.getDate()}</button>;
      })}</div>
      {error && <p role="alert">{error}</p>}
      <div className="calendaractions"><button type="button" disabled={pending} onClick={close}>Close</button><button type="button" disabled={pending || disabled || !value} onClick={() => void choose(null)}>Remove date</button></div>
    </dialog>, document.body)}
  </>;
}
