import DateField from './DateField';
import StateField from './StateField';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Area, Project, Task } from './api';
import { propertyGroups, type PropertyGroup } from './TaskFields';
import type { TaskChanges } from './taskEdit';
import { quickChoices, submenuPosition } from './quickMenu';

export default function TaskActions({ task, projects, areas, knownTags, people, busy, onSave, onOpen, mobile = false }: {
  task: Task; projects: Project[]; areas: Area[]; knownTags: string[]; people: string[]; busy: boolean;
  mobile?: boolean; onSave: (changes: TaskChanges) => Promise<boolean>; onOpen: () => void;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const submenu = useRef<HTMLDivElement>(null);
  const activeButton = useRef<HTMLButtonElement | null>(null);
  const saving = useRef(false);
  const focusSubmenu = useRef(false);
  const [datePicker, setDatePicker] = useState<{ field: 'due_date' | 'defer_until'; label: string; anchor: { right: number; bottom: number } } | null>(null);
  const [error, setError] = useState(false);
  const [activeGroup, setActiveGroup] = useState<PropertyGroup | 'Tags' | null>(null);
  function openGroup(group: PropertyGroup | 'Tags', button: HTMLButtonElement, focus = false) {
    if (saving.current) return;
    activeButton.current = button;
    focusSubmenu.current = focus;
    if (group === activeGroup && focus) submenu.current?.querySelector<HTMLElement>('button:not(:disabled),input')?.focus();
    setActiveGroup(group);
  }
  useLayoutEffect(() => {
    if (mobile) {
      if (focusSubmenu.current) submenu.current?.querySelector<HTMLButtonElement>('button')?.focus();
      return;
    }
    const element = submenu.current;
    if (!element || !activeButton.current || !activeGroup) return;
    element.showPopover();
    const position = submenuPosition(panel.current!.getBoundingClientRect(), activeButton.current.getBoundingClientRect().top, element.offsetWidth, element.offsetHeight, { width: window.innerWidth, height: window.innerHeight });
    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
    if (focusSubmenu.current) element.querySelector<HTMLElement>('button:not(:disabled),input')?.focus();
  }, [activeGroup, mobile]);
  async function choose(changes: TaskChanges) {
    if (busy || saving.current) return false;
    saving.current = true;
    setError(false);
    try {
      if (await onSave(changes)) { panel.current?.hidePopover(); return true; }
      setError(true); return false;
    } catch { setError(true); return false; }
    finally { saving.current = false; }
  }
  function menuKeys(event: KeyboardEvent<HTMLElement>) {
    if (!(event.target instanceof HTMLButtonElement) || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(button => button.closest('[role="menu"]') === event.currentTarget);
    const index = buttons.indexOf(event.target);
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  }
  const choices = activeGroup ? quickChoices(activeGroup, task, projects, areas, knownTags, people) : [];
  const field = 'due_date';
  return <>
    <button className="taskmenutrigger" aria-label={`Actions for ${task.title}`} aria-haspopup="menu" popoverTarget={id} disabled={busy} onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      const element = panel.current!;
      if (!element.matches(':popover-open')) { setActiveGroup(null); setError(false); }
      const width = Math.min(200, window.innerWidth - 16);
      element.style.left = `${Math.max(8, rect.right - width)}px`;
      element.style.top = `${Math.max(8, Math.min(rect.bottom + 2, window.innerHeight - 400))}px`;
    }}>{mobile ? '⋯' : '⌄'}</button>
    <div id={id} ref={panel} popover="auto" className={`taskactionpanel ${mobile ? 'mobilemenu' : ''}`} role="menu" aria-label={`Actions for ${task.title}`} onKeyDown={menuKeys} onToggle={event => { if (event.newState === 'closed') setActiveGroup(null); }}>
      <p className="actiontitle" hidden={mobile && !!activeGroup}>{task.title}</p>
      <button type="button" role="menuitem" hidden={mobile && !!activeGroup} onClick={() => { panel.current?.hidePopover(); onOpen(); }}>Edit details</button>
      <div className="actiongroups" role="none" hidden={mobile && !!activeGroup}>
        {([...propertyGroups, 'Tags'] as const).map(group => group === 'Status' ? <StateField key={group} menu task={task} people={people} disabled={busy} onChange={choose}/> : <button key={group} type="button" role="menuitem" className={activeGroup === group ? 'active' : ''}
          aria-haspopup="menu" aria-expanded={activeGroup === group} aria-controls={activeGroup === group ? `${id}-choices` : undefined}
          disabled={busy || (group === 'Area' && !!task.project_id)}
          title={group === 'Area' && task.project_id ? 'Area is inherited from the project' : undefined}
          onPointerEnter={event => { if (!mobile && event.pointerType === 'mouse') openGroup(group, event.currentTarget); }}
          onClick={event => openGroup(group, event.currentTarget, true)}
          onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); openGroup(group, event.currentTarget, true); } }}>
          {group}<span aria-hidden="true">{mobile ? '›' : '‹'}</span>
        </button>)}
      </div>
      {error && <p className="error" role="alert">Could not save. Please try again.</p>}
      {activeGroup && <div id={`${id}-choices`} ref={submenu} popover={mobile ? undefined : "manual"} className={mobile ? "mobilechoices" : "taskactionpanel tasksubmenu"} role="menu" aria-label={activeGroup}
        onToggle={event => { if (event.newState === 'closed') setActiveGroup(null); }}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'ArrowRight' || event.key === 'Escape') { event.preventDefault(); setActiveGroup(null); activeButton.current?.focus(); } else menuKeys(event); }}>
        <div className="choiceheading">{mobile && <button type="button" role="menuitem" onClick={() => setActiveGroup(null)}>‹ Back</button>}<p className="actiontitle">{activeGroup}</p></div>
        {choices.map(choice => <button type="button" key={choice.label} role={activeGroup === 'Tags' ? 'menuitemcheckbox' : 'menuitemradio'} aria-checked={choice.checked} disabled={busy} onPointerDown={event => event.preventDefault()} onClick={() => void choose(choice.changes)}>
          <span>{choice.label}</span><span aria-hidden="true">{choice.checked ? '✓' : ''}</span>
        </button>)}
        {activeGroup === 'Tags' && !choices.length && <p className="menunote">No tags yet</p>}
        {(activeGroup === 'Due') && <>
          <button type="button" role="menuitem" disabled={busy} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setDatePicker({ field: activeGroup === 'Due' ? 'due_date' : 'defer_until', label: activeGroup, anchor: { right: rect.right, bottom: rect.bottom } }); panel.current?.hidePopover(); }}>Choose date…</button>
          <button type="button" role="menuitem" disabled={busy} onClick={() => void choose({ [field]: null })}>None</button>
        </>}

      </div>}
    </div>
    {datePicker && <DateField label={datePicker.label} value={task[datePicker.field]} disabled={busy} initialAnchor={datePicker.anchor} onClose={() => setDatePicker(null)} onChange={value => choose({ [datePicker.field]: value })}/>}
  </>;
}
