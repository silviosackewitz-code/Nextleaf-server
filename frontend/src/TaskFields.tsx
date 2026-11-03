import { useId, useRef, useState } from 'react';
import type { Area, Project, Task } from './api';
import type { TaskChanges } from './taskEdit';
import DateField from './DateField';
import StateField from './StateField';
import { timeOptions as times } from './quickMenu';

export const propertyGroups = ['Time', 'Energy', 'Due', 'Status', 'Project', 'Area', 'Focus'] as const;
export type PropertyGroup = typeof propertyGroups[number];

export function TaskFields({ task, projects, areas, people, disabled, onChange, only, groups }: {
  task: Task; projects: Project[]; areas: Area[]; people: string[]; disabled: boolean; onChange: (changes: TaskChanges) => void; only?: PropertyGroup; groups?: readonly PropertyGroup[];
}) {
  const show = (name: PropertyGroup) => only ? only === name : !groups || groups.includes(name);
  const project = projects.find(item => item.id === task.project_id);
  const areaId = (task.project_id ? project?.area_id : task.area_id) ?? null;
  return <>
    {show('Time') && <label className="propertyfield"><span aria-hidden="true">◷</span><select className={task.estimated_minutes == null ? 'unset' : ''} aria-label="Time" disabled={disabled} value={task.estimated_minutes ?? ''} onChange={event => onChange({ estimated_minutes: event.target.value === '' ? null : Number(event.target.value) })}>
      <option value="">Time</option>{task.estimated_minutes != null && !times.includes(task.estimated_minutes) && <option value={task.estimated_minutes}>{task.estimated_minutes} minutes</option>}
      {times.map(minutes => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} minutes` : `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`}</option>)}
    </select></label>}
    {show('Energy') && <label className="propertyfield"><span aria-hidden="true">▥</span><select className={!task.energy ? 'unset' : ''} aria-label="Energy" disabled={disabled} value={task.energy || ''} onChange={event => onChange({ energy: event.target.value === '' ? null : Number(event.target.value) })}>
      <option value="">Energy</option><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option>
    </select></label>}
    {show('Due') && <DateField label="Due" value={task.due_date} disabled={disabled} onChange={due_date => onChange({ due_date })}/>}
    {show('Status') && <StateField task={task} people={people} disabled={disabled} onChange={onChange}/>}
    {show('Project') && <label className="propertyfield"><span aria-hidden="true">→</span><select aria-label="Project" disabled={disabled} value={task.project_id ?? ''} onChange={event => onChange({ project_id: event.target.value || null, area_id: null })}>
      <option value="">Standalone</option>{projects.filter(item => item.status !== 'completed' || item.id === task.project_id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>}
    {show('Area') && <label className="propertyfield"><span aria-hidden="true">◇</span><select aria-label="Area" disabled={disabled || !!task.project_id} value={(task.project_id ? project?.area_id : task.area_id) ?? ''} onChange={event => onChange({ area_id: event.target.value || null })}>
      <option value="">No area</option>{areas.filter(area => !area.archived || area.id === areaId).map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
    </select></label>}
    {show('Focus') && <label className="focusfield"><input type="checkbox" disabled={disabled} checked={task.starred} onChange={event => onChange({ starred: event.target.checked })}/>Focus</label>}
  </>;
}

export function TagEditor({ tags, disabled, onChange, knownTags, areas, areaId, areaDisabled, onAreaChange }: {
  tags: string[]; knownTags: string[]; disabled: boolean; onChange: (tags: string[]) => void;
  areas: Area[]; areaId: string | null; areaDisabled?: boolean; onAreaChange: (id: string | null) => void;
}) {
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const suggestions = knownTags.filter(tag => !tags.includes(tag) && value.trim() && tag.toLowerCase().includes(value.trim().toLowerCase()));
  const expanded = show && suggestions.length > 0;
  function add(text: string) {
    const tag = text.trim();
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setValue(''); setActive(-1); setShow(false); input.current?.focus();
  }
  return <div className="tageditor">
    {areaId && <span className="tag areachip">{areas.find(area => area.id === areaId)?.name ?? 'Area'}{!areaDisabled && <button type="button" disabled={disabled} aria-label="Remove area" onClick={() => onAreaChange(null)}>×</button>}</span>}
    {tags.map(tag => <span className="tag" key={tag}>{tag}<button type="button" disabled={disabled} aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter(item => item !== tag))}>×</button></span>)}
    <div className="tagentry"><input ref={input} role="combobox" aria-label="Tags" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? listId : undefined} aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined} disabled={disabled} value={value}
      onFocus={() => setShow(true)} onBlur={() => setShow(false)} onChange={event => { setValue(event.target.value); setActive(-1); setShow(true); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); add(active >= 0 && expanded ? suggestions[active] : value); }
        else if (expanded && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setActive(index => index < 0 ? (event.key === 'ArrowDown' ? 0 : suggestions.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length); }
        else if (event.key === 'Escape' && show) { event.preventDefault(); event.stopPropagation(); setShow(false); setActive(-1); }
      }}/>
      {expanded && <div className="tagsuggestions" id={listId} role="listbox">{suggestions.map((tag, index) => <button id={`${listId}-${index}`} type="button" role="option" aria-selected={index === active} key={tag} onPointerDown={event => event.preventDefault()} onClick={() => add(tag)}>{tag}</button>)}</div>}
    </div>
    <select className="tagarea" aria-label="Area" title={areaDisabled ? 'Area is inherited from the project' : 'Area'} disabled={disabled || areaDisabled} value={areaId ?? ''} onChange={event => onAreaChange(event.target.value || null)}><option value="">No area</option>{areas.filter(area => !area.archived || area.id === areaId).map(area => <option key={area.id} value={area.id}>{area.name}</option>)}</select>
  </div>;
}
