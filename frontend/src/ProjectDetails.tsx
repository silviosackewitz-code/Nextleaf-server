import { projectFields } from './projectEdit';
import { editorConflicts, type EditorState } from './editorState';
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Area, Project } from './api';
import { TagEditor } from './TaskFields';
import { projectChanges, type ProjectChanges } from './projectEdit';
import DateField from './DateField';

export default function ProjectDetails({ project, editor, setEditor, areas, knownTags, busy, error, onSave, onClose, onCancel = onClose, onDirtyChange, mobile = false }: {
  editor: EditorState<Project>; setEditor: Dispatch<SetStateAction<EditorState<Project> | null>>;
  project: Project; areas: Area[]; knownTags: string[]; busy: boolean; error: string;
  onSave: (changes: ProjectChanges, original: Project) => Promise<boolean>; onClose: () => void; onCancel?: () => void; onDirtyChange: (dirty: boolean) => void; mobile?: boolean;
}) {
  const { original, draft } = editor;
  const conflicts = editorConflicts(editor, project, projectFields);
  const changes = projectChanges(original, draft);
  const dirty = Object.keys(changes).length > 0;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  function change(values: ProjectChanges) { setEditor(previous => previous && ({ ...previous, draft: { ...previous.draft, ...values } })); }
  return <form className="taskdetails" aria-label={`Project settings for ${project.name}`} onSubmit={async event => { event.preventDefault(); if (!conflicts.length && await onSave(changes, original)) onClose(); }}>
    {mobile && <div className="mobileeditorbar"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><strong>Project</strong><button className="primary" type={dirty ? 'submit' : 'button'} disabled={busy || !!conflicts.length || !draft.name.trim()} onClick={dirty ? undefined : onClose}>{dirty ? 'Save' : 'Done'}</button></div>}
    <div className="editorheading"><button type="button" className={`focusstar ${draft.starred ? 'focused' : ''}`} aria-label="Focus" aria-pressed={draft.starred} disabled={busy} onClick={() => change({ starred: !draft.starred })}><span aria-hidden="true">{draft.starred ? '★' : '☆'}</span></button><textarea rows={1} autoFocus={!mobile} required aria-label="Project name" disabled={busy} value={draft.name} onChange={event => change({ name: event.target.value.replace(/\n/g, ' ') })}/></div>
    {error && <p role="alert" className="error">{error}</p>}
    {conflicts.map(field => <div role="alert" className="error" key={String(field)}>
      <p>{String(field)} changed elsewhere. Your draft: {JSON.stringify(draft[field])}. Saved value: {JSON.stringify(project[field])}.</p>
      <button type="button" disabled={busy} onClick={() => setEditor(previous => previous && ({ ...previous, original: { ...previous.original, [field]: project[field] } }))}>Keep my edit</button>
      <button type="button" disabled={busy} onClick={() => setEditor(previous => previous && ({ original: { ...previous.original, [field]: project[field] }, draft: { ...previous.draft, [field]: project[field] } }))}>Use saved value</button>
    </div>)}
    <div className="detaillayout"><div className="detailcontent">
      <TagEditor tags={draft.tags} knownTags={knownTags} disabled={busy} onChange={tags => change({ tags })} areas={areas} areaId={draft.area_id} onAreaChange={area_id => change({ area_id })}/>
      <label className="noteslabel">Notes<textarea disabled={busy} value={draft.notes} onChange={event => change({ notes: event.target.value })}/></label>
      <div className="dialogactions desktopeditoractions"><button className="primary" disabled={busy || !!conflicts.length || !dirty || !draft.name.trim()}>Save changes</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
    </div><div className="detailfields">
      <DateField label="Due" value={draft.due_date} disabled={busy} onChange={due_date => change({ due_date })}/>
      <label className="propertyfield"><span aria-hidden="true">⊙</span><select aria-label="Project status" disabled={busy} value={draft.status} onChange={event => change({ status: event.target.value })}><option value="active">Active Project</option><option value="someday">Someday</option><option value="completed">Completed</option></select></label>
      <label className="propertyfield"><span aria-hidden="true">⇥</span><select aria-label="Project type" disabled={busy} value={draft.project_type} onChange={event => change({ project_type: event.target.value as Project['project_type'] })}><option value="parallel">Parallel</option><option value="sequential">Sequential</option></select></label>
    </div></div>
  </form>;
}
