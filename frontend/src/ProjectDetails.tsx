import { projectFields } from './projectEdit';
import { editorConflicts, type EditorState } from './editorState';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { Area, Project } from './api';
import { TagEditor } from './TaskFields';
import { projectChanges, type ProjectChanges } from './projectEdit';
import DateField from './DateField';
import Dialog from './Dialog';
import { t } from './i18n.ts';

export default function ProjectDetails({ project, editor, setEditor, areas, knownTags, busy, error, onSave, onClose, onCancel = onClose, onDirtyChange, mobile = false }: {
  editor: EditorState<Project>; setEditor: Dispatch<SetStateAction<EditorState<Project> | null>>;
  project: Project; areas: Area[]; knownTags: string[]; busy: boolean; error: string;
  onSave: (changes: ProjectChanges, original: Project) => Promise<boolean>; onClose: () => void; onCancel?: () => void; onDirtyChange: (dirty: boolean) => void; mobile?: boolean;
}) {
  const { original, draft } = editor;
  const conflicts = editorConflicts(editor, project, projectFields);
  const changes = projectChanges(original, draft);
  const dirty = Object.keys(changes).length > 0;
  const [confirmTrash, setConfirmTrash] = useState(false);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  function change(values: ProjectChanges) { setEditor(previous => previous && ({ ...previous, draft: { ...previous.draft, ...values } })); }
  return <><form className="taskdetails" aria-label={t('Project settings for {name}', { name: project.name })} onSubmit={async event => { event.preventDefault(); if (!conflicts.length && await onSave(changes, original)) onClose(); }}>
    {mobile && <div className="mobileeditorbar"><button type="button" disabled={busy} onClick={onCancel}>{t('Cancel')}</button><strong>{t('Project')}</strong><button className="primary" type={dirty ? 'submit' : 'button'} disabled={busy || !!conflicts.length || !draft.name.trim()} onClick={dirty ? undefined : onClose}>{dirty ? t('Save') : t('Done')}</button></div>}
    <div className="editorheading"><button type="button" className={`focusstar ${draft.starred ? 'focused' : ''}`} aria-label={t('Focus')} aria-pressed={draft.starred} disabled={busy} onClick={() => change({ starred: !draft.starred })}><span aria-hidden="true">{draft.starred ? '★' : '☆'}</span></button><textarea rows={1} autoFocus={!mobile} required aria-label={t('Project name')} disabled={busy} value={draft.name} onChange={event => change({ name: event.target.value.replace(/\n/g, ' ') })}/></div>
    {error && <p role="alert" className="error">{error}</p>}
    {conflicts.map(field => <div role="alert" className="error" key={String(field)}>
      <p>{t('{field} changed elsewhere. Your draft: {draft}. Saved value: {saved}.', { field: t(String(field)), draft: JSON.stringify(draft[field]), saved: JSON.stringify(project[field]) })}</p>
      <button type="button" disabled={busy} onClick={() => setEditor(previous => previous && ({ ...previous, original: { ...previous.original, [field]: project[field] } }))}>{t('Keep my edit')}</button>
      <button type="button" disabled={busy} onClick={() => setEditor(previous => previous && ({ original: { ...previous.original, [field]: project[field] }, draft: { ...previous.draft, [field]: project[field] } }))}>{t('Use saved value')}</button>
    </div>)}
    <div className="detaillayout"><div className="detailcontent">
      <TagEditor tags={draft.tags} knownTags={knownTags} disabled={busy} onChange={tags => change({ tags })} areas={areas} areaId={draft.area_id} onAreaChange={area_id => change({ area_id })}/>
      <label className="noteslabel">{t('Notes')}<textarea disabled={busy} value={draft.notes} onChange={event => change({ notes: event.target.value })}/></label>
      <div className="dialogactions desktopeditoractions"><button className="primary" disabled={busy || !!conflicts.length || !dirty || !draft.name.trim()}>{t('Save changes')}</button><button type="button" disabled={busy} onClick={onCancel}>{t('Cancel')}</button></div>
    </div><div className="detailfields">
      <DateField label={t('Due')} value={draft.due_date} disabled={busy} onChange={due_date => change({ due_date })}/>
      <label className="propertyfield"><span aria-hidden="true">⊙</span><select aria-label={t('Project status')} disabled={busy} value={draft.status} onChange={event => change({ status: event.target.value })}><option value="active">{t('Active Project')}</option><option value="someday">{t('Someday')}</option><option value="completed">{t('Completed')}</option></select></label>
      <label className="propertyfield"><span aria-hidden="true">⇥</span><select aria-label={t('Project type')} disabled={busy} value={draft.project_type} onChange={event => change({ project_type: event.target.value as Project['project_type'] })}><option value="parallel">{t('Parallel')}</option><option value="sequential">{t('Sequential')}</option></select></label>
      <button type="button" className="projecttrash" disabled={busy || dirty} title={dirty ? t('Save or cancel your changes first.') : undefined} onClick={() => setConfirmTrash(true)}>{t('Move to Trash…')}</button>
    </div></div>
  </form>
  {/* Escape belongs to the confirmation alone; the row behind it would otherwise close the editor as well. */}
  {confirmTrash && <div className="dialoghost" onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}><Dialog title={t('Move project to Trash?')} onClose={() => setConfirmTrash(false)}>
    <p>{t('“{name}” and its unfinished actions move to Trash. Restore the project there to bring everything back.', { name: project.name })}</p>
    <div className="dialogactions"><button type="button" disabled={busy} onClick={() => setConfirmTrash(false)}>{t('Cancel')}</button><button type="button" className="primary" disabled={busy} onClick={async () => { setConfirmTrash(false); if (await onSave({ trashed: true }, original)) onClose(); }}>{t('Move to Trash')}</button></div>
  </Dialog></div>}
  </>;
}
