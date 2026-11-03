import { useEffect, useState } from 'react';
import { api, type Area, type Project, type Tag, type Task } from './api';
import Dialog from './Dialog';
import { ruleLabels, type Perspective, type PerspectiveDefinition, type PerspectiveInput, type Rules } from './perspectives';

function Choices({ label, values, choices, onChange }: { label: string; values: string[]; choices: {id: string; name: string}[]; onChange: (v: string[]) => void }) {
  const all = [...choices, ...values.filter(id => !choices.some(c => c.id === id)).map(id => ({id, name: `Missing reference: ${id}`}))];
  return <fieldset className="perspectivechoices"><legend>{label}</legend>{all.map(c => <label key={c.id}><input type="checkbox" checked={values.includes(c.id)} onChange={e => onChange(e.target.checked ? [...values, c.id] : values.filter(v => v !== c.id))}/>{c.name}</label>)}</fieldset>;
}
export default function PerspectiveEditor({ initial, original, areas, projects, tags, waiting, onClose, onSaved, onApply }: {
  initial: PerspectiveInput; original?: Perspective; areas: Area[]; projects: Project[]; tags: Tag[]; waiting: string[]; onClose: () => void; onSaved: (p: Perspective) => void; onApply?: (d: PerspectiveDefinition) => void;
}) {
  const [draft, setDraft] = useState(initial), [preview, setPreview] = useState<Task[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [discard, setDiscard] = useState(false), [deleting, setDeleting] = useState(false);
  const d = draft.definition, r = d.rules;
  const definition = (changes: Partial<PerspectiveDefinition>) => setDraft(v => ({ ...v, definition: { ...v.definition, ...changes } }));
  const rules = (changes: Partial<Rules>) => definition({ rules: { ...r, ...changes } });
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    const timer = window.setTimeout(() => { void api.previewPerspective(d).then(tasks => { if (!cancelled) setPreview(tasks); }).catch(e => { if (!cancelled) { setPreview([]); setError(String(e.message)); } }).finally(() => { if (!cancelled) setLoading(false); }); }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [d]);
  function close() { if (!busy) JSON.stringify(draft) === JSON.stringify(initial) ? onClose() : setDiscard(true); }
  async function save(remove = false) {
    setBusy(true); setError('');
    try { onSaved(await api.savePerspective(draft, original, remove)); }
    catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <Dialog title={original ? 'Edit Perspective' : 'New Perspective'} onClose={close}>
    <form className="perspectiveeditor" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label>Name<input autoFocus required maxLength={200} value={draft.name} onChange={e => setDraft({...draft, name: e.target.value})}/></label>
      <div className="perspectivegrid"><label>Icon<select value={d.icon} onChange={e => definition({icon:e.target.value})}>{['◈','◇','☆','◎','▦','→'].map(icon => <option key={icon}>{icon}</option>)}</select></label><label>Sidebar order<input type="number" step="1" value={draft.sort_order} onChange={e => setDraft({...draft, sort_order: Number(e.target.value)})}/></label></div>
      <label className="perspectivecheck"><input type="checkbox" checked={d.pinned} onChange={e => definition({pinned:e.target.checked})}/>Pin above other Perspectives</label>
      <h3>Match all</h3><div className="perspectiverules">{ruleLabels(d,areas,projects,tags).map(label => <span key={label}>{label}</span>)}</div>
      <div className="perspectivegrid">
        <label>Scope<select value={r.completed ? 'completed' : 'open'} onChange={e => { const completed = e.target.value === 'completed'; definition({...d, sorting: completed ? 'completed' : 'order', rules: {...r, completed, states: [], availability:'', first_per_project:false}}); }}><option value="open">Open tasks</option><option value="completed">Completed tasks</option></select></label>
        {!r.completed && <label>Availability<select value={r.availability} onChange={e => rules({availability:e.target.value as Rules['availability']})}><option value="">Any</option><option value="available">Available now</option><option value="blocked">Unavailable / blocked</option></select></label>}
      </div>
      {!r.completed && <details open={r.states.length > 0}><summary>State{r.states.length ? ` · ${r.states.length}` : ''}</summary><Choices label="Match any state" values={r.states} choices={['inbox','next','waiting','scheduled','someday','later'].map(id=>({id,name:id.charAt(0).toUpperCase()+id.slice(1)}))} onChange={states=>rules({states})}/><label className="perspectivecheck"><input type="checkbox" checked={r.first_per_project} onChange={e=>rules({first_per_project:e.target.checked})}/>First available action per project</label></details>}
      <details open={r.areas.length > 0}><summary>Area{r.areas.length ? ` · ${r.areas.length}` : ''}</summary><Choices label="Match any Area" values={r.areas} choices={[{id:'',name:'No Area'},...areas.map(a=>({...a,name:a.name+(a.archived?' (archived)':'')}))]} onChange={areas=>rules({areas})}/></details>
      <details open={r.projects.length > 0}><summary>Project{r.projects.length ? ` · ${r.projects.length}` : ''}</summary><Choices label="Match any project" values={r.projects} choices={[{id:'',name:'No project'},...projects]} onChange={projects=>rules({projects})}/></details>
      <details open={r.tags.length > 0 || r.tag_mode === 'untagged'}><summary>Tags{r.tags.length ? ` · ${r.tags.length}` : ''}</summary><label>Match tags<select value={r.tag_mode || 'all'} onChange={e=>rules({tag_mode:e.target.value as Rules['tag_mode'], ...(e.target.value==='untagged'?{tags:[]}: {})})}><option value="all">All selected</option><option value="any">Any selected</option><option value="none">None selected</option><option value="untagged">Untagged</option></select></label>{r.tag_mode !== 'untagged' && <Choices label="Tags" values={r.tags} choices={tags} onChange={tags=>rules({tags})}/>}</details>
      <details open={r.contacts.length + r.waiting.length > 0}><summary>Contacts / Waiting for</summary><Choices label="Match any contact" values={r.contacts} choices={tags.filter(t=>t.kind==='person')} onChange={contacts=>rules({contacts})}/><Choices label="Existing Waiting for text" values={r.waiting} choices={[...new Set([...waiting,...r.waiting])].filter(w=>!tags.some(t=>t.kind==='person'&&t.name===w)).map(id=>({id,name:id}))} onChange={waiting=>rules({waiting})}/></details>
      <details open={!!r.due || r.focus !== null || r.minutes !== null || r.no_minutes || !!r.energies.length || r.no_energy}><summary>Focus, due date and effort</summary><div className="perspectivegrid">
        <label>Focus<select value={r.focus === null ? '' : String(r.focus)} onChange={e=>rules({focus:e.target.value===''?null:e.target.value==='true'})}><option value="">Any</option><option value="true">Focused</option><option value="false">Not focused</option></select></label>
        <label>Due<select value={r.due} onChange={e=>rules({due:e.target.value as Rules['due']})}>{[['','Any'],['overdue','Overdue'],['today','Today'],['through_today','Through today'],['week','Next 7 days'],['range','Date range'],['none','No due date']].map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
        {r.due==='range' && <><label>From<input type="date" min="1900-01-01" max="9999-12-31" value={r.from??''} onChange={e=>rules({from:e.target.value||null})}/></label><label>Through<input type="date" min="1900-01-01" max="9999-12-31" value={r.through??''} onChange={e=>rules({through:e.target.value||null})}/></label></>}
        <label>Time<select value={r.no_minutes?'unknown':r.minutes??''} onChange={e=>rules({no_minutes:e.target.value==='unknown', minutes:e.target.value && e.target.value!=='unknown'?Number(e.target.value):null})}><option value="">Any</option><option value="unknown">Unspecified</option>{[...new Set([5,10,15,30,45,60,120,240,480,...(r.minutes===null?[]:[r.minutes])])].sort((a,b)=>a-b).map(n=><option key={n} value={n}>At most {n} min</option>)}</select></label>
        <label className="perspectivecheck"><input type="checkbox" checked={r.no_energy} onChange={e=>rules({no_energy:e.target.checked, energies:[]})}/>Unspecified energy</label>
      </div>{!r.no_energy && <Choices label="Match any energy" values={r.energies.map(String)} choices={['0','1','2','3'].map((id,i)=>({id,name:['Zero','Low','Medium','High'][i]}))} onChange={v=>rules({energies:v.map(Number)})}/>}</details>
      <h3>Presentation</h3><div className="perspectivegrid">
        <label>Group by<select value={d.grouping} onChange={e=>definition({grouping:e.target.value as PerspectiveDefinition['grouping']})}>{[['unified','None'],['project','Project'],['area','Area'],['state','State'],['due','Due date']].map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
        <label>Sort by<select value={d.sorting} onChange={e=>definition({sorting:e.target.value as PerspectiveDefinition['sorting']})}>{[['order','Existing task order'],['due','Due date, earliest first'],['title','Title'],['minutes','Estimated duration'],...(r.completed?[['completed','Completion, newest first']]:[])].map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
        <label>Notes<select value={d.notes} onChange={e=>definition({notes:e.target.value as PerspectiveDefinition['notes']})}><option value="none">Hidden</option><option value="preview">Preview</option><option value="full">Full</option></select></label>
        {d.grouping==='project' && <label>Actions per project<select value={d.project_limit??''} onChange={e=>definition({project_limit:e.target.value?Number(e.target.value):null})}><option value="">All</option>{Array.from({length:9},(_,i)=><option key={i} value={i+1}>Top {i+1}</option>)}</select></label>}
      </div>
      <section className="perspectivepreview" aria-label="Perspective preview" aria-live="polite"><strong>{loading?'Updating preview…':`${preview.length} matching tasks`}</strong>{!loading && preview.slice(0,5).map(t=><p key={t.id}>{t.title}</p>)}{!loading&&preview.length>5&&<p>And {preview.length-5} more</p>}</section>
      {error&&<p role="alert" className="error">{error}</p>}
      {discard ? <div className="dialogactions"><span>Discard unsaved changes?</span><button type="button" onClick={()=>setDiscard(false)}>Keep editing</button><button type="button" onClick={onClose}>Discard</button></div> : deleting ? <div className="dialogactions"><span>Delete this Perspective? Its tasks stay unchanged.</span><button type="button" disabled={busy} onClick={()=>setDeleting(false)}>Cancel</button><button type="button" disabled={busy} onClick={()=>void save(true)}>Delete Perspective</button></div> : <div className="dialogactions">{original&&<button type="button" disabled={busy} onClick={()=>setDeleting(true)}>Delete…</button>}<button type="button" disabled={busy} onClick={close}>Cancel</button>{onApply&&<button type="button" disabled={busy||loading||!!error} onClick={()=>onApply(d)}>Apply temporarily</button>}<button className="primary" disabled={busy||loading||!!error||!draft.name.trim()}>Save Perspective</button></div>}
    </form>
  </Dialog>;
}
