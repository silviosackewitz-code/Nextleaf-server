import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/api.ts';
Object.defineProperty(globalThis, 'window', { value: { location: {protocol:'http:',hostname:'localhost'} }, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: {getItem:()=>null}, configurable: true });

test('old server cannot silently accept a partial task edit', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => { calls.push(url); return Response.json({status:'ok'}); });
  await assert.rejects(api.updateTask('id',{title:'New title',notes:'New notes'}), /Update the Nextleaf server/);
  assert.deepEqual(calls,['/api/health']);
});
test('capable server receives explicit nulls and only edited fields', async t => {
  const patches: object[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    if (url === '/api/health') return Response.json({capabilities:['task-editing']});
    patches.push(JSON.parse(options.body as string));
    return Response.json({id:'id',energy:null});
  });
  await api.updateTask('id',{energy:null});
  assert.deepEqual(patches,[{energy:null}]);
});
test('older servers cannot silently drop Focus on creation or create unsupported tags', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => { calls.push(url); return Response.json({capabilities:['task-editing']}); });
  await assert.rejects(api.addTask('Focus action','next',null,null,true), /Update the Nextleaf server/);
  await assert.rejects(api.addTag('Tag'), /Update the Nextleaf server/);
  assert.deepEqual(calls,['/api/health','/api/health']);
});
test('Focus creation preserves project and sends a single atomic task request', async t => {
  const posts: object[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    if (url === '/api/health') return Response.json({capabilities:['item-creation']});
    posts.push(JSON.parse(options!.body as string));
    return Response.json({id:'created'});
  });
  await api.addTask('Focus action','next','project',null,true);
  assert.deepEqual(posts,[{title:'Focus action',status:'next',project_id:'project',area_id:null,starred:true}]);
});

test('project edits require a capable server and send only the selected fields', async t => {
  let enabled = false;
  const patches: object[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    if (url === '/api/health') return Response.json({ capabilities: enabled ? ['project-editing'] : [] });
    patches.push(JSON.parse(options!.body as string));
    return Response.json({ id: 'project' });
  });
  await assert.rejects(api.updateProject('project', { project_type: 'sequential' }), /Update the Nextleaf server/);
  assert.equal(patches.length, 0);
  enabled = true;
  await api.updateProject('project', { due_date: null, project_type: 'sequential' });
  assert.deepEqual(patches, [{ due_date: null, project_type: 'sequential' }]);
});

test('conditional writes carry expected originals and reject older servers before changing data', async t => {
  let supported = false;
  const patches: object[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    if (url === '/api/health') return Response.json({ capabilities: ['task-editing', 'project-editing', ...(supported ? ['conditional-updates'] : [])] });
    patches.push(JSON.parse(options!.body as string));
    return Response.json({ id: 'id' });
  });
  await assert.rejects(api.updateTask('id', { title: 'New' }, { title: 'Old' }), /Update the Nextleaf server/);
  await assert.rejects(api.updateProject('id', { notes: 'New' }, { notes: 'Old' }), /Update the Nextleaf server/);
  assert.equal(patches.length, 0);
  supported = true;
  await api.updateTask('id', { due_date: '2026-11-01', tags: [] }, { due_date: null, tags: ['Laptop'] });
  await api.updateProject('id', { project_type: 'sequential' }, { project_type: 'parallel' });
  assert.deepEqual(patches, [
    { due_date: '2026-11-01', tags: [], expected: { due_date: null, tags: ['Laptop'] } },
    { project_type: 'sequential', expected: { project_type: 'parallel' } },
  ]);
});

test('a stale edit returns the conflict without retrying or overwriting newer data', async t => {
  let writes = 0;
  const draft = { notes: 'My unsaved notes' };
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === '/api/health') return Response.json({ capabilities: ['task-editing', 'conditional-updates'] });
    writes += 1;
    return Response.json({ error: 'This task changed. Reopen it before saving.', fields: ['notes'] }, { status: 409 });
  });
  await assert.rejects(api.updateTask('id', draft, { notes: 'Old notes' }), /This task changed/);
  assert.equal(writes, 1);
  assert.deepEqual(draft, { notes: 'My unsaved notes' });
});

test('legacy tag and area responses receive defaults without losing identifiers or names', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === '/api/health') return Response.json({ capabilities: ['item-creation'] });
    if (url === '/api/tags') return Response.json([{ id: 'tag', name: 'Laptop' }]);
    return Response.json([{ id: 'area', name: 'Work', sort_order: 4 }]);
  });
  assert.deepEqual(await api.tags(), [{ id: 'tag', name: 'Laptop', kind: 'tag', archived: false }]);
  assert.deepEqual(await api.areas(), [{ id: 'area', name: 'Work', sort_order: 4, archived: false }]);
});

test('typed creation and management cannot silently degrade on older servers', async t => {
  const writes: object[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    if (url === '/api/health') return Response.json({ capabilities: ['item-creation', 'conditional-updates'] });
    writes.push(JSON.parse(options!.body as string));
    return Response.json({ id: 'tag', name: 'Legacy' });
  });
  await assert.rejects(api.addTag('Alice', 'person'), /Update the Nextleaf server/);
  await assert.rejects(api.addTag('Work', 'tag'), /Update the Nextleaf server/);
  await assert.rejects(api.updateTag('tag', { archived: true }), /Update the Nextleaf server/);
  await assert.rejects(api.updateArea('area', { name: 'Home' }), /Update the Nextleaf server/);
  assert.equal(writes.length, 0);
  assert.deepEqual(await api.addTag('Legacy'), { id: 'tag', name: 'Legacy', kind: 'tag', archived: false });
  assert.deepEqual(writes, [{ name: 'Legacy' }]);
});

test('management preserves types, archive state and conditional update payloads', async t => {
  const writes: object[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    if (url === '/api/health') return Response.json({ capabilities: ['tag-management'] });
    const body = JSON.parse(options!.body as string);
    writes.push({ url, method: options!.method, body });
    return Response.json(url.includes('/tags') ? { id: 'tag', name: 'Alice', kind: 'person', archived: true } : { id: 'area', name: 'Work', sort_order: 1, archived: false });
  });
  const person = await api.addTag('Alice', 'person');
  assert.equal(person.kind, 'person'); assert.equal(person.archived, true);
  await api.updateTag('tag', { name: 'Alice', kind: 'person', archived: true }, { name: 'Old', kind: 'tag', archived: false });
  const area = await api.updateArea('area', { archived: false }, { archived: true });
  assert.equal(area.archived, false);
  assert.deepEqual(writes, [
    { url: '/api/tags', method: 'POST', body: { name: 'Alice', kind: 'person' } },
    { url: '/api/tags/tag', method: 'PATCH', body: { name: 'Alice', kind: 'person', archived: true, expected: { name: 'Old', kind: 'tag', archived: false } } },
    { url: '/api/areas/area', method: 'PATCH', body: { archived: false, expected: { archived: true } } },
  ]);
});

test('tag and area conflicts surface once and retain the unsaved payload', async t => {
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === '/api/health') return Response.json({ capabilities: ['tag-management'] });
    writes++;
    return Response.json({ error: 'This entry changed. Reopen it before saving.' }, { status: 409 });
  });
  const changes = { name: 'My draft' };
  await assert.rejects(api.updateTag('tag', changes, { name: 'Old' }), /This entry changed/);
  await assert.rejects(api.updateArea('area', changes, { name: 'Old' }), /This entry changed/);
  assert.equal(writes, 2);
  assert.deepEqual(changes, { name: 'My draft' });
});
