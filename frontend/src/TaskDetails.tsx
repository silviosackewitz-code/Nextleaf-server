import { editableFields } from './taskEdit';
import { editorConflicts, type EditorState } from './editorState';
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Area, Project, Task } from './api';
import { TagEditor, TaskFields } from './TaskFields';
import { TaskChanges, taskChanges } from './taskEdit';

export default function TaskDetails({ task, editor, setEditor, projects, areas, knownTags, people, busy, error, onSave, onClose, onCancel = onClose, onDirtyChange, mobile = false }: {
  editor: EditorState<Task>; setEditor: Dispatch<SetStateAction<EditorState<Task> | null>>;
  task: Task; projects: Project[]; areas: Area[]; knownTags: string[]; people: string[]; busy: boolean; error: string;
  onSave: (changes: TaskChanges, original: Task) => Promise<boolean>; onClose: () => void; onCancel?: () => void; onDirtyChange: (dirty: boolean) => void; mobile?: boolean;
}) {
  const { original, draft } = editor;
  const conflicts = editorConflicts(editor, task, editableFields);
  const changes = taskChanges(original, draft);
  const dirty = Object.keys(changes).length > 0;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  function change(values: TaskChanges) { setEditor(previous => previous && ({ ...previous, draft: { ...previous.draft, ...values } })); }
  return <form className="taskdetails" id={`task-details-${task.id}`} aria-label={`Details for ${task.title}`} onSubmit={async event => { event.preventDefault(); if (!conflicts.length && await onSave(changes, original)) onClose(); }}>
    {mobile && <div className="mobileeditorbar"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><strong>Task</strong><button className="primary" type={dirty ? 'submit' : 'button'} disabled={busy || !!conflicts.length || !draft.title.trim()} onClick={dirty ? undefined : onClose}>{dirty ? 'Save' : 'Done'}</button></div>}
    <div className="editorheading"><button type="button" className={`focusstar ${draft.starred ? 'focused' : ''}`} aria-label="Focus" aria-pressed={draft.starred} disabled={busy} onClick={() => change({ starred: !draft.starred })}><span aria-hidden="true">{draft.starred ? '★' : '☆'}</span></button><textarea rows={2} aria-label="Task title" required autoFocus={!mobile} disabled={busy} value={draft.title} onChange={event => change({ title: event.target.value.replace(/\n/g, ' ') })}/></div>
    {error && <p role="alert" className="error">{error}</p>}
    {conflicts.map(field => <div role="alert" className="error" key={String(field)}>
      <p>{String(field)} changed elsewhere. Your draft: {JSON.stringify(draft[field])}. Saved value: {JSON.stringify(task[field])}.</p>
      <button type="button" disabled={busy} onClick={() => setEditor(previous => previous && ({ ...previous, original: { ...previous.original, [field]: task[field] } }))}>Keep my edit</button>
      <button type="button" disabled={busy} onClick={() => setEditor(previous => previous && ({ original: { ...previous.original, [field]: task[field] }, draft: { ...previous.draft, [field]: task[field] } }))}>Use saved value</button>
    </div>)}
    <div className="detaillayout">
      <div className="detailcontent">
        <TagEditor knownTags={knownTags} areas={areas} areaId={(draft.project_id ? projects.find(p => p.id === draft.project_id)?.area_id : draft.area_id) ?? null} areaDisabled={!!draft.project_id} onAreaChange={area_id => change({ area_id })} tags={draft.tags} disabled={busy} onChange={tags => change({ tags })}/>
        <label className="noteslabel">Notes<textarea disabled={busy} value={draft.notes} onChange={event => change({ notes: event.target.value })}/></label>
        {task.blocked_by_sequence && <p className="hint">Blocked by an earlier task in this sequential project.</p>}
        {task.status === 'recurring' && !task.recurrence && <p className="hint">Repeat schedule unavailable from Nirvana. Automatic repeats are not active.</p>}
        <div className="dialogactions desktopeditoractions"><button className="primary" disabled={busy || !!conflicts.length || !dirty || !draft.title.trim()}>Save changes</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
      </div>
      <div className="detailfields">
        <TaskFields task={draft} projects={projects} areas={areas} people={people} disabled={busy} onChange={change} groups={['Time', 'Energy', 'Due', 'Status', 'Project']}/>

      </div>
    </div>
  </form>;
}
