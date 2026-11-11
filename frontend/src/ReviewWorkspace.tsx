import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { api, type Area, type Project, type Tag, type Task } from './api';
import Dialog from './Dialog';
import DateField from './DateField';
import Icon from './icons';
import TaskActions from './TaskActions';
import TaskDetails from './TaskDetails';
import ProjectDetails from './ProjectDetails';
import { taskExpected, type TaskChanges } from './taskEdit';
import { projectExpected, type ProjectChanges } from './projectEdit';
import type { EditorState } from './editorState';
import { initialReview, nextReview, reviewAfter, reviewDate, reviewProgress, reviewQueue, reviewStep, reviewTaskGroups, type ReviewOverview, type ReviewUnit } from './reviews';
import { stateChange } from './scheduling';
import { isOverdue } from './taskList';
import useMobile from './useMobile';
import './reviews.css';
import { t } from './i18n.ts';

const projectStates = [['active', 'Active'], ['someday', 'Someday'], ['completed', 'Completed']] as const;

/**
 * Review as a main view: one unit at a time with ordinary task rows, and a review
 * bar holding the schedule, the project status, stepping and Mark Reviewed.
 * `guard` lets the surrounding navigation ask whether an unsaved draft blocks leaving.
 * `onChanged` keeps the sidebar beside it current: its badges and project list would
 * otherwise show the state from before the visit.
 */
export default function ReviewWorkspace({ onClose, initialProject, guard, onDue, onChanged }: { onClose: () => void; initialProject?: string; guard?: MutableRefObject<(() => boolean) | null>; onDue?: (count: number) => void; onChanged?: () => void }) {
  const mobile = useMobile();
  const [overview, setOverview] = useState<ReviewOverview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [postponed, setPostponed] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState<string[]>([]);
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
  const [notesOpen, setNotesOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const loadNumber = useRef(0);
  const content = useRef<HTMLDivElement>(null);
  const operation = useRef(false);
  const firstSeen = useRef<string[]>([]);
  const scheduleDirty = !!schedule && JSON.stringify(schedule.schedule) !== JSON.stringify(scheduleOriginal?.schedule);
  const dirty = editorDirty || scheduleDirty || !!newTitle.trim();
  const editing = !!taskEditor || !!projectEditor || !!schedule;
  const unit = overview?.units.find(u => u.id === selected);
  const project = projects.find(p => p.id === unit?.project_id);
  const knownTags = tags.filter(t => !t.archived).map(t => t.name);
  const people = tags.filter(t => !t.archived && t.kind === 'person').map(t => t.name);
  const due = overview?.units.filter(u => u.due) ?? [];
  const today = overview?.today ?? '';
  const queue = overview ? reviewQueue(overview.units, selected, reviewed, all, firstSeen.current) : [];
  const showInbox = !!overview && (overview.inbox_count > 0 || selected === 'inbox');
  const stepIds = [...(showInbox ? ['inbox'] : []), ...queue.map(u => u.id)];
  const progress = reviewProgress(overview?.units ?? [], reviewed);
  useEffect(() => { if (!loading) content.current?.focus({ preventScroll: true }); }, [selected, loading]);
  useEffect(() => { setNotesOpen(false); window.scrollTo(0, 0); }, [selected]);
  useEffect(() => {
    if (!guard) return;
    guard.current = () => { if (operation.current) return false; if (dirty) { setDiscard(true); return false; } return true; };
    return () => { guard.current = null; };
  }, [guard, dirty]);

  const refresh = useCallback(async (selection: string | null = selected) => {
    const number = ++loadNumber.current;
    const [o, p, a, tagRows] = await Promise.all([api.reviews(), api.projects(), api.areas(), api.tags()]);
    const id = selection ?? initialReview(o, initialProject);
    const available = id === 'inbox' || o.units.some(u => u.id === id);
    const rows = !id || !available ? [] : id === 'inbox' ? await api.tasks('inbox') : await api.reviewTasks(id);
    if (number !== loadNumber.current) return o;
    for (const u of o.units) if (!firstSeen.current.includes(u.id)) firstSeen.current.push(u.id);
    onDue?.(o.units.filter(u => u.due).length);
    setOverview(o); setProjects(p); setAreas(a); setTags(tagRows); setTasks(rows); setSelected(available ? id : ''); setLoading(false);
    return o;
  }, [selected, initialProject, onDue]);
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
    setQueueOpen(false); setError(''); setLoading(true); setSelected(id);
    try { await refresh(id); } catch (e) { setError((e as Error).message); setLoading(false); }
  }
  async function action(run: () => Promise<void>): Promise<boolean> {
    if (operation.current) return false;
    operation.current = true; setBusy(true); setError('');
    try { await run(); onChanged?.(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { operation.current = false; setBusy(false); }
  }
  async function confirm() {
    if (!unit || !overview || editing || dirty) return;
    await action(async () => {
      const row = await api.confirmReview(unit.id, unit.revision, overview.today);
      setUndo({ id: row.id, revision: row.revision, name: unit.name });
      setReviewed(ids => [...new Set([...ids, unit.id])]);
      const o = await api.reviews();
      await refresh(reviewAfter(stepIds, o.units, skipped, unit.id));
    });
  }
  /** Stepping never confirms. Moving on from a unit that is still due counts as skipped for this visit. */
  async function step(delta: 1 | -1) {
    if (!overview || selected === null || editing || dirty) return;
    if (delta > 0 && selected && !reviewed.includes(selected)) setSkipped(ids => [...new Set([...ids, selected])]);
    const requested = `project:${initialProject}`;
    await choose(delta > 0 && selected === 'inbox' && initialProject && overview.units.some(u => u.id === requested) ? requested : reviewStep(stepIds, selected, delta));
  }
  async function setStatus(status: string) {
    if (!project || !unit || project.status === status) return;
    const current = unit.id;
    await action(async () => {
      await api.updateProject(project.id, { status }, projectExpected(project, { status }));
      const o = await api.reviews();
      await refresh(o.units.some(u => u.id === current) ? current : reviewAfter(stepIds, o.units, skipped, current));
    });
  }
  function openTask(task: Task) { setTaskEditor({ original: task, draft: task }); setLatestTask(task); setError(''); }
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
      // A project that left the queue (Trash, Completed) makes room for the next due unit.
      const o = await api.reviews();
      await refresh(!selected || selected === 'inbox' || o.units.some(u => u.id === selected) ? selected : reviewAfter(stepIds, o.units, skipped, selected));
    });
  }
  const disabled = busy || loading || editing || dirty;
  const star = (task: Task) => <button className={`focusstar rowfocus ${task.starred ? 'focused' : ''}`} aria-label={t('Focus: {title}', { title: task.title })} aria-pressed={task.starred} disabled={disabled} onClick={() => void saveTask({ starred: !task.starred }, task)}><span aria-hidden="true">{task.starred ? '★' : '☆'}</span></button>;
  const row = (task: Task, inbox = false) => <article className="task" key={task.id}>
    <button className={`checkbox ${isOverdue(task) ? 'overdue' : ''}`} title={isOverdue(task) ? t('Overdue') : undefined} aria-label={t('Complete task')} disabled={disabled || task.status === 'recurring'} onClick={() => void saveTask({ status: 'completed' }, task)}/>
    {!mobile && star(task)}
    <div className="taskbody">
      <button className="tasktitle taskopen" title={task.title} aria-label={t('Open task: {title}', { title: task.title })} disabled={disabled} onClick={() => openTask(task)}>{task.title}{task.notes && <span className="tasknoteindicator" title={t('Has notes')} role="img" aria-label={t('Has notes')}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 2.5h11v8L10 13.5H2.5zM10 13.5V10h3.5M5 5.5h6M5 8h4"/></svg></span>}</button>
      <div className="taskmeta">
        {task.waiting_for && <span>{t('Waiting for {contact}', { contact: task.waiting_for })}</span>}
        {task.defer_until && <span>{t('Starts {date}', { date: reviewDate(task.defer_until, today) })}</span>}
        {task.due_date && <span>{t('Due {date}', { date: reviewDate(task.due_date, today) })}</span>}
        {task.blocked_by_sequence && <span>{t('Blocked by sequence')}</span>}
        {task.tags.map(tag => <span className="tag" key={tag} aria-label={t('Tag: {tag}', { tag })}><span aria-hidden="true">#</span>{tag}</span>)}
      </div>
      {inbox && <div className="reviewtargets" role="group" aria-label={t('Move {title} to', { title: task.title })}>
        <button disabled={disabled} onClick={() => void saveTask(stateChange('next'), task)}>{t('Next')}</button>
        <button disabled={disabled} onClick={() => void saveTask(stateChange('someday'), task)}>{t('Someday')}</button>
        <button disabled={disabled} onClick={() => void saveTask(stateChange('later'), task)}>{t('Later')}</button>
      </div>}
    </div>
    {mobile && star(task)}
    <TaskActions mobile={mobile} task={task} projects={projects} areas={areas} knownTags={knownTags} people={people} busy={disabled} onSave={changes => saveTask(changes, task)} onOpen={() => openTask(task)}/>
  </article>;
  const capture = <form className="reviewcapture" onSubmit={e => { e.preventDefault(); if (!newTitle.trim() || busy) return; void action(async () => {
    await api.addTask(newTitle.trim(), selected === 'inbox' ? 'inbox' : unit?.id === 'list:someday-ideas' ? 'someday' : 'next', unit?.project_id ?? null, null);
    setNewTitle(''); await refresh();
  }); }}><span aria-hidden="true">+</span><input aria-label={selected === 'inbox' ? t('Capture in Inbox') : t('Add an action')} placeholder={selected === 'inbox' ? t('Capture in Inbox') : t('Add an action')} value={newTitle} disabled={busy || editing || loading} onChange={e => setNewTitle(e.target.value)} maxLength={200}/>{newTitle && <><button className="settingsbutton" disabled={busy || editing || loading || !newTitle.trim()}>{t('Add')}</button><button className="settingsbutton quiet" type="button" disabled={busy} onClick={() => setNewTitle('')}>{t('Cancel')}</button></>}</form>;
  const queueList = <nav className="reviewqueue" aria-label={t('Review steps')}>
    {showInbox && <button disabled={disabled} aria-current={selected === 'inbox' ? 'step' : undefined} onClick={() => void choose('inbox')}><span className="reviewmark" aria-hidden="true"><Icon name="inbox" size={16}/></span><span className="reviewqueuename">{t('Inbox')}</span><small>{overview?.inbox_count}</small></button>}
    {queue.map(u => <button key={u.id} disabled={disabled} aria-current={selected === u.id ? 'step' : undefined} onClick={() => void choose(u.id)}>
      <span className={`reviewmark ${reviewed.includes(u.id) ? 'done' : ''}`} aria-hidden="true">{reviewed.includes(u.id) && <Icon name="completed" size={16}/>}</span>
      <span className="reviewqueuename">{u.name}{reviewed.includes(u.id) && <span className="reviewhidden"> · {t('Reviewed')}</span>}</span>
      <small>{skipped.includes(u.id) && !reviewed.includes(u.id) ? t('Skipped') : !u.due && u.schedule.next_review ? reviewDate(u.schedule.next_review, today) : ''}</small>
    </button>)}
    <label className="reviewall"><input type="checkbox" role="switch" className="switch" checked={all} disabled={busy || editing || dirty} onChange={e => setAll(e.target.checked)}/>{t('Show upcoming and empty lists')}</label>
  </nav>;
  const progressText = t('{done} of {total} reviewed', { done: progress.done, total: progress.total });
  return <section className="reviewworkspace" aria-label={t('Guided review')}>
    <header className="reviewtop">
      {mobile && <button className="iconbutton" aria-label={t('Close review')} disabled={busy} onClick={close}>×</button>}
      <div className="viewtitle"><h1>{t('Review')}</h1>
        {mobile ? <button className="reviewcounter" aria-haspopup="dialog" disabled={disabled} onClick={() => setQueueOpen(true)}>{progressText}<span className="sectionchevron expanded" aria-hidden="true"/></button> : <span className="count">{progressText}</span>}
      </div>
      <span className="reviewprogress" role="progressbar" aria-label={t('Review progress')} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><span style={{ width: `${progress.total ? Math.round(progress.done / progress.total * 100) : 0}%` }}/></span>
      {!mobile && <button className="settingsbutton reviewdone" disabled={busy} onClick={close}>{t('Done for now')}</button>}
    </header>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="reviewlayout">
      {!mobile && queueList}
      <div className="reviewcontent" ref={content} tabIndex={-1} role="region" aria-label={selected === 'inbox' ? t('Inbox review') : unit?.name ?? t('Review progress')}>
        {loading && !overview && <p role="status">{t('Loading review…')}</p>}
        {selected === 'inbox' ? <>
          <div className="reviewunit">
            <p className="reviewmeta">{t('First step · no schedule')}</p>
            <h2>{t('Clear Inbox')}</h2>
            <p className="settingshint">{t('Clarify and organize each entry. You do not need to finish the work now.')}</p>
          </div>
          <div className="reviewtasks">{tasks.map(task => row(task, true))}</div>
          {!tasks.length && !loading && <p className="reviewempty">{t('Inbox clear.')}</p>}
          {capture}
          <div className="reviewbar"><span className="reviewbarspace"/><button className="settingsbutton primary reviewconfirm" disabled={disabled} onClick={() => void step(1)}>{tasks.length ? t('Continue with Inbox remaining') : t('Continue')}</button></div>
        </> : unit ? <>
          <div className="reviewunit">
            <p className="reviewmeta">{project ? [t(project.status === 'someday' ? 'Someday project' : 'Project'), areas.find(a => a.id === project.area_id)?.name, t(project.project_type === 'sequential' ? 'Sequential' : 'Parallel')].filter(Boolean).join(' · ') : t('List')}</p>
            <div className="reviewheading"><h2>{unit.name}</h2>{project && <button className="settingsbutton quiet" disabled={disabled} onClick={() => { setProjectEditor({ original: project, draft: project }); setLatestProject(project); setError(''); }}>{t('Edit project')}</button>}</div>
            {project?.notes && <div className="reviewnotes"><p className={notesOpen ? 'notes' : 'notes collapsed'}>{project.notes}</p><button className="settingsbutton quiet" aria-expanded={notesOpen} onClick={() => setNotesOpen(open => !open)}>{notesOpen ? t('Hide notes') : t('Show notes')}</button></div>}
            {unit.id === 'list:someday-ideas' && <p className="settingshint">{t('Loose ideas share this schedule. Someday projects have their own intervals.')}</p>}
          </div>
          <div className="reviewtasks">{reviewTaskGroups(tasks).map(group => <section key={group.name} aria-label={group.name}><h3>{group.name}</h3>{group.tasks.map(task => row(task))}</section>)}</div>
          {!tasks.length && !loading && <p className="reviewempty">{t('No unfinished actions. Check whether this project or list is still relevant.')}</p>}
          {capture}
          {undo && <p role="status" className="reviewundo">{t('Reviewed:')} {undo.name} <button className="settingsbutton quiet" disabled={disabled} onClick={() => void action(async () => { await api.undoReview(undo.id, undo.revision); const id = undo.id; setUndo(null); setReviewed(ids => ids.filter(item => item !== id)); await refresh(id); })}>{t('Undo review')}</button></p>}
          <div className="reviewbar">
            <button className="reviewschedule" title={t('Schedule / Postpone…')} disabled={disabled} onClick={() => { setSchedule(structuredClone(unit)); setScheduleOriginal(unit); setError(''); }}>
              <small>{t('Last reviewed:')} {unit.schedule.last_reviewed ? reviewDate(unit.schedule.last_reviewed, today) : t('Never')}</small>
              <span>{t(`Every {n} ${unit.schedule.interval === 1 ? unit.schedule.unit.slice(0, -1) : unit.schedule.unit}`, { n: unit.schedule.interval })}</span>
            </button>
            {project && <div className="segmented" role="group" aria-label={t('Project status')}>{projectStates.map(([status, label]) => <button key={status} aria-pressed={project.status === status} disabled={disabled} onClick={() => void setStatus(status)}>{t(label)}</button>)}</div>}
            <span className="reviewbarspace"/>
            <button className="settingsbutton reviewstep" aria-label={t('Previous step')} title={t('Previous step')} disabled={disabled || stepIds.indexOf(unit.id) <= 0} onClick={() => void step(-1)}><span aria-hidden="true">‹</span></button>
            <button className="settingsbutton reviewstep" aria-label={t('Skip for now')} title={t('Skip for now')} disabled={disabled} onClick={() => void step(1)}><span aria-hidden="true">›</span></button>
            <button className="settingsbutton primary reviewconfirm" disabled={disabled || !unit.confirm_next} onClick={() => void confirm()}>{t('Mark Reviewed →')} {unit.confirm_next ? reviewDate(unit.confirm_next, today) : t('Date out of range')}</button>
          </div>
        </> : !loading && <div className="reviewend">
          {!due.length && <span className="reviewendmark" aria-hidden="true"><Icon name="completed" size={32}/></span>}
          <h2>{due.length ? t('Review paused') : t('No reviews due')}</h2>
          <p>{due.length ? t('Choose a remaining unit to continue.') : t('You can still open an upcoming project or list to review early.')}</p>
          <p className="settingshint">{t('{inbox} Inbox items remaining · {skipped} reviews skipped · {postponed} postponed this visit', { inbox: overview?.inbox_count ?? 0, skipped: skipped.filter(id => id !== 'inbox' && due.some(u => u.id === id)).length, postponed: postponed.length })}</p>
          {undo && <p role="status" className="reviewundo">{t('Reviewed:')} {undo.name} <button className="settingsbutton quiet" disabled={disabled} onClick={() => void action(async () => { await api.undoReview(undo.id, undo.revision); const id = undo.id; setUndo(null); setReviewed(ids => ids.filter(item => item !== id)); await refresh(id); })}>{t('Undo review')}</button></p>}
          <div className="settingsactions">
            {due.length > 0 && overview && <button className="settingsbutton" disabled={disabled} onClick={() => void choose(nextReview(overview.units, []))}>{t('Continue review')}</button>}
            <button className="settingsbutton primary" disabled={busy} onClick={close}>{t('Done')}</button>
          </div>
        </div>}
      </div>
    </div>
    {mobile && queueOpen && <Dialog title={t('Review steps')} onClose={() => setQueueOpen(false)}>{queueList}</Dialog>}
    {taskEditor && latestTask && <Dialog title={t('Edit review task')} variant={mobile ? 'editor' : undefined} onClose={() => { if (!editorDirty) closeTask(); else setError(t('Save changes or use Cancel to discard this task draft.')); }}>
      <TaskDetails task={latestTask} editor={taskEditor} setEditor={setTaskEditor} projects={projects} areas={areas} knownTags={knownTags} people={people} busy={busy} error={error} onSave={saveTask} onClose={closeTask} onCancel={closeTask} onDirtyChange={setEditorDirty} mobile={mobile}/>
    </Dialog>}
    {projectEditor && latestProject && <Dialog title={t('Edit review project')} variant={mobile ? 'editor' : undefined} onClose={() => { if (!editorDirty) closeProject(); else setError(t('Save changes or use Cancel to discard this project draft.')); }}>
      <ProjectDetails project={latestProject} editor={projectEditor} setEditor={setProjectEditor} areas={areas} knownTags={knownTags} busy={busy} error={error} onSave={saveProject} onClose={closeProject} onCancel={closeProject} onDirtyChange={setEditorDirty} mobile={mobile}/>
    </Dialog>}
    {schedule && <Dialog title={t('Review schedule')} onClose={() => { if (!scheduleDirty) setSchedule(null); else setError(t('Save or cancel the schedule draft.')); }}>
      <form className="projectdialogform" onSubmit={e => { e.preventDefault(); void action(async () => {
        await api.reviewSchedule(schedule.id, schedule.revision, schedule.schedule);
        const deferred = !!(schedule.schedule.next_review && overview && schedule.schedule.next_review > overview.today && scheduleOriginal?.due);
        if (deferred) setPostponed(p => [...new Set([...p, schedule.id])]);
        setSchedule(null);
        if (deferred) { const o = await api.reviews(); await refresh(reviewAfter(stepIds, o.units, skipped, schedule.id)); }
        else await refresh();
      }); }}><p>{schedule.name}</p><label>{t('Review every')}<input type="number" min={1} max={1000} required disabled={busy} value={schedule.schedule.interval} onChange={e => setSchedule({ ...schedule, schedule: { ...schedule.schedule, interval: Number(e.target.value) } })}/></label>
        <label>{t('Interval unit')}<select disabled={busy} value={schedule.schedule.unit} onChange={e => setSchedule({ ...schedule, schedule: { ...schedule.schedule, unit: e.target.value as ReviewUnit['schedule']['unit'] } })}><option value="days">{t('Days')}</option><option value="weeks">{t('Weeks')}</option><option value="months">{t('Months')}</option></select></label>
        <div className="reviewpresets" role="group" aria-label={t('Review interval presets')}>{([[1, 'weeks', 'Weekly'], [2, 'weeks', 'Every 2 weeks'], [4, 'weeks', 'Every 4 weeks'], [3, 'months', 'Every 3 months']] as const).map(([interval, unit, label]) => <button type="button" key={label} disabled={busy} onClick={() => setSchedule({ ...schedule, schedule: { ...schedule.schedule, interval, unit } })}>{t(label)}</button>)}</div>
        <DateField label={t('Next review')} value={schedule.schedule.next_review} disabled={busy} onChange={next_review => setSchedule({ ...schedule, schedule: { ...schedule.schedule, next_review } })}/>
        <p className="hint">{t('Changing this date postpones or brings forward the review without marking it reviewed. No date means review now.')}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialogactions"><button type="button" disabled={busy} onClick={() => setSchedule(null)}>{t('Cancel')}</button><button className="primary" disabled={busy || !scheduleDirty}>{t('Save schedule')}</button></div>
      </form>
    </Dialog>}
    {discard && <Dialog title={t('Discard review draft?')} onClose={() => setDiscard(false)}><p>{t('Saved reviews and tasks are kept. The unsaved draft will be discarded.')}</p><div className="dialogactions"><button onClick={() => setDiscard(false)}>{t('Keep editing')}</button><button onClick={onClose}>{t('Discard draft and close')}</button></div></Dialog>}
  </section>;
}
