import { useEffect, useId, useState } from 'react';
import { api, type Area, type Tag } from './api';
import Dialog from './Dialog';
import './ManageTags.css';
import { t } from './i18n.ts';

type Tab = 'areas' | 'person' | 'tag';
type Entry = Area | Tag;
const tabs: { id: Tab; label: string; newLabel: string; nameLabel: string; empty: string }[] = [
  { id: 'areas', label: 'Areas', newLabel: 'New area', nameLabel: 'Area name', empty: 'No areas.' },
  { id: 'person', label: 'Contacts', newLabel: 'New contact', nameLabel: 'Contact name', empty: 'No contacts.' },
  { id: 'tag', label: 'Tags', newLabel: 'New tag', nameLabel: 'Tag name', empty: 'No tags.' },
];

export default function ManageTags({ onClose, onChanged }: { onClose: () => void; onChanged: () => void | Promise<void> }) {
  const [tab, setTab] = useState<Tab>('tag');
  const [areas, setAreas] = useState<Area[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadNumber, setLoadNumber] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Entry | 'new' | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'tag' | 'person'>('tag');
  const [discard, setDiscard] = useState(false);
  const id = useId();
  const current = tabs.find(item => item.id === tab)!;
  const entries: Entry[] = (tab === 'areas' ? areas : tags.filter(tag => tag.kind === tab))
    .filter(entry => showArchived || !entry.archived)
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  const dirty = editing === 'new' ? !!name.trim() : !!editing && (name !== editing.name || ('kind' in editing && kind !== editing.kind));

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([api.areas(), api.tags()]).then(([nextAreas, nextTags]) => {
      if (active) { setAreas(nextAreas); setTags(nextTags); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadNumber]);

  function close() {
    if (busy) return;
    if (dirty) setDiscard(true); else onClose();
  }
  function edit(entry: Entry | 'new') {
    setEditing(entry); setName(entry === 'new' ? '' : entry.name);
    setKind(entry !== 'new' && 'kind' in entry ? entry.kind : tab === 'person' ? 'person' : 'tag');
    setError('');
  }
  function remember(entry: Entry) {
    if ('kind' in entry) setTags(current => [...current.filter(item => item.id !== entry.id), entry]);
    else setAreas(current => [...current.filter(item => item.id !== entry.id), entry]);
  }
  async function change(operation: () => Promise<Entry>) {
    setBusy(true); setError('');
    try {
      remember(await operation()); setEditing(null); setName('');
      try { await onChanged(); }
      catch { setError(t('Saved. Refresh the main list to see the changes.')); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  function save() {
    if (!editing || !name.trim() || busy) return;
    if (editing === 'new') {
      void change(() => tab === 'areas' ? api.addArea(name.trim()) : api.addTag(name.trim(), kind));
    } else if ('kind' in editing) {
      void change(() => api.updateTag(editing.id, { name: name.trim(), kind }, { name: editing.name, kind: editing.kind, archived: editing.archived }));
    } else {
      void change(() => api.updateArea(editing.id, { name: name.trim() }, { name: editing.name, archived: editing.archived }));
    }
  }
  function archive(entry: Entry) {
    if (busy) return;
    void change(() => 'kind' in entry
      ? api.updateTag(entry.id, { archived: !entry.archived }, { name: entry.name, kind: entry.kind, archived: entry.archived })
      : api.updateArea(entry.id, { archived: !entry.archived }, { name: entry.name, archived: entry.archived }));
  }
  const editor = <form className="manageeditor" onSubmit={event => { event.preventDefault(); save(); }}>
    <input autoFocus aria-label={t(current.nameLabel)} value={name} disabled={busy} maxLength={255} onChange={event => setName(event.target.value)} />
    {tab !== 'areas' && <select aria-label={t('Tag type')} value={kind} disabled={busy} onChange={event => setKind(event.target.value as 'tag' | 'person')}><option value="tag">{t('Tag')}</option><option value="person">{t('Contact')}</option></select>}
    <div className="manageeditoractions"><button type="button" disabled={busy} onClick={() => { setEditing(null); if (error) setLoadNumber(value => value + 1); setError(''); }}>{t('Cancel')}</button><button className="primary" disabled={busy || !name.trim()}>{busy ? t('Saving…') : editing === 'new' ? t('Create') : t('Save')}</button></div>
  </form>;

  return <Dialog title={t('Manage Tags')} onClose={close}>
    <section className="managetags" aria-busy={busy || loading}>
      <div className="managetabs" role="tablist" aria-label={t('Manage tag categories')}>
        {tabs.map((item, index) => <button key={item.id} role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-panel`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} disabled={busy || !!editing} onClick={() => { setTab(item.id); setError(''); }} onKeyDown={event => {
          let next: number;
          if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabs.length - 1;
          else return;
          event.preventDefault(); setTab(tabs[next].id); document.getElementById(`${id}-${tabs[next].id}`)?.focus();
        }}>{t(item.label)}</button>)}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
        <div className="managetoolbar"><button disabled={loading || busy || !!editing} onClick={() => edit('new')}>{t(current.newLabel)}</button><label><input type="checkbox" checked={showArchived} disabled={busy || !!editing} onChange={event => setShowArchived(event.target.checked)} />{t('Show archived')}</label></div>
        {editing === 'new' && editor}
        {loading ? <p role="status">{t('Loading…')}</p> : <ul className="manageentries">{entries.map(entry => <li key={entry.id} className={entry.archived ? 'archivedentry' : ''}>
          {editing !== 'new' && editing?.id === entry.id ? editor : <>
            <span className="manageentryname">{entry.name}{entry.archived && <small>{t('Archived')}</small>}</span>
            <div className="manageentryactions"><button disabled={busy || !!editing} aria-label={t('Edit {name}', { name: entry.name })} onClick={() => edit(entry)}>{t('Edit')}</button><button disabled={busy || !!editing} aria-label={t(entry.archived ? 'Restore {name}' : 'Archive {name}', { name: entry.name })} onClick={() => archive(entry)}>{entry.archived ? t('Restore') : t('Archive')}</button></div>
          </>}
        </li>)}</ul>}
        {!loading && entries.length === 0 && <p className="manageempty">{t(current.empty)}</p>}
        <p className="managearchivehint">{t('Archived items keep their existing assignments.')}</p>
      </div>
    </section>
    <div className="dialogactions"><button className="primary" disabled={busy} onClick={close}>{t('Done')}</button></div>
    {discard && <Dialog title={t('Discard changes?')} onClose={() => setDiscard(false)}><p>{t('Your unsaved changes will be lost.')}</p><div className="dialogactions"><button onClick={() => setDiscard(false)}>{t('Keep editing')}</button><button className="primary" onClick={onClose}>{t('Discard changes')}</button></div></Dialog>}
  </Dialog>;
}
