import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePerspective, emptyPerspective, perspectiveGroups, ruleLabels } from '../src/perspectives.ts';
import { defaultDisplay } from '../src/viewOptions.ts';
import type { Task } from '../src/api.ts';

test('capture preserves combined Area, project, tag and effort criteria with stable IDs', () => {
  const tag={id:'l',name:'Laptop',kind:'tag' as const,archived:false};
  const d=capturePerspective('next','personal','', 'Laptop','',{due:'today',minutes:30,energy:1},[tag],defaultDisplay);
  assert.deepEqual(d.rules.areas,['personal']);assert.deepEqual(d.rules.tags,['l']);assert.deepEqual(d.rules.states,['next']);assert.equal(d.rules.availability,'available');assert.equal(d.project_limit,3);
  assert.equal(d.rules.minutes,30);assert.deepEqual(d.rules.energies,[1]);
  const project=capturePerspective('all','personal','p','Laptop','',{due:'',minutes:null,energy:null},[tag],defaultDisplay);
  assert.deepEqual(project.rules.projects,['p']);assert.equal(project.grouping,'unified');
  const simple=capturePerspective('all','','','Laptop','',{due:'',minutes:null,energy:null},[tag],defaultDisplay);
  assert.deepEqual(simple.rules.tags,['l']);assert.deepEqual(simple.rules.states,[]);
});
test('grouping preserves server sorting, includes missing dates last and never duplicates tasks',()=>{
  const tasks=[{id:'a',project_id:'p',area_id:'x',due_date:'2026-10-24'},{id:'b',project_id:'p',area_id:'x',due_date:null},{id:'c',project_id:null,area_id:null,due_date:'2026-10-23'}] as Task[];
  const d=emptyPerspective(); d.grouping='project';
  let groups=perspectiveGroups(tasks,d,[],[]);assert.deepEqual(groups[0].tasks.map(t=>t.id),['a','b']);assert.equal(groups.flatMap(g=>g.tasks).length,3);
  d.grouping='due';groups=perspectiveGroups(tasks,d,[],[]);assert.deepEqual(groups.map(g=>g.id),['2026-10-23','2026-10-24','']);
  d.rules.projects=['missing'];assert.ok(ruleLabels(d,[],[],[]).some(s=>s.includes('Missing reference')));
});
