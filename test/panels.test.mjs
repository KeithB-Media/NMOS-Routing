import {test} from 'node:test';
import assert from 'node:assert/strict';
import {starterPanel,validPanel,deviceCatalog,contextGroups,takePlan} from '../public/panel-model.js';
const source={id:'s',side:'source',name:'Camera',tags:['Studio'],levels:[{id:'topo:camera.mod.S1',key:'Video'}]};
const destination={id:'d',side:'destination',name:'Monitor',tags:['Studio'],levels:[{id:'topo:monitor.mod.R1',key:'Video'},{id:'topo:monitor.mod.R2',key:'Audio'}]};
const junction={id:'j',side:'bidirectional',name:'Patch',tags:[],levels:[{id:'jun:1',key:'Video'}]};
const groups=[source,destination,junction];
test('panel persistence validates geometry and rejects cyclic or missing folder parents',()=>{
  const panel=starterPanel();assert(validPanel(panel));
  panel.widgets[0].w=13;assert.equal(validPanel(panel),false);panel.widgets[0].w=3;
  panel.folders.push({id:'child',name:'Child',parentId:'root',groupIds:['s']});assert(validPanel(panel));
  panel.folders[0].parentId='child';assert.equal(validPanel(panel),false);
  panel.folders[0].parentId=null;panel.folders[1].parentId='missing';assert.equal(validPanel(panel),false);
});
test('tags and folders resolve direct membership, filter independently by side, and preserve junction roles',()=>{
  assert.deepEqual(contextGroups(groups,{type:'tag',id:'Studio'},'source').map(g=>g.id),['s']);
  assert.deepEqual(contextGroups(groups,{type:'tag',id:'Studio'},'both').map(g=>g.id),['s','d']);
  const folders=[{id:'root',groupIds:['s']},{id:'child',parentId:'root',groupIds:['d','missing']}];
  assert.deepEqual(contextGroups(groups,{type:'folder',id:'child'},'both',folders).map(g=>g.id),['d']);
  assert.equal(contextGroups(groups,{type:'all'},'destination').length,2);
  assert.deepEqual(contextGroups(groups,null,'both'),[]);
});
test('device browsing uses endpoint mappings, handles groups spanning devices, and does not guess from names',()=>{
  const split={...source,id:'split',levels:[...source.levels,{id:'topo:monitor.mod.S2',key:'Audio'}]};
  const catalog=deviceCatalog([...groups,split],[{id:'camera',name:'Camera gateway'}]);
  assert.deepEqual(catalog.find(d=>d.id==='camera').groupIds,['s','split']);
  assert.equal(catalog.find(d=>d.id==='camera').name,'Camera gateway');
  assert.deepEqual(contextGroups([...groups,split],{type:'device',id:'monitor'},'both').map(g=>g.id),['d','split']);
  assert.equal(catalog.some(d=>d.groupIds.includes('j')),false);
});
test('Take refuses stale, read-only, missing, self and locked selections and exposes partial-route consequences',()=>{
  const now=Date.now(),state={canWrite:true,lastSync:new Date(now).toISOString(),syncSeconds:5,routes:[]};
  assert.equal(takePlan(state,source,destination,'disconnect',now).status,'partial');
  assert.match(takePlan(state,source,destination,'disconnect',now).warning,/disconnect/);
  assert.match(takePlan({...state,routes:[{to:destination.levels[0].id,locked:true}]},source,destination).reason,/locked/);
  assert.match(takePlan({...state,error:'offline'},source,destination).reason,/stale/);
  assert.match(takePlan(state,source,destination,'disconnect',now+16000).reason,/stale/);
  assert.match(takePlan({...state,canWrite:false},source,destination).reason,/read-only/);
  assert.match(takePlan(state,source,null).reason,/destination/);
  assert.match(takePlan(state,null,destination).reason,/source/);
  assert.match(takePlan(state,junction,junction).reason,/itself/);
});
