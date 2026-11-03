import ReviewWorkspace from './ReviewWorkspace';
import PerspectiveEditor from './PerspectiveEditor';
import { capturePerspective, emptyPerspective, perspectiveGroups, ruleLabels, type Perspective, type PerspectiveDefinition, type PerspectiveInput } from './perspectives';
import { refreshEditor, type EditorState } from './editorState';
import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, Area, getApiBase, getStoredApiUrl, Project, Tag, Task, View } from './api';
import DateField from './DateField';
import ManageTags from './ManageTags';
import AppearanceSettings from './AppearanceSettings';
import SidebarSettings from './SidebarSettings';
import { loadSidebarPreferences, sidebarPreferencesKey, type SidebarPreferences } from './sidebarPreferences';
import McpSettings from './McpSettings';
import ProjectDetails from './ProjectDetails';
import { projectFields, projectRows, projectExpected, type ProjectChanges } from './projectEdit';
import TaskDetails from './TaskDetails';
import TaskActions from './TaskActions';
import { editableFields, taskExpected, type TaskChanges } from './taskEdit';
import Dialog from './Dialog';
import useMobile from './useMobile';
import { submenuPosition, timeOptions } from './quickMenu';
import NewItemMenu, { viewLabel } from './NewItemMenu';
import { captureTarget, defaultDisplay, readDisplayOptions, viewGrouping, type DisplayOptions } from './viewOptions';
import { UNTAGGED, type TagFilter, RecentCompletion, withRecentCompletions, taskGroups, sequentialTasks, taskPeople, filterTasksByTag, isOverdue, emptyTaskFilters, filterTaskProperties, navigationCounts, sidebarFilterGroups } from './taskList';

const menus: { view: View; title: string; symbol: string }[] = [
  { view: 'focus', title: 'Focus', symbol: '☆' },
  { view: 'inbox', title: 'Inbox', symbol: '↧' },
  { view: 'next', title: 'Next', symbol: '→' },
  { view: 'waiting', title: 'Waiting', symbol: '◷' },
  { view: 'scheduled', title: 'Scheduled', symbol: '▦' },
  { view: 'someday', title: 'Someday', symbol: '◇' },
  { view: 'later', title: 'Later', symbol: '⋯' },
  { view: 'completed', title: 'Logbook', symbol: '✓' },
  { view: 'all', title: 'All tasks', symbol: '≡' },
  { view: 'trash', title: 'Trash', symbol: '⌫' },
];

const archiveViews: View[] = ['completed', 'all', 'trash'];

export default function App() {
  const mobile = useMobile();
  const [review, setReview] = useState<{ project?: string } | null>(null);
  const [reviewDue, setReviewDue] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => { if (!mobile) setDrawerOpen(false); }, [mobile]);
  const [sidebarPreferences, setSidebarPreferences] = useState(loadSidebarPreferences);
  const [sidebarError, setSidebarError] = useState('');
  const [view, setView] = useState<View | 'projects'>(() => sidebarPreferences.hiddenViews.includes('next') ? 'inbox' : 'next');
  const [perspectives, setPerspectives] = useState<Perspective[]>([]);
  const [perspectiveId, setPerspectiveId] = useState('');
  const [temporaryPerspective, setTemporaryPerspective] = useState<PerspectiveDefinition | null>(null);
  const [perspectiveEditor, setPerspectiveEditor] = useState<{initial: PerspectiveInput; original?: Perspective} | null>(null);
  const activePerspective = perspectives.find(p => p.id === perspectiveId);
  const perspectiveDefinition = temporaryPerspective ?? activePerspective?.definition;
  const [areaId, setAreaId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [areas, setAreas] = useState<Area[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [navigationTasks, setNavigationTasks] = useState<{ inbox: Task[]; focus: Task[]; waiting: Task[] }>({ inbox: [], focus: [], waiting: [] });
  const [newItemView, setNewItemView] = useState<View | null>(null);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemDate, setNewItemDate] = useState<string | null>(null);
  const [showNewTag, setShowNewTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [tagRecords, setTagRecords] = useState<Tag[]>([]);
  const knownTags = tagRecords.filter(tag => !tag.archived).map(tag => tag.name);
  const people = tagRecords.filter(tag => tag.kind === 'person' && !tag.archived).map(tag => tag.name);
  const allPeople = tagRecords.filter(tag => tag.kind === 'person').map(tag => tag.name);
  const [personFilter, setPersonFilter] = useState('');
  const [showManageTags, setShowManageTags] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [projectActionsOpen, setProjectActionsOpen] = useState(false);
  const viewPanel = useRef<HTMLDivElement>(null);
  const projectChoices = useRef<HTMLDivElement>(null);
  const projectChoicesButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const panel = projectChoices.current;
    if (!projectActionsOpen || !panel || mobile) return;
    panel.showPopover();
    const position = submenuPosition(viewPanel.current!.getBoundingClientRect(), projectChoicesButton.current!.getBoundingClientRect().top, panel.offsetWidth, panel.offsetHeight, { width: window.innerWidth, height: window.innerHeight });
    panel.style.left = `${position.left}px`; panel.style.top = `${position.top}px`;
  }, [projectActionsOpen, mobile]);
  const [propertyFilters, setPropertyFilters] = useState(emptyTaskFilters);
  const [tagFilter, setTagFilter] = useState<TagFilter>(null);
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [contactsExpanded, setContactsExpanded] = useState(true);
  const sidebarFilters = sidebarFilterGroups(tagRecords, navigationTasks.waiting);
  const [displaySettings, setDisplaySettings] = useState(() => readDisplayOptions(localStorage.getItem('nextleaf_display_options')));
  const displayKey = projectId ? 'project' : view;
  const display = perspectiveDefinition ? { ...defaultDisplay, notes: perspectiveDefinition.notes, projectLimit: perspectiveDefinition.project_limit } : displaySettings[displayKey] ?? (view === 'focus' ? { ...defaultDisplay, grouping: 'unified' as const } : defaultDisplay);
  const grouping = perspectiveDefinition?.grouping ?? viewGrouping(view, projectId, display);
  const hasViewOptions = !perspectiveId && !projectId && (view === 'next' || view === 'focus');
  async function setDisplay(changes: Partial<DisplayOptions>) {
    if ((changes.grouping || 'projectLimit' in changes) && !await clearRecent()) return;
    const next = { ...displaySettings, [displayKey]: { ...display, ...changes } };
    localStorage.setItem('nextleaf_display_options', JSON.stringify(next)); setDisplaySettings(next); setExpandedGroups([]);
  }
  const [newProject, setNewProject] = useState('');
  const [projectType, setProjectType] = useState<Project['project_type']>('parallel');
  const [apiUrl, setApiUrl] = useState(getStoredApiUrl());
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, [showSettings]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const selectedTaskId = useRef<string | null>(null);
  selectedTaskId.current = selectedTask?.id ?? null;
  const [taskEditor, setTaskEditor] = useState<EditorState<Task> | null>(null);
  const [projectEditor, setProjectEditor] = useState<EditorState<Project> | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const discardDecision = useRef<((discard: boolean) => void) | null>(null);
  const dirtyEditor = useRef(editorDirty);
  dirtyEditor.current = editorDirty;
  const recentCompletions = useRef(new Map<string, RecentCompletion>());
  const loadNumber = useRef(0);
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);

  const reload = useCallback(async () => {
    const requestNumber = ++loadNumber.current;
    try {
      const [a, p, t, completed, tags, badges, opened, savedViews] = await Promise.all([
        api.areas(), api.projects(), perspectiveId ? (temporaryPerspective ? api.previewPerspective(temporaryPerspective) : api.perspectiveTasks(perspectiveId)) : projectId ? api.tasks('all', areaId || undefined, projectId) : api.tasks(view === 'projects' ? 'all' : view, areaId || undefined),
        recentCompletions.current.size ? api.tasks('completed', areaId || undefined, projectId || undefined) : Promise.resolve([]),
        api.health().then(health => health.capabilities?.includes('item-creation') ? api.tags() : api.tasks('all').then(rows => [...new Set(rows.flatMap(task => task.tags))].sort().map(name => ({ id: name, name, kind: 'tag' as const, archived: false })))),
        Promise.all((['inbox', 'focus', 'waiting'] as const).map(target => api.tasks(target, areaId || undefined))),
        selectedTaskId.current ? api.task(selectedTaskId.current) : Promise.resolve(null),
        api.health().then(health => health.capabilities?.includes('perspectives') ? api.perspectives() : []),
      ]);
      if (requestNumber !== loadNumber.current) return;
      for (const [id, entry] of recentCompletions.current) {
        const task = completed.find(item => item.id === id);
        if (task) entry.task = task;
        else recentCompletions.current.delete(id);
      }
      void api.health().then(h => h.capabilities?.includes('reviews') ? api.reviews() : null).then(o => { if (requestNumber === loadNumber.current) setReviewDue(o ? o.units.filter(u => u.due).length : null); }).catch(() => {});
      setAreas(a); setProjects(p); setTagRecords(tags); setPerspectives(savedViews);
      setEditingProject(previous => previous ? p.find(project => project.id === previous.id) ?? previous : null);
      setNavigationTasks({ inbox: badges[0], focus: badges[1], waiting: badges[2] });
      setTasks(withRecentCompletions(t, recentCompletions.current.values()));
      setSelectedTask(previous => previous ? (opened?.id === previous.id ? opened : [...t, ...completed].find(task => task.id === previous.id)) ?? previous : null);
      setError('');
    } catch (e) { if (requestNumber === loadNumber.current) { if (perspectiveId) setTasks([]); setError(e instanceof Error ? e.message : String(e)); } }
  }, [view, areaId, projectId, perspectiveId, temporaryPerspective]);
  useEffect(() => {
    if (selectedTask) setTaskEditor(previous => previous ? refreshEditor(previous, selectedTask, editableFields) : null);
  }, [selectedTask]);
  useEffect(() => {
    if (editingProject) setProjectEditor(previous => previous ? refreshEditor(previous, editingProject, projectFields) : null);
  }, [editingProject]);
  useEffect(() => {
    void api.reportTimezone().then(reload).catch(() => reload());
    let zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const onVisible = () => { if (document.visibilityState === 'visible') void api.reportTimezone().then(() => { if (!dirtyEditor.current) void reload(); }).catch(() => {}); };
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const current = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone !== current) { zone = current; onVisible(); }
      else if (!dirtyEditor.current) void reload();
    }, 30000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const onFocus = () => { if (!dirtyEditor.current) void reload(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('nextleaf-data-changed', onFocus);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); ++loadNumber.current; window.removeEventListener('focus', onFocus); window.removeEventListener('nextleaf-data-changed', onFocus); };
  }, [reload]);
  const filteredProjects = useMemo(() => projects.filter(p => !areaId || p.area_id === areaId), [projects, areaId]);
  const badges = navigationCounts(navigationTasks, tagFilter);
  const scopedTasks = grouping === 'sequential' ? sequentialTasks(tasks) : tasks;
  const taggedTasks = filterTasksByTag(scopedTasks, tagFilter).filter(task => !personFilter || taskPeople(task, allPeople).includes(personFilter));
  const visibleTasks = filterTaskProperties(taggedTasks, propertyFilters);
  const filtersActive = tagFilter !== null || !!personFilter || !!propertyFilters.due || propertyFilters.minutes !== null || propertyFilters.energy !== null;
  const relevantTags = sidebarFilters.tags.filter(tag => view === 'projects' ? filteredProjects.some(project => project.tags.includes(tag)) : tasks.some(task => task.tags.includes(tag)) && (view !== 'waiting' || !allPeople.includes(tag)));
  const relevantPeople = [...new Set(tasks.flatMap(task => taskPeople(task, allPeople)))].sort();
  const selectedContact = typeof tagFilter === 'string' && sidebarFilters.contacts.includes(tagFilter) ? tagFilter : '';
  const activeContact = personFilter || selectedContact;
  const visibleContacts = [...new Set([...(view === 'waiting' ? relevantPeople : []), ...(activeContact ? [activeContact] : [])])];
  const visibleTags = [...new Set([...relevantTags, ...(typeof tagFilter === 'string' && !selectedContact ? [tagFilter] : [])])];
  const relevantAreaIds = new Set(view === 'projects' ? filteredProjects.map(project => project.area_id) : tasks.map(task => task.project_id ? projects.find(project => project.id === task.project_id)?.area_id : task.area_id));
  const relevantAreas = areas.filter(area => !area.archived && relevantAreaIds.has(area.id));
  const groups = perspectiveDefinition ? perspectiveGroups(visibleTasks, perspectiveDefinition, projects, areas) : taskGroups(visibleTasks, projects, projectId, grouping as DisplayOptions['grouping'], view);
  const limitProjects = grouping === 'project' && (!!perspectiveId || view === 'next' && !projectId);
  const activeProject = projects.find(p => p.id === projectId);
  const activeArea = areas.find(a => a.id === areaId);
  const titleText = perspectiveId ? activePerspective?.name ?? 'Perspective' : view === 'projects' ? 'Projects' : activeProject?.name ?? menus.find(m => m.view === view)?.title;
  const overview = projectRows(filteredProjects, tasks, tagFilter);

  async function action(callback: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try { await callback(); await reload(); return true; }
    catch (e) { await reload(); setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  }
  function saveTask(task: Task, changes: TaskChanges, original = task) {
    return action(async () => {
      const updated = await api.updateTask(task.id, changes, taskExpected(original, changes));
      const status = changes.status;
      if (status === 'completed' && task.status !== 'completed') {
        if (view !== 'completed' && view !== 'trash') {
          const index = tasks.findIndex(item => item.id === task.id);
          if (index >= 0) recentCompletions.current.set(task.id, { task: updated, previousStatus: task.status, index });
        }
      } else if (status && status !== 'completed') {
        recentCompletions.current.delete(task.id);
      }
      setTasks(previous => previous.map(item => item.id === updated.id ? updated : item));
      setSelectedTask(previous => previous?.id === updated.id ? updated : previous);
    });
  }
  function changeTaskStatus(task: Task, status: string) { void saveTask(task, { status }); }
  function toggleCompleted(task: Task) {
    changeTaskStatus(task, task.status === 'completed' ? recentCompletions.current.get(task.id)?.previousStatus ?? 'next' : 'completed');
  }
  async function canLeaveEditor() {
    if (!dirtyEditor.current) return true;
    if (discardDecision.current) return false;
    return new Promise<boolean>(resolve => { discardDecision.current = resolve; setShowDiscard(true); });
  }
  function decideDiscard(discard: boolean) {
    const resolve = discardDecision.current;
    discardDecision.current = null;
    setShowDiscard(false);
    resolve?.(discard);
  }
  async function openReview(project?: string) {
    if (!await clearRecent()) return;
    try {
      if (!(await api.health()).capabilities?.includes('reviews')) { setError('Update the server to use Review.'); return; }
      setDrawerOpen(false); setReview({ project });
    } catch (e) { setError((e as Error).message); }
  }
  async function openTask(task: Task) {
    if (!await canLeaveEditor()) return;
    setEditorDirty(false); setError(''); setSelectedTask(task); setTaskEditor({ original: task, draft: task }); setEditingProject(null); setProjectEditor(null);
  }
  async function clearRecent() {
    if (busy || !await canLeaveEditor()) return false;
    setEditorDirty(false);
    ++loadNumber.current;
    const completedIds = new Set(recentCompletions.current.keys());
    setTasks(previous => previous.filter(task => !completedIds.has(task.id)));
    recentCompletions.current.clear();
    setSelectedTask(null); setEditingProject(null); setTaskEditor(null); setProjectEditor(null);
    return true;
  }
  async function refreshView() {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      if (!await clearRecent()) return;
      setRefreshing(true);
      await reload();
    } finally { refreshInFlight.current = false; setRefreshing(false); }
  }
  async function changeFilters(changes: { tag?: TagFilter; person?: string; properties?: typeof emptyTaskFilters }) {
    if (!await clearRecent()) return;
    if ('tag' in changes) setTagFilter(changes.tag ?? null);
    if (changes.person !== undefined) setPersonFilter(changes.person);
    if (changes.properties) setPropertyFilters(changes.properties);
    setExpandedGroups([]);
    await reload();
  }
  async function changeView(next: View | 'projects') { if (!await clearRecent()) return; leavePerspective(); setView(next); setProjectId(''); setPersonFilter(''); setPropertyFilters(emptyTaskFilters); setExpandedGroups([]); setDrawerOpen(false); setShowSettings(false); }
  async function selectArea(id: string) { if (!await clearRecent()) return; setAreaId(id); setProjectId(''); }
  async function selectProject(id: string) { if (!await clearRecent()) return; leavePerspective(); if (view === 'projects') setTagFilter(null); setProjectId(id); setView('all'); setPersonFilter(''); setPropertyFilters(emptyTaskFilters); setExpandedGroups([]); setDrawerOpen(false); setShowSettings(false); }
  function leavePerspective() {
    if (perspectiveId) { setAreaId(''); setTagFilter(null); setPersonFilter(''); setPropertyFilters(emptyTaskFilters); }
    setPerspectiveId(''); setTemporaryPerspective(null);
  }
  async function openPerspective(id: string) {
    if (!await clearRecent()) return;
    setPerspectiveId(id); setTemporaryPerspective(null); setAreaId(''); setProjectId(''); setTagFilter(null); setPersonFilter(''); setPropertyFilters(emptyTaskFilters); setView('all'); setExpandedGroups([]); setTasks([]); setDrawerOpen(false); setShowSettings(false);
  }
  async function editPerspective(mode: 'new' | 'capture' | 'edit' | 'duplicate', target?: Perspective) {
    if (!await clearRecent()) return;
    try {
      const health = await api.health();
      if (!health.capabilities?.includes('perspectives')) { setError('Update the server before saving Perspectives.'); return; }
      const original = target ?? activePerspective;
      const definition = mode === 'new' ? emptyPerspective() : target?.definition ?? perspectiveDefinition ?? capturePerspective(view, areaId, projectId, tagFilter, personFilter, propertyFilters, tagRecords, {...display, grouping: grouping as DisplayOptions['grouping']});
      setPerspectiveEditor({ initial: { name: mode === 'new' ? '' : original ? original.name + (mode === 'duplicate' ? ' copy' : '') : titleText ?? '', definition, sort_order: mode === 'edit' ? original!.sort_order : Math.max(0,...perspectives.map(p=>p.sort_order))+100 }, original: mode === 'edit' ? original : undefined });
      setDrawerOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function chooseSidebarTag(tag: TagFilter) {
    if (!await clearRecent()) return;
    if (perspectiveId) { leavePerspective(); setView('all'); setProjectId(''); }
    setTagFilter(tag); setPersonFilter(''); setDrawerOpen(false); setShowSettings(false);
  }
  function closeTaskDetails(id: string) {
    setEditorDirty(false); setSelectedTask(null); setTaskEditor(null);
    requestAnimationFrame(() => document.getElementById(`task-title-${id}`)?.focus());
  }
  async function editProject(project: Project) {
    if (!await canLeaveEditor()) return;
    setEditorDirty(false); setEditingProject(project); setProjectEditor({ original: project, draft: project }); setSelectedTask(null); setTaskEditor(null); setError('');
  }
  function closeProject() {
    const id = editingProject?.id;
    setEditorDirty(false); setEditingProject(null); setProjectEditor(null);
    requestAnimationFrame(() => (document.getElementById(`project-title-${id}`) ?? document.getElementById(`project-edit-${id}`))?.focus());
  }
  function saveProject(changes: ProjectChanges, original = editingProject!) {
    return action(() => api.updateProject(original.id, changes, projectExpected(original, changes)));
  }
  function createProject(event: FormEvent) {
    event.preventDefault();
    if (!newProject.trim()) return;
    const value = newProject.trim();
    void action(async () => { await api.addProject(value, activeArea && !activeArea.archived ? activeArea.id : null, projectType); setNewProject(''); setShowNewProject(false); });
  }
  function openNewProject() { setNewProject(''); setProjectType('parallel'); setError(''); setShowNewProject(true); }
  function createNewItem(event: FormEvent) {
    event.preventDefault();
    if (!newItemView || !newItemTitle.trim() || (newItemView === 'scheduled' && !newItemDate)) return;
    const target = captureTarget(newItemView);
    void action(async () => {
      await api.addTask(newItemTitle.trim(), target.status, projectId || null, !projectId && activeArea && !activeArea.archived ? activeArea.id : null, target.starred, target.status === 'scheduled' ? newItemDate : null);
      setNewItemDate(null);
      setNewItemView(null); setNewItemTitle('');
    });
  }
  function updateSidebarPreferences(next: SidebarPreferences) {
    setSidebarPreferences(next);
    try { localStorage.setItem(sidebarPreferencesKey, JSON.stringify(next)); setSidebarError(''); }
    catch { setSidebarError('This sidebar is applied, but could not be saved on this device.'); }
  }
  async function openSettings() {
    if (!await clearRecent()) return;
    setShowSettings(true); setDrawerOpen(false);
  }
  function menuButton(menu: typeof menus[number]) {
    return <button disabled={busy} key={menu.view} className={`navitem ${!showSettings && !perspectiveId && view === menu.view && !projectId ? 'active' : ''}`} onClick={() => changeView(menu.view)}><span className="navsymbol">{menu.symbol}</span><span className="navtitle">{menu.title}</span><span className="navcounts">
      {menu.view === 'inbox' && badges.inbox > 0 && <span className="navbadge" aria-label={`${badges.inbox} open inbox tasks`}>{badges.inbox}</span>}
      {menu.view === 'focus' && badges.focusOverdue > 0 && <span className="navbadge" aria-label={`${badges.focusOverdue} overdue focus tasks`}>{badges.focusOverdue}</span>}
      {menu.view === 'focus' && badges.focus > 0 && <span className="navcount" aria-label={`${badges.focus} open focus tasks not overdue`}>{badges.focus}</span>}
      {menu.view === 'waiting' && badges.waiting > 0 && <span className="navcount" aria-label={`${badges.waiting} waiting tasks`}>{badges.waiting}</span>}
    </span></button>;
  }
  const sidebar = <aside className="sidebar">
      <div className="brand"><span className="brandmark">✳</span><span>Nextleaf</span></div>
      <div className="sidebarscroll">
      <nav className="inboxnav" aria-label="Capture">{menus.filter(menu => menu.view === 'inbox').map(menuButton)}</nav>
      <nav aria-label="Task views">{menus.filter(menu => menu.view !== 'inbox' && !archiveViews.includes(menu.view) && !sidebarPreferences.hiddenViews.includes(menu.view)).map(menuButton)}</nav>
      {!sidebarPreferences.hiddenViews.includes('review') && <button className="navitem" disabled={busy} onClick={() => void openReview()}><span className="navsymbol" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h13v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm13 1h2a3 3 0 0 1 0 6h-2M3 22h16M7 3v2m4-3v3m4-2v2"/></svg></span><span className="navtitle">Review</span>{reviewDue !== null && reviewDue > 0 && <span className="navcount" aria-label={`${reviewDue} reviews due`}>{reviewDue}</span>}</button>}
      {perspectives.filter(p => sidebarPreferences.perspectiveIds.includes(p.id)).map(p => <button key={p.id} disabled={busy} className={`navitem ${!showSettings && perspectiveId === p.id ? 'active' : ''}`} onClick={() => void openPerspective(p.id)} title={p.error ?? p.name}><span className="navsymbol" aria-hidden="true">{p.definition.icon}</span><span className="ellipsis">{p.name}</span><span className="navcount">{p.error ? '!' : p.count}</span></button>)}
      <div className={`navlabel spaced projectheading projectnav ${!showSettings && view === 'projects' ? 'active' : ''}`}><button className="projectcollapse" aria-label={projectsExpanded ? 'Collapse projects' : 'Expand projects'} aria-expanded={projectsExpanded} aria-controls="project-list" onClick={() => setProjectsExpanded(value => !value)}><span className={`sectionchevron ${projectsExpanded ? 'expanded' : ''}`} aria-hidden="true"/></button><button className="projecttoggle" aria-current={!showSettings && view === 'projects' ? 'page' : undefined} disabled={busy} onClick={() => changeView('projects')}>Projects</button></div>
      <nav id="project-list" hidden={!projectsExpanded}>{filteredProjects.map(project => <button disabled={busy} key={project.id} title={project.name} className={`navitem ${!showSettings && projectId === project.id ? 'active' : ''}`} onClick={() => selectProject(project.id)}><span className="navsymbol">{project.status === 'completed' ? '✓' : project.project_type === 'sequential' ? '⇥' : '◫'}</span><span className="ellipsis">{project.name}</span></button>)}</nav>
      <div className="navlabel spaced projectheading"><button className="projecttoggle" aria-expanded={tagsExpanded} aria-controls="tag-filter-list" onClick={() => setTagsExpanded(value => !value)}><span className={`sectionchevron ${tagsExpanded ? 'expanded' : ''}`} aria-hidden="true"/>Tags</button></div>
      <div id="tag-filter-list" className="tagfilters" role="group" aria-label="Tag filters" hidden={!tagsExpanded}>
        <button disabled={busy} aria-pressed={tagFilter === null && !personFilter} onClick={()=>void chooseSidebarTag(null)}>All</button>
        {sidebarFilters.tags.map(tag => <button key={tag} disabled={busy} aria-pressed={tagFilter === tag} onClick={()=>void chooseSidebarTag(tagFilter === tag ? null : tag)}>{tag}</button>)}
        <button disabled={busy} aria-label="Untagged" title="Untagged" aria-pressed={tagFilter === UNTAGGED} onClick={()=>void chooseSidebarTag(tagFilter === UNTAGGED ? null : UNTAGGED)}>—</button>
      </div>
      {sidebarFilters.contacts.length > 0 && <>
        <div className="navlabel spaced projectheading"><button className="projecttoggle" aria-expanded={contactsExpanded} aria-controls="contact-filter-list" onClick={() => setContactsExpanded(value => !value)}><span className={`sectionchevron ${contactsExpanded ? 'expanded' : ''}`} aria-hidden="true"/>Contacts</button></div>
        <div id="contact-filter-list" className="tagfilters contactfilters" role="group" aria-label="Contact filters" hidden={!contactsExpanded}>
          {sidebarFilters.contacts.map(contact => <button key={contact} disabled={busy} aria-label={`Filter contact: ${contact}`} aria-pressed={activeContact === contact} onClick={()=>void chooseSidebarTag(activeContact === contact ? null : contact)}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10" cy="6" r="3"/><path d="M4 18v-2a6 6 0 0 1 12 0v2"/></svg><span>{contact}</span>
          </button>)}
        </div>
      </>}
      </div>
      <div className="sidebarbottom">
        <nav aria-label="Archive and all tasks">{menus.filter(menu => archiveViews.includes(menu.view)).map(menuButton)}</nav>
        <button className={`navitem settingsnav ${showSettings ? 'active' : ''}`} aria-current={showSettings ? 'page' : undefined} disabled={busy} onClick={() => void openSettings()}><span className="navsymbol" aria-hidden="true">⚙</span>Settings</button>
      </div>
    </aside>;
  return <div className="app">
    {review && <ReviewWorkspace initialProject={review.project} onClose={() => { setReview(null); void reload(); }}/>}
    {!mobile && sidebar}
    {mobile && drawerOpen && <Dialog title="Navigation" variant="drawer" onClose={() => setDrawerOpen(false)}>{sidebar}</Dialog>}
    <main className="main">
      {showSettings ? <>
        <header className="topbar">{mobile && <button className="iconbutton navigationtrigger" aria-label="Open navigation" aria-haspopup="dialog" onClick={() => setDrawerOpen(true)}>☰</button>}<div className="viewtitle"><h1>Settings</h1></div></header>
      <section className="settingspanel" aria-label="Settings">
        <SidebarSettings preferences={sidebarPreferences} onChange={updateSidebarPreferences} views={[...menus.filter(m => m.view !== 'inbox' && !archiveViews.includes(m.view)), { view: 'review', title: 'Review' }]} perspectives={perspectives} busy={busy} error={sidebarError} onOpen={id => void openPerspective(id)} onEdit={p => void editPerspective('edit', p)} onNew={() => void editPerspective('new')} onCapture={() => void editPerspective('capture')} captureTitle={!perspectiveId && view !== 'projects' && view !== 'trash' ? titleText : undefined}/><AppearanceSettings/><McpSettings/><button onClick={async () => { if (await clearRecent()) setShowManageTags(true); }}>Manage Tags</button>
        <><h3>Server connection</h3><p>This web app works online with the server below. For Tailscale, keep Tailscale connected and use the server’s HTTPS address.</p>
        <p>Current server: <code>{getApiBase() || window.location.origin}</code></p>
        <form onSubmit={async event => { event.preventDefault(); if (!await clearRecent()) return; localStorage.setItem('taskmanager_api_url', apiUrl.trim()); setTasks([]); setAreas([]); setProjects([]); void reload(); }}><input aria-label="Server URL" type="url" value={apiUrl} onChange={event => setApiUrl(event.target.value)} placeholder="Use default"/><button disabled={busy}>Save connection</button></form></>
      </section>
        {error && <p role="alert" className="error">{error}</p>}
      </> : <>

      <header className="topbar">{mobile && <button className="iconbutton navigationtrigger" aria-label="Open navigation" aria-haspopup="dialog" onClick={() => setDrawerOpen(true)}>☰</button>}<div className="viewtitle"><h1>{titleText}</h1></div><div className="topright">{activeProject && <div className="projectheaderactions"><button id={`project-edit-${activeProject.id}`} disabled={busy} onClick={() => void editProject(activeProject)}>Edit project</button>{activeProject.status !== 'completed' && <button aria-label="Review project" disabled={busy} onClick={() => void openReview(activeProject.id)}>Review</button>}</div>}{!perspectiveId && <select className="areafilter" aria-label="Area filter" value={areaId} disabled={busy} onChange={event => selectArea(event.target.value)}><option value="">All Areas</option>{areas.filter(area => !area.archived || area.id === areaId).map(area => <option key={area.id} value={area.id}>{area.name}</option>)}</select>}<NewItemMenu mobile={mobile} disabled={busy} onTask={target => { setNewItemTitle(''); setNewItemView(target); setError(''); }} onProject={openNewProject} onTag={() => { setNewTag(''); setShowNewTag(true); setError(''); }}/><span className="count">{view === 'projects' ? `${overview.length} ${overview.length === 1 ? 'project' : 'projects'}` : `${visibleTasks.length} ${visibleTasks.length === 1 ? 'task' : 'tasks'}`}</span><button className="iconbutton refreshbutton" aria-label={refreshing ? 'Refreshing' : 'Refresh'} title="Refresh" aria-busy={refreshing} disabled={busy || refreshing} onClick={() => void refreshView()}><span aria-hidden="true">↻</span></button><span className="refreshstatus" role="status">{refreshing ? 'Refreshing…' : ''}</span></div></header>
      {perspectiveDefinition && <section className="perspectivebar" aria-label="Perspective rules"><div className="perspectiverules">{ruleLabels(perspectiveDefinition,areas,projects,tagRecords).map(label=><span key={label}>{label}</span>)}</div><div className="perspectiveactions">
        {temporaryPerspective && <strong>Temporary changes</strong>}
        <button disabled={busy} onClick={()=>void editPerspective('edit')}>{temporaryPerspective?'Update Perspective…':'Edit rules…'}</button>
        <button disabled={busy} onClick={()=>void editPerspective('duplicate')}>Save as new…</button>
        {temporaryPerspective&&<button disabled={busy} onClick={async()=>{if(await clearRecent()){setTemporaryPerspective(null);setTasks([]);}}}>Reset temporary filters</button>}
      </div></section>}
      {!perspectiveId && <div className="listtoolbar">
        <div className="contextfilters" aria-label="Task filters">
          <button aria-pressed={!filtersActive} onClick={() => void changeFilters({ tag: null, person: '', properties: emptyTaskFilters })}>All</button>
          {view !== 'projects' && (tasks.some(task => task.due_date) || propertyFilters.due) && <select aria-label="Filter due date" value={propertyFilters.due} onChange={event => void changeFilters({ properties: { ...propertyFilters, due: event.target.value as '' | 'today' | 'overdue' } })}><option value="">Due</option><option value="today">Due today</option><option value="overdue">Overdue</option></select>}
          {hasViewOptions && <>
            <select aria-label="Filter time" value={propertyFilters.minutes ?? ''} onChange={event => void changeFilters({ properties: { ...propertyFilters, minutes: event.target.value ? Number(event.target.value) : null } })}><option value="">Time</option>{timeOptions.map(minutes => <option key={minutes} value={minutes}>Up to {minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`}</option>)}</select>
            <select aria-label="Filter energy" value={propertyFilters.energy ?? ''} onChange={event => void changeFilters({ properties: { ...propertyFilters, energy: event.target.value ? Number(event.target.value) : null } })}><option value="">Energy</option><option value="1">Low energy</option><option value="2">Medium energy</option><option value="3">High energy</option></select>
          </>}
          {visibleContacts.length > 0 && (mobile ? <select aria-label="Filter contact" value={activeContact} onChange={event => void changeFilters({ ...(selectedContact ? { tag: null } : {}), person: event.target.value })}><option value="">Contacts</option>{visibleContacts.map(person => <option key={person} value={person}>{person}</option>)}</select> : visibleContacts.map(person => <button key={person} aria-label={`Filter contact: ${person}`} aria-pressed={activeContact === person} onClick={() => void changeFilters({ ...(selectedContact ? { tag: null } : {}), person: activeContact === person ? '' : person })}>{person}</button>))}
          {relevantAreas.map(area => <button key={area.id} aria-pressed={areaId === area.id} onClick={() => selectArea(areaId === area.id ? '' : area.id)}>{area.name}</button>)}
          {mobile ? <select aria-label="Filter tag" value={tagFilter === UNTAGGED ? 'untagged' : tagFilter === null || selectedContact ? '' : `tag:${tagFilter}`} onChange={event => void changeFilters({ tag: event.target.value === 'untagged' ? UNTAGGED : event.target.value ? event.target.value.slice(4) : null })}><option value="">Tags</option>{visibleTags.map(tag => <option key={tag} value={`tag:${tag}`}>{tag}</option>)}<option value="untagged">— Untagged</option></select> : <>
            {visibleTags.map(tag => <button key={tag} aria-pressed={tagFilter === tag} onClick={() => void changeFilters({ tag: tagFilter === tag ? null : tag })}>{tag}</button>)}
            <button aria-label="Untagged" title="Untagged" aria-pressed={tagFilter === UNTAGGED} onClick={() => void changeFilters({ tag: tagFilter === UNTAGGED ? null : UNTAGGED })}>—</button>
          </>}
        </div>
        <div className="listviewcontrols">
          {hasViewOptions && <div className="displayoptions"><button popoverTarget="display-options" aria-label="View options" onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect(); const panel = document.getElementById('display-options');
            if (panel) { panel.style.left = `${Math.max(12, Math.min(rect.right - 215, window.innerWidth - 227))}px`; const top = Math.max(12, Math.min(rect.bottom + 4, window.innerHeight - 300)); panel.style.top = `${top}px`; panel.style.maxHeight = `${window.innerHeight - top - 12}px`; }
          }}>⋯</button><div id="display-options" ref={viewPanel} popover="auto" className="displaypanel" onToggle={event => { if (event.newState === 'closed') setProjectActionsOpen(false); }}>
            <div className="displayheading">{view === 'next' ? 'Next' : 'Focus'} View Options</div>
            {(['unified', 'project', view === 'next' ? 'sequential' : 'state'] as const).map(option => <button key={option} aria-pressed={grouping === option} onPointerEnter={() => { if (!mobile) setProjectActionsOpen(false); }} onClick={() => setDisplay({ grouping: option })}><span aria-hidden="true">{grouping === option ? '✓' : ''}</span>{option === 'unified' ? 'Unified list' : option === 'project' ? 'Group by project' : option === 'state' ? 'Group by state' : 'Sequential next actions'}</button>)}
            {view === 'next' && <>
              <button ref={projectChoicesButton} className="projectlimit" aria-expanded={projectActionsOpen} aria-controls="project-action-choices" onPointerEnter={event => { if (!mobile && event.pointerType === 'mouse') setProjectActionsOpen(true); }} onClick={() => setProjectActionsOpen(value => mobile ? !value : true)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setProjectActionsOpen(true); requestAnimationFrame(() => projectChoices.current?.querySelector<HTMLButtonElement>('button')?.focus()); } }}>Project actions<span aria-hidden="true">{mobile ? '⌄' : '‹'}</span></button>
              {projectActionsOpen && <div id="project-action-choices" ref={projectChoices} className={mobile ? 'mobileprojectchoices' : 'displaypanel projectchoices'} popover={mobile ? undefined : 'manual'} role="group" aria-label="Project actions" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setProjectActionsOpen(false); projectChoicesButton.current?.focus(); } }}>
                {[...Array.from({ length: 9 }, (_, index) => index + 1), null].map(limit => <button key={limit ?? 'all'} aria-pressed={display.projectLimit === limit} onClick={() => { void setDisplay({ projectLimit: limit }); setProjectActionsOpen(false); projectChoicesButton.current?.focus(); }}><span aria-hidden="true">{display.projectLimit === limit ? '✓' : ''}</span>{limit === null ? 'All' : `Top ${limit}`}</button>)}
              </div>}
            </>}

          </div></div>}
          <div className="notedisplay" role="group" aria-label="Note display">{(['none', 'preview', 'full'] as const).map((mode, index) => <button key={mode} aria-label={mode === 'none' ? 'Hide notes' : mode === 'preview' ? 'Preview notes' : 'Show full notes'} title={mode === 'none' ? 'Hide notes' : mode === 'preview' ? 'Preview notes' : 'Show full notes'} aria-pressed={display.notes === mode} onClick={() => setDisplay({ notes: mode })}><span className="lineicon" aria-hidden="true">{Array.from({ length: index + 1 }, (_, line) => <i key={line}/>)}</span></button>)}</div>
        </div>
      </div>
      }
      {activeProject?.notes && <details className="projectnotes"><summary>Project notes</summary><p className="notes">{activeProject.notes}</p></details>}
      {error && <div role="alert" className="error">Could not connect or save: {error}. Check your connection and try again.</div>}
      {view === 'projects' ? <section aria-label="Projects" className="projectsview">
        {!overview.length && !error && <div className="empty"><h2>No projects</h2></div>}
        {(['active', 'someday', 'completed'] as const).map(status => {
          const rows = overview.filter(row => row.project.status === status);
          return rows.length > 0 && <section key={status} aria-label={`${status} projects`}><h2 className="taskgroupheading">{status === 'active' ? 'Active Projects' : status === 'someday' ? 'Someday' : 'Completed Projects'}</h2>
            {rows.map(({ project, count }) => <article key={project.id} className={`projectrow ${!mobile && editingProject?.id === project.id ? 'expanded' : ''}`} onKeyDown={async event => { if (event.key === 'Escape' && editingProject?.id === project.id) { event.stopPropagation(); event.preventDefault(); if (await canLeaveEditor()) closeProject(); } }}>
              {!mobile && editingProject?.id === project.id ? <ProjectDetails editor={projectEditor!} setEditor={setProjectEditor} key={project.id} project={editingProject} areas={areas} knownTags={knownTags} busy={busy} error={error} onSave={saveProject} onClose={closeProject} onCancel={async () => { if (await canLeaveEditor()) closeProject(); }} onDirtyChange={setEditorDirty}/> : <>
                <span className={`focusstar ${project.starred ? 'focused' : ''}`} aria-label={project.starred ? 'Focused' : undefined}><span aria-hidden="true">{project.starred ? '★' : '☆'}</span></span>
                <button className="projectcount" disabled={busy} aria-label={`Open tasks in ${project.name}`} onClick={() => selectProject(project.id)}>{count} {count === 1 ? 'Action' : 'Actions'}</button>
                <button id={`project-title-${project.id}`} className="taskopen projecttitle" aria-label={`Edit project: ${project.name}`} aria-expanded={false} disabled={busy} onClick={() => editProject(project)}>{project.name}</button>
                <div className="projectmeta">{project.area_id && <span>{areas.find(area => area.id === project.area_id)?.name}</span>}{project.tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}{project.due_date && <span>Due: {project.due_date}</span>}{project.notes && <span aria-label="Has notes">≡</span>}</div>
              </>}
              {(mobile || editingProject?.id !== project.id) && display.notes !== 'none' && project.notes && <p className={`tasknotepreview ${display.notes}`}>{project.notes}</p>}
            </article>)}
          </section>;
        })}
      </section> : <>
      <section className="tasks">
        {visibleTasks.length === 0 && !error && <div className="empty"><div className="emptyicon">✓</div><h2>{filtersActive || perspectiveId ? 'No matching tasks' : 'All done'}</h2></div>}
        {groups.map(group => <section className="taskgroup" key={group.id} aria-label={group.title ?? activeProject?.name}>
        {group.title && <h2 className="taskgroupheading">{group.title}</h2>}
        {(limitProjects && group.id && display.projectLimit && !expandedGroups.includes(group.id) ? group.tasks.slice(0, display.projectLimit) : group.tasks).map(task => <article className={`task ${!mobile && selectedTask?.id === task.id ? 'expanded' : ''}`} key={task.id} onKeyDown={async event => { if (event.key === 'Escape' && selectedTask?.id === task.id) { event.stopPropagation(); event.preventDefault(); if (await canLeaveEditor()) closeTaskDetails(task.id); } }}>
          {(mobile || selectedTask?.id !== task.id) && <button className={`checkbox ${task.status === 'completed' ? 'checked' : ''} ${isOverdue(task) ? 'overdue' : ''}`} title={isOverdue(task) ? 'Overdue' : undefined} aria-label={task.status === 'completed' ? 'Reopen task' : 'Complete task'} aria-pressed={task.status === 'completed'} disabled={busy || task.status === 'recurring' || task.status === 'trash'} onClick={async () => { if (await canLeaveEditor()) { closeTaskDetails(task.id); toggleCompleted(task); } }}>{task.status === 'completed' ? '✓' : ''}</button>}
          {!mobile && selectedTask?.id !== task.id && <button className={`focusstar rowfocus ${task.starred ? 'focused' : ''}`} aria-label={`Focus: ${task.title}`} aria-pressed={task.starred} disabled={busy} onClick={() => void saveTask(task, { starred: !task.starred })}><span aria-hidden="true">{task.starred ? '★' : '☆'}</span></button>}
          <div className="taskbody">
            {(mobile || selectedTask?.id !== task.id) && <>
            <button className={`tasktitle taskopen ${task.status === 'completed' ? 'done' : ''}`} id={`task-title-${task.id}`} title={task.title} aria-label={`${selectedTask?.id === task.id ? 'Close' : 'Open'} task: ${task.title}`} aria-expanded={selectedTask?.id === task.id} aria-controls={`task-details-${task.id}`} onClick={() => openTask(task)}>{view === 'waiting' && taskPeople(task, allPeople).length > 0 && <span className="waitingperson">{taskPeople(task, allPeople).join(', ')}</span>}{task.title}{task.notes && display.notes === 'none' && <span className="tasknoteindicator" title="Has notes" role="img" aria-label="Has notes"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 2.5h11v8L10 13.5H2.5zM10 13.5V10h3.5M5 5.5h6M5 8h4"/></svg></span>}</button>
            </>}
            {!mobile && selectedTask?.id === task.id ? <TaskDetails editor={taskEditor!} setEditor={setTaskEditor} task={selectedTask} projects={projects} areas={areas} knownTags={knownTags} people={people} busy={busy} error={error} onSave={(changes, original) => saveTask(selectedTask, changes, original)} onDirtyChange={setEditorDirty} onClose={() => closeTaskDetails(task.id)} onCancel={async () => { if (await canLeaveEditor()) closeTaskDetails(task.id); }}/> : <div className="taskmeta">
              {display.project && !task.project_id && task.area_id && <span className="taskcontext">{areas.find(a => a.id === task.area_id)?.name}</span>}
              {grouping !== 'project' && task.project_id && !projectId && <button className="taskprojectlink" onClick={() => selectProject(task.project_id!)}>{projects.find(project => project.id === task.project_id)?.name}</button>}
              {hasViewOptions && task.estimated_minutes !== null && <span>{task.estimated_minutes}m</span>}
              {hasViewOptions && task.energy !== null && <span>{['', 'Low', 'Medium', 'High'][task.energy]}</span>}
              {display.tags && task.tags.filter(tag => view !== 'waiting' || !allPeople.includes(tag)).map(tag => <span className="tag" key={tag} aria-label={`Tag: ${tag}`}><span aria-hidden="true">#</span>{tag}</span>)}
              {display.due && task.due_date && <span>Due: {task.due_date}</span>}
              {task.blocked_by_sequence && <span>Blocked by sequence</span>}
            </div>}
            {(mobile || selectedTask?.id !== task.id) && display.notes !== 'none' && task.notes && <p className={`tasknotepreview ${display.notes}`}>{task.notes}</p>}
          </div>
          {mobile && <button className={`focusstar rowfocus ${task.starred ? 'focused' : ''}`} aria-label={`Focus: ${task.title}`} aria-pressed={task.starred} disabled={busy} onClick={() => void saveTask(task, { starred: !task.starred })}><span aria-hidden="true">{task.starred ? '★' : '☆'}</span></button>}
          {(mobile || selectedTask?.id !== task.id) && <TaskActions mobile={mobile} task={task} projects={projects} areas={areas} knownTags={knownTags} people={people} busy={busy} onSave={changes => saveTask(task, changes)} onOpen={() => openTask(task)}/>}
        </article>)}
        {limitProjects && group.id && display.projectLimit && group.tasks.length > display.projectLimit && <button className="showmoretasks" onClick={async () => { if (!expandedGroups.includes(group.id) || await clearRecent()) setExpandedGroups(previous => previous.includes(group.id) ? previous.filter(id => id !== group.id) : [...previous, group.id]); }}>{expandedGroups.includes(group.id) ? 'Show less' : `Show ${group.tasks.length - display.projectLimit} more items`}</button>}
        </section>)}
      </section>
      </>}
      </>}
    </main>
    {(mobile || !groups.some(group => (limitProjects && group.id && display.projectLimit && !expandedGroups.includes(group.id) ? group.tasks.slice(0, display.projectLimit) : group.tasks).some(task => task.id === selectedTask?.id))) && selectedTask && <Dialog title="Task details" variant="editor" onClose={async () => { if (await canLeaveEditor()) closeTaskDetails(selectedTask.id); }}>
      <TaskDetails editor={taskEditor!} setEditor={setTaskEditor} key={selectedTask.id} mobile task={selectedTask} projects={projects} areas={areas} knownTags={knownTags} people={people} busy={busy} error={error} onSave={(changes, original) => saveTask(selectedTask, changes, original)} onDirtyChange={setEditorDirty} onClose={() => closeTaskDetails(selectedTask.id)} onCancel={async () => { if (await canLeaveEditor()) closeTaskDetails(selectedTask.id); }}/>
    </Dialog>}
    {(mobile || view !== 'projects' || !overview.some(row => row.project.id === editingProject?.id)) && editingProject && <Dialog title="Project details" variant="editor" onClose={async () => { if (await canLeaveEditor()) closeProject(); }}>
      <ProjectDetails editor={projectEditor!} setEditor={setProjectEditor} key={editingProject.id} mobile project={editingProject} areas={areas} knownTags={knownTags} busy={busy} error={error} onSave={saveProject} onClose={closeProject} onCancel={async () => { if (await canLeaveEditor()) closeProject(); }} onDirtyChange={setEditorDirty}/>
    </Dialog>}
    {perspectiveEditor && <PerspectiveEditor initial={perspectiveEditor.initial} original={perspectiveEditor.original} areas={areas} projects={projects} tags={tagRecords} waiting={sidebarFilters.contacts} onClose={()=>setPerspectiveEditor(null)} onApply={perspectiveEditor.original?.id === perspectiveId ? definition=>{setTemporaryPerspective(definition);setTasks([]);setPerspectiveEditor(null);} : undefined} onSaved={p=>{setPerspectiveEditor(null);setPerspectives(previous=>p.deleted?previous.filter(v=>v.id!==p.id):[...previous.filter(v=>v.id!==p.id),p]); if(p.deleted){if(p.id===perspectiveId){leavePerspective();setView('inbox');}}else{void openPerspective(p.id);void reload();}}}/>}
    {showManageTags && <ManageTags onClose={() => setShowManageTags(false)} onChanged={reload}/>}
    {showDiscard && <Dialog title="Discard unsaved changes?" onClose={() => decideDiscard(false)}>
      <p>Your changes have not been saved.</p>
      <div className="dialogactions"><button autoFocus onClick={() => decideDiscard(false)}>Keep editing</button><button className="primary" onClick={() => decideDiscard(true)}>Discard changes</button></div>
    </Dialog>}
    {newItemView && <Dialog title={`New action → ${viewLabel(newItemView)}`} onClose={() => setNewItemView(null)}>
      <form className="projectdialogform" onSubmit={createNewItem}>
        <label>Task title<input autoFocus required value={newItemTitle} onChange={event => setNewItemTitle(event.target.value)}/></label>
        {activeProject && <p>Project: {activeProject.name}</p>}
        {error && <p role="alert" className="error">{error}</p>}
        {newItemView === 'scheduled' && <DateField label="Start Date" value={newItemDate} disabled={busy} onChange={setNewItemDate}/>}<div className="dialogactions"><button type="button" onClick={() => setNewItemView(null)}>Cancel</button><button className="primary" disabled={busy || !newItemTitle.trim()}>Create task</button></div>
      </form>
    </Dialog>}
    {showNewTag && <Dialog title="New tag" onClose={() => setShowNewTag(false)}>
      <form className="projectdialogform" onSubmit={event => { event.preventDefault(); if (newTag.trim()) void action(async () => { await api.addTag(newTag.trim()); setShowNewTag(false); }); }}>
        <label>Tag name<input autoFocus required value={newTag} onChange={event => setNewTag(event.target.value)}/></label>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="dialogactions"><button type="button" onClick={() => setShowNewTag(false)}>Cancel</button><button className="primary" disabled={busy || !newTag.trim()}>Create tag</button></div>
      </form>
    </Dialog>}
    {showNewProject && <Dialog title="New project" onClose={() => setShowNewProject(false)}>
      <form className="projectdialogform" onSubmit={createProject}>
        <label>Project name<input autoFocus required value={newProject} onChange={event => setNewProject(event.target.value)} placeholder="What outcome do you want to achieve?"/></label>
        <label>Project type<select value={projectType} onChange={event => setProjectType(event.target.value as Project['project_type'])}><option value="parallel">Parallel</option><option value="sequential">Sequential</option></select></label>
        <p className="hint">{projectType === 'parallel' ? 'All available tasks can appear in Next.' : 'Only the first unfinished task can appear in Next when it is available.'}</p>
        <p>Area: {activeArea?.name ?? 'No area'}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialogactions"><button type="button" onClick={() => setShowNewProject(false)}>Cancel</button><button className="primary" disabled={busy || !newProject.trim()}>Create project</button></div>
      </form>
    </Dialog>}
  </div>;
}
