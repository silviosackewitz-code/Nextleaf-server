import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Area, type Project, type Tag, type Task } from './api';
import Dialog from './Dialog';
import DateField from './DateField';
import TaskDetails from './TaskDetails';
import ProjectDetails from './ProjectDetails';
import { taskExpected, type TaskChanges } from './taskEdit';
import { projectExpected, type ProjectChanges } from './projectEdit';
import type { EditorState } from './editorState';
import { initialReview, nextReview, reviewTaskGroups, type ReviewOverview, type ReviewUnit } from './reviews';
import useMobile from './useMobile';
import './reviews.css';

export default function ReviewWorkspace({ onClose, initialProject }: { onClose: () => void; initialProject?: string }) {
  const mobile = useMobile();
  const [overview, setOverview] = useState<ReviewOverview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [postponed, setPostponed] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [taskEditor, setTaskEditor] = useState<EditorState<Task> | null>(null);
  const [latestTask, setLatestTask] = useState<Task | null>(null);
  const [projectEditor, setProjectEditor] = useState<EditorState<Project> | null>(null);
  const [latestProject, setLatestProject] = useState<Project | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [schedule, setSchedule] = useState<ReviewUnit | null>(null);
  const [scheduleOriginal, setScheduleOriginal] = useState<ReviewUnit | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [discard, setDiscard] = useState(false);
  const [undo, setUndo] = useState<{ id: string; revision: string; name: string } | null>(null);
  const loadNumber = useRef(0);
  const content = useRef<HTMLDivElement>(null);
  const operation = useRef(false);
  const scheduleDirty = !!schedule && JSON.stringify(schedule.schedule) !== JSON.stringify(scheduleOriginal?.schedule);
  const dirty = editorDirty || scheduleDirty || !!newTitle.trim();
  const editing = !!taskEditor || !!projectEditor || !!schedule;
  const unit = overview?.units.find(u => u.id === selected);
  const project = projects.find(p => p.id === unit?.project_id);
  const knownTags = tags.filter(t => !t.archived).map(t => t.name);
  const people = tags.filter(t => !t.archived && t.kind === 'person').map(t => t.name);
  const due = overview?.units.filter(u => u.due) ?? [];
  useEffect(() => { if (!loading) content.current?.focus({ preventScroll: true }); }, [selected, loading]);

  const refresh = useCallback(async (selection: string | null = selected) => {
    const number = ++loadNumber.current;
    const [o, p, a, t] = await Promise.all([api.reviews(), api.projects(), api.areas(), api.tags()]);
    const id = selection ?? initialReview(o, initialProject);
    const available = id === 'inbox' || o.units.some(u => u.id === id);
    const rows = !id || !available ? [] : id === 'inbox' ? await api.tasks('inbox') : await api.reviewTasks(id);
    if (number !== loadNumber.current) return o;
    setOverview(o); setProjects(p); setAreas(a); setTags(t); setTasks(rows); setSelected(id); setLoading(false);
    return o;
  }, [selected, initialProject]);
  useEffect(() => {
    let active = true;
    void api.reportTimezone().then(() => refresh()).catch(e => { if (active) { setError(String(e.message)); setLoading(false); } });
    return () => { active = false; ++loadNumber.current; };
  }, [refresh]);
  useEffect(() => {
    const refreshVisible = () => { if (!editing && !dirty && !operation.current && document.visibilityState === 'visible') void api.reportTimezone().then(() => refresh()).catch(e => setError(String(e.message))); };
    const timer = window.setInterval(refreshVisible, 30000);
    window.addEventListener('nextleaf-data-changed', refreshVisible);
    window.addEventListener('focus', refreshVisible);
    return () => { window.clearInterval(timer); window.removeEventListener('nextleaf-data-changed', refreshVisible); window.removeEventListener('focus', refreshVisible); };
  }, [refresh, editing, dirty]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function close() { if (operation.current) return; if (dirty) setDiscard(true); else onClose(); }
  async function choose(id: string) {
    if (operation.current || editing || dirty) return;
    setError(''); setLoading(true); setSelected(id);
    try { await refresh(id); } catch (e) { setError((e as Error).message); setLoading(false); }
  }
  async function action(run: () => Promise<void>): Promise<boolean> {
    if (operation.current) return false;
    operation.current = true; setBusy(true); setError('');
    try { await run(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { operation.current = false; setBusy(false); }
  }
  async function confirm() {
    if (!unit || !overview || editing || dirty) return;
    await action(async () => {
      const row = await api.confirmReview(unit.id, unit.revision, overview.today);
      setUndo({ id: row.id, revision: row.revision, name: unit.name });
      const o = await api.reviews();
      await refresh(nextReview(o.units, skipped, unit.id));
    });
  }
  async function skip() {
    if (!overview || !selected || editing || dirty) return;
    const nextSkipped = [...skipped, selected]; setSkipped(nextSkipped);
    await choose(selected === 'inbox' && initialProject && overview.units.some(u => u.project_id === initialProject) ? `project:${initialProject}` : nextReview(overview.units, nextSkipped));
  }
  function closeTask() { setTaskEditor(null); setLatestTask(null); setEditorDirty(false); }
  function closeProject() { setProjectEditor(null); setLatestProject(null); setEditorDirty(false); }
  async function saveTask(changes: TaskChanges, original: Task) {
    return action(async () => {
      try { await api.updateTask(original.id, changes, taskExpected(original, changes)); }
      catch (e) { setLatestTask(await api.task(original.id)); throw e; }
      await refresh();
    });
  }
  async function saveProject(changes: ProjectChanges, original: Project) {
    return action(async () => {
      try { await api.updateProject(original.id, changes, projectExpected(original, changes)); }
      catch (e) { setLatestProject((await api.projects()).find(p => p.id === original.id) ?? original); throw e; }
      await refresh();
    });
  }
  const disabled = busy || loading || editing || dirty;
  return <Dialog title="Review" onClose={close}>
    <section className="reviewworkspace" aria-label="Guided review">
      <div className="reviewsummary" aria-live="polite"><strong>Inbox: {overview?.inbox_count ?? '…'} {overview?.inbox_count === 1 ? 'item' : 'items'} · {due.length} reviews due</strong>
        <button disabled={busy || editing || dirty} onClick={() => void action(async () => { await api.reportTimezone(); await refresh(); })}>Refresh</button>
      </div>
      <p className="hint">All Areas · Saved on your server.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p role="status">Loading review…</p>}
      <div className="reviewlayout">
        <nav className="reviewqueue" aria-label="Review steps">
          <button disabled={disabled} aria-current={selected === 'inbox' ? 'step' : undefined} onClick={() => void choose('inbox')}>Inbox <span>{overview?.inbox_count ?? 0}</span></button>
          <label className="reviewall"><input type="checkbox" checked={all} disabled={busy || editing || dirty} onChange={e => setAll(e.target.checked)}/>Show upcoming and empty lists</label>
          {(overview?.units ?? []).filter(u => all || u.due || u.id === selected).map(u => <button key={u.id} disabled={disabled} aria-current={selected === u.id ? 'step' : undefined} onClick={() => void choose(u.id)}>
            <span>{u.name}<small>{u.status === 'someday' ? 'Someday project · ' : ''}{u.schedule.next_review ?? 'Never reviewed'}{skipped.includes(u.id) ? ' · Skipped' : ''}</small></span>
          </button>)}
        </nav>
        <div className="reviewcontent" ref={content} tabIndex={-1} role="region" aria-label={selected === 'inbox' ? 'Inbox review' : unit?.name ?? 'Review progress'}>
          {selected === 'inbox' ? <><h3>Clear Inbox</h3><p>Clarify and organize each entry. You do not need to finish the work now.</p></> : unit ? <>
            <div className="reviewheading"><h3>{unit.name}</h3>{project && <button disabled={disabled} onClick={() => { setProjectEditor({ original: project, draft: project }); setLatestProject(project); setError(''); }}>Edit project</button>}</div>
            {project?.notes && <p className="reviewnotes">{project.notes}</p>}
            {unit.id === 'list:someday-ideas' && <p className="hint">Loose ideas share this schedule. Someday projects have their own intervals.</p>}
            {project && <p className="hint">Still relevant? Correct status? Clear next action? Waiting on something?</p>}
            <div className="reviewdates"><span>Last reviewed: {unit.schedule.last_reviewed ?? 'Never'}</span><span>Every {unit.schedule.interval} {unit.schedule.interval === 1 ? unit.schedule.unit.slice(0, -1) : unit.schedule.unit}</span><span>Next review: {unit.schedule.next_review ?? 'Now'}</span></div>
            <button disabled={disabled} onClick={() => { setSchedule(structuredClone(unit)); setScheduleOriginal(unit); setError(''); }}>Schedule / Postpone…</button>
          </> : !loading && <><h3>{due.length ? 'Review paused' : 'No reviews due'}</h3><p>{due.length ? 'Choose a remaining unit to continue.' : 'You can still open an upcoming project or list to review early.'}</p>
            <p>{overview?.inbox_count ?? 0} Inbox items remaining · {skipped.filter(id => id !== 'inbox' && due.some(u => u.id === id)).length} reviews skipped · {postponed.length} postponed this visit</p></>}
          {selected && (selected === 'inbox' || unit) && <>
            {!tasks.length && !loading && <p>{selected === 'inbox' ? 'Inbox clear.' : 'No unfinished actions. Check whether this project or list is still relevant.'}</p>}
            {reviewTaskGroups(tasks).map(group => <section key={group.name} aria-label={group.name}><h4>{group.name}</h4>{group.tasks.map(task => <div className="reviewtask" key={task.id}>
              <button className="reviewtasktitle" disabled={disabled} onClick={() => { setTaskEditor({ original: task, draft: task }); setLatestTask(task); setError(''); }}>{task.title}</button>
              <small>{task.waiting_for ? `Waiting for ${task.waiting_for} · ` : ''}{task.defer_until ? `Starts ${task.defer_until} · ` : ''}{task.due_date ? `Due ${task.due_date} · ` : ''}{task.blocked_by_sequence ? 'Blocked by sequence' : ''}</small>
              {task.notes && <p className="reviewnotes">{task.notes}</p>}
              <div className="reviewtaskactions"><button disabled={disabled || task.status === 'recurring'} onClick={() => void saveTask({ status: 'completed' }, task)}>Complete</button><button disabled={disabled} onClick={() => void saveTask({ status: 'trash' }, task)}>Trash</button></div>
            </div>)}</section>)}
            <form className="reviewcapture" onSubmit={e => { e.preventDefault(); if (!newTitle.trim() || busy) return; void action(async () => {
              await api.addTask(newTitle.trim(), selected === 'inbox' ? 'inbox' : unit?.id === 'list:someday-ideas' ? 'someday' : 'next', unit?.project_id ?? null, null);
              setNewTitle(''); await refresh();
            }); }}><label>{selected === 'inbox' ? 'Capture in Inbox' : 'Add an action'}<input value={newTitle} disabled={busy || editing || loading} onChange={e => setNewTitle(e.target.value)} maxLength={200}/></label><button disabled={busy || editing || loading || !newTitle.trim()}>Add</button>{newTitle && <button type="button" disabled={busy} onClick={() => setNewTitle('')}>Cancel</button>}</form>
            <div className="reviewfooter">
              <button disabled={disabled} onClick={() => void skip()}>{selected === 'inbox' ? (tasks.length ? 'Continue with Inbox remaining' : 'Continue') : 'Skip for now'}</button>
              {unit && <button className="primary" disabled={disabled || !unit.confirm_next} onClick={() => void confirm()}>Mark Reviewed → {unit.confirm_next ?? 'Date out of range'}</button>}
            </div>
          </>}
          {undo && <p role="status">Reviewed: {undo.name} <button disabled={disabled} onClick={() => void action(async () => { await api.undoReview(undo.id, undo.revision); const id = undo.id; setUndo(null); await refresh(id); })}>Undo review</button></p>}
        </div>
      </div>
    </section>
    {taskEditor && latestTask && <Dialog title="Edit review task" variant={mobile ? 'editor' : undefined} onClose={() => { if (!editorDirty) closeTask(); else setError('Save changes or use Cancel to discard this task draft.'); }}>
      <TaskDetails task={latestTask} editor={taskEditor} setEditor={setTaskEditor} projects={projects} areas={areas} knownTags={knownTags} people={people} busy={busy} error={error} onSave={saveTask} onClose={closeTask} onCancel={closeTask} onDirtyChange={setEditorDirty} mobile={mobile}/>
    </Dialog>}
    {projectEditor && latestProject && <Dialog title="Edit review project" variant={mobile ? 'editor' : undefined} onClose={() => { if (!editorDirty) closeProject(); else setError('Save changes or use Cancel to discard this project draft.'); }}>
      <ProjectDetails project={latestProject} editor={projectEditor} setEditor={setProjectEditor} areas={areas} knownTags={knownTags} busy={busy} error={error} onSave={saveProject} onClose={closeProject} onCancel={closeProject} onDirtyChange={setEditorDirty} mobile={mobile}/>
    </Dialog>}
    {schedule && <Dialog title="Review schedule" onClose={() => { if (!scheduleDirty) setSchedule(null); else setError('Save or cancel the schedule draft.'); }}>
      <form className="projectdialogform" onSubmit={e => { e.preventDefault(); void action(async () => {
        await api.reviewSchedule(schedule.id, schedule.revision, schedule.schedule);
        const deferred = !!(schedule.schedule.next_review && overview && schedule.schedule.next_review > overview.today && scheduleOriginal?.due);
        if (deferred) setPostponed(p => [...new Set([...p, schedule.id])]);
        setSchedule(null);
        if (deferred) { const o = await api.reviews(); await refresh(nextReview(o.units, skipped, schedule.id)); }
        else await refresh();
      }); }}><p>{schedule.name}</p><label>Review every<input type="number" min={1} max={1000} required disabled={busy} value={schedule.schedule.interval} onChange={e => setSchedule({ ...schedule, schedule: { ...schedule.schedule, interval: Number(e.target.value) } })}/></label>
        <label>Interval unit<select disabled={busy} value={schedule.schedule.unit} onChange={e => setSchedule({ ...schedule, schedule: { ...schedule.schedule, unit: e.target.value as ReviewUnit['schedule']['unit'] } })}><option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option></select></label>
        <div className="reviewpresets" role="group" aria-label="Review interval presets">{([[1, 'weeks', 'Weekly'], [2, 'weeks', 'Every 2 weeks'], [4, 'weeks', 'Every 4 weeks'], [3, 'months', 'Every 3 months']] as const).map(([interval, unit, label]) => <button type="button" key={label} disabled={busy} onClick={() => setSchedule({ ...schedule, schedule: { ...schedule.schedule, interval, unit } })}>{label}</button>)}</div>
        <DateField label="Next review" value={schedule.schedule.next_review} disabled={busy} onChange={next_review => setSchedule({ ...schedule, schedule: { ...schedule.schedule, next_review } })}/>
        <p className="hint">Changing this date postpones or brings forward the review without marking it reviewed. No date means review now.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialogactions"><button type="button" disabled={busy} onClick={() => setSchedule(null)}>Cancel</button><button className="primary" disabled={busy || !scheduleDirty}>Save schedule</button></div>
      </form>
    </Dialog>}
    {discard && <Dialog title="Discard review draft?" onClose={() => setDiscard(false)}><p>Saved reviews and tasks are kept. The unsaved draft will be discarded.</p><div className="dialogactions"><button onClick={() => setDiscard(false)}>Keep editing</button><button onClick={onClose}>Discard draft and close</button></div></Dialog>}
  </Dialog>;
}
