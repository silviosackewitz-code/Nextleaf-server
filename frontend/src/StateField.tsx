import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, type Task } from './api';
import type { TaskChanges } from './taskEdit';
import DateField from './DateField';
import Dialog from './Dialog';
import useMobile from './useMobile';
import { dateKey } from './calendar';
import { submenuPosition } from './quickMenu';
import { repeatChange, repeatPreview, scheduleChange, stateChange, stateLabel, waitingChange, type RepeatRule } from './scheduling';

export default function StateField({ task, people, disabled, onChange, menu = false }: {
  task: Task; people: string[]; disabled: boolean; onChange: (changes: TaskChanges) => void | Promise<boolean>; menu?: boolean;
}) {
  const id = useId();
  const mobile = useMobile();
  const panel = useRef<HTMLDivElement>(null);
  const submenu = useRef<HTMLDivElement>(null);
  const branchButton = useRef<HTMLButtonElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [branch, setBranch] = useState<'Scheduled' | 'Waiting' | null>(null);
  const pickerTask = useRef(task);
  const pickerSave = useRef(onChange);
  const [picker, setPicker] = useState<'date' | 'repeat' | null>(null);
  const [contact, setContact] = useState(task.waiting_for ?? '');
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    if (!branch || mobile || !submenu.current || !branchButton.current) return;
    const element = submenu.current;
    element.showPopover();
    const position = submenuPosition(panel.current!.getBoundingClientRect(), branchButton.current.getBoundingClientRect().top, element.offsetWidth, element.offsetHeight, { width: window.innerWidth, height: window.innerHeight });
    element.style.left = `${position.left}px`; element.style.top = `${position.top}px`;
  }, [branch, mobile]);
  async function choose(changes: TaskChanges, fromPicker = false) {
    if (saving.current || disabled) return false;
    saving.current = true; setPending(true); setError('');
    try {
      if (await (fromPicker ? pickerSave.current : onChange)(changes) === false) { setError('Could not save. Please try again.'); return false; }
      panel.current?.hidePopover(); return true;
    } catch { setError('Could not save. Please try again.'); return false; }
    finally { saving.current = false; setPending(false); }
  }
  function openBranch(name: 'Scheduled' | 'Waiting', button: HTMLButtonElement, focus = false) {
    branchButton.current = button; setBranch(name); setContact(task.waiting_for ?? '');
    if (focus) requestAnimationFrame(() => submenu.current?.querySelector<HTMLElement>('button,input')?.focus());
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); if (branch) { setBranch(null); branchButton.current?.focus(); } else panel.current?.hidePopover(); }
    if (event.target instanceof HTMLButtonElement && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(button => !button.hidden && button.closest('[role="menu"]') === event.currentTarget);
      const index = buttons.indexOf(event.target);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }
  function openPicker(kind: 'date' | 'repeat', resume = false) { pickerTask.current = resume && task.recurrence ? { ...task, recurrence: { ...task.recurrence, paused: false } } : task; pickerSave.current = onChange; setPicker(kind); panel.current?.hidePopover(); }
  return <>
    <button ref={trigger} type="button" className={menu ? '' : 'datefield dropdownfield statefield'} role={menu ? 'menuitem' : undefined} aria-label={menu ? 'State' : `State: ${stateLabel(task)}`} title={menu ? undefined : stateLabel(task)} aria-haspopup="menu" popoverTarget={id} disabled={disabled || pending}
      onClick={event => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); const element = panel.current!; element.style.left = `${Math.max(8, Math.min(rect.right - 220, window.innerWidth - 228))}px`; element.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 360))}px`; setError(''); }}>
      {menu ? <>State<span aria-hidden="true">‹</span></> : <>
        <span className="stateicon" aria-hidden="true">{['scheduled', 'recurring'].includes(task.status) ? <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="4" width="15" height="13.5" rx="1.5"/><path d="M6 2.5v3M14 2.5v3M2.5 8h15M6 12.5h7m-2.5-2.5 2.5 2.5-2.5 2.5"/></svg> : ({ inbox: '↧', next: '→', waiting: '◷', someday: '◇', later: '…', completed: '✓', trash: '⌫' } as Record<string, string>)[task.status]}</span>
        <span className="statelabel">{stateLabel(task)}</span>
      </>}
    </button>
    <div ref={panel} id={id} popover="auto" className={`taskactionpanel statemenu ${mobile ? 'mobilemenu' : ''}`} role="menu" aria-label="State" onKeyDown={keys} onToggle={event => { if (event.newState === 'closed') setBranch(null); }}>
      {(!mobile || !branch) && <>
        {['inbox', 'next', 'waiting', 'scheduled', 'someday', 'later', 'completed', 'trash'].map(status => {
          const label = status[0].toUpperCase() + status.slice(1);
          const nested = status === 'scheduled' || status === 'waiting';
          return <button type="button" role="menuitem" key={status} disabled={disabled || pending || (status === 'completed' && task.status === 'recurring')} aria-haspopup={nested ? 'menu' : undefined} aria-expanded={nested ? branch === label : undefined}
            onPointerEnter={event => { if (event.pointerType === 'mouse' && !mobile && nested) openBranch(label as 'Scheduled' | 'Waiting', event.currentTarget); }}
            onKeyDown={event => { if (nested && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); openBranch(label as 'Scheduled' | 'Waiting', event.currentTarget, true); } }}
            onClick={event => nested ? openBranch(label as 'Scheduled' | 'Waiting', event.currentTarget, true) : void choose(stateChange(status))}>{label}<span aria-hidden="true">{nested ? '‹' : task.status === status ? '✓' : ''}</span></button>;
        })}
      </>}
      {branch && <div ref={submenu} popover={mobile ? undefined : 'manual'} className={mobile ? 'mobilechoices' : 'taskactionpanel tasksubmenu'} role="menu" aria-label={branch} onKeyDown={keys}>
        <div className="choiceheading">{mobile && <button type="button" role="menuitem" onClick={() => setBranch(null)}>‹ Back</button>}<p className="actiontitle">{branch === 'Scheduled' ? 'Schedule for' : 'Waiting for'}</p></div>
        {branch === 'Scheduled' ? <>
          <button type="button" role="menuitem" disabled={pending} onClick={() => openPicker('date')}>Start Date…</button>
          <button type="button" role="menuitem" disabled={pending} onClick={() => openPicker('repeat')}>{task.recurrence ? 'Edit Repeating…' : 'Make Repeating…'}</button>
          {task.recurrence && <button type="button" role="menuitem" disabled={pending} onClick={() => task.recurrence!.paused ? openPicker('repeat', true) : void choose(repeatChange({ ...task.recurrence!, paused: true }))}>{task.recurrence.paused ? 'Resume Repeating' : 'Pause Repeating'}</button>}
          {task.status === 'recurring' && <button type="button" role="menuitem" disabled={pending} onClick={() => void choose(stateChange('next'))}>Stop Repeating</button>}
        </> : <>
          {[...new Set([...people, ...(task.waiting_for ? [task.waiting_for] : [])])].map(person => <button type="button" role="menuitem" key={person} disabled={pending} onClick={() => void choose(waitingChange(person))}>{person}</button>)}
          <input aria-label="Waiting for" placeholder="Contact or name" value={contact} disabled={pending} onChange={event => setContact(event.target.value)} onBlur={event => {
            if (contact.trim() && !panel.current?.contains(event.relatedTarget as Node | null)) void choose(waitingChange(contact));
          }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void choose(waitingChange(contact)); } }}/>
          <button type="button" role="menuitem" disabled={pending} onClick={() => void choose(waitingChange(contact))}>Use contact</button>
          <button type="button" role="menuitem" disabled={pending} onClick={() => void choose(waitingChange(null))}>Without contact</button>
        </>}
        {error && <p role="alert" className="error">{error}</p>}
      </div>}
      {error && !branch && <p role="alert" className="error">{error}</p>}
    </div>
    {picker === 'date' && <DateField label="Start Date" value={pickerTask.current.defer_until} disabled={disabled} initialAnchor={trigger.current?.getBoundingClientRect()} onClose={() => setPicker(null)} onChange={date => choose(scheduleChange(date), true)}/>}
    {picker === 'repeat' && createPortal(<RepeatDialog templateId={task.id} initialStart={pickerTask.current.defer_until?.slice(0, 10)} rule={pickerTask.current.recurrence} disabled={disabled} onClose={() => setPicker(null)} onSave={async rule => { if (await choose(repeatChange(rule), true)) setPicker(null); else throw new Error('Could not save. Please try again.'); }}/>, document.body)}
  </>;
}

function RepeatDialog({ templateId, rule, initialStart, disabled, onClose, onSave }: { templateId: string; initialStart?: string; rule: RepeatRule | null; disabled: boolean; onClose: () => void; onSave: (rule: RepeatRule) => Promise<void> }) {
  const [draft, setDraft] = useState<RepeatRule>(() => rule ?? { id: crypto.randomUUID(), frequency: 'daily', interval: 1, start: initialStart ?? dateKey(new Date()), until: null, due_days: null, paused: false });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [backlog, setBacklog] = useState<{ count: number; through: string } | null>(null);
  const [approved, setApproved] = useState(false);
  useEffect(() => {
    let active = true;
    setBacklog(null); setApproved(false); setError('');
    void api.repeatBacklog(templateId, draft).then(value => { if (active) setBacklog(value); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [templateId, draft]);
  const needsApproval = !!backlog && backlog.count > 100 && !draft.paused;
  return <Dialog title="Repeat" onClose={() => { if (!pending) onClose(); }}>
    <form className="repeatform" onSubmit={async event => { event.preventDefault(); if (pending || disabled || !backlog || (needsApproval && !approved)) return; if (draft.until && draft.until < draft.start) { setError('The end date cannot precede the start date.'); return; } setPending(true); setError(''); try { await onSave({ ...draft, catch_up_through: needsApproval && approved ? backlog.through : null }); } catch (e) { setError(String(e)); } finally { setPending(false); } }}>
      {backlog && backlog.count > 0 && <p>{backlog.count} missed copies are waiting to be generated.</p>}
      {needsApproval && <label className="repeatcheck"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)}/>Generate all {backlog!.count} missed copies through {backlog!.through}, in batches of 100.</label>}
      <label className="repeatcheck"><input type="checkbox" checked={draft.paused} onChange={event => setDraft({ ...draft, paused: event.target.checked })}/>Paused</label>
      <label>Repeat<select aria-label="Repeat" disabled={pending} value={draft.frequency} onChange={event => setDraft({ ...draft, frequency: event.target.value as RepeatRule['frequency'] })}>{['daily', 'weekly', 'monthly', 'yearly'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Every<input aria-label="Repeat interval" type="number" min="1" max="1000" required disabled={pending} value={draft.interval} onChange={event => setDraft({ ...draft, interval: Number(event.target.value) })}/></label>
      <label>First scheduled date<DateField label="First scheduled date" value={draft.start} disabled={pending} onChange={start => { if (start) setDraft({ ...draft, start }); }}/></label>
      <p className="hint" aria-live="polite">{repeatPreview(draft).join(' → ')}</p>
      <label>Ends<select aria-label="Repeat ends" disabled={pending} value={draft.until ? 'on' : 'never'} onChange={event => setDraft({ ...draft, until: event.target.value === 'never' ? null : draft.start })}><option value="never">Never</option><option value="on">On date</option></select></label>
      {draft.until && <DateField label="End date" value={draft.until} disabled={pending} onChange={until => setDraft({ ...draft, until })}/>}
      <label className="repeatcheck"><input type="checkbox" checked={draft.due_days !== null} disabled={pending} onChange={event => setDraft({ ...draft, due_days: event.target.checked ? 0 : null })}/>Each copy has a due date</label>
      {draft.due_days !== null && <label>Show in Focus this many days before due<input aria-label="Days before due" type="number" min="0" max="365" required disabled={pending} value={draft.due_days} onChange={event => setDraft({ ...draft, due_days: Number(event.target.value) })}/></label>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="dialogactions"><button type="button" disabled={pending} onClick={onClose}>Cancel</button><button className="primary" disabled={pending || disabled || !backlog || (needsApproval && !approved)}>Apply</button></div>
    </form>
  </Dialog>;
}
