import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planRoute,planDisconnect,planMissingDisconnect,validateNameChange,validateNameChanges} from '../lib/model.mjs';

const level=(id,key,kind=key.split('-')[0])=>({id,key,kind,name:key});
const groups=[
  {id:'src:cam1',side:'source',name:'Camera 1',levels:[level('nmos_c1v','video-1'),level('nmos_c1a','audio-1')]},
  {id:'src:cam2',side:'source',name:'Camera 2',levels:[level('nmos_c2v','video-1'),level('nmos_c2a','audio-1')]},
  {id:'dst:mon1',side:'destination',name:'Monitor 1',levels:[level('nmos_m1v','video-1'),level('nmos_m1a','audio-1')]},
];

test('virtual junctions route in both directions and disconnect per side',()=>{
  const all=[...groups,{id:'jun:patch',side:'bidirectional',bidirectional:true,name:'Patch',levels:[level('jun:v','video-1'),level('jun:a','audio-1')]}];
  const input=planRoute(all,[],{sourceId:'src:cam1',destinationId:'jun:patch'}),output=planRoute(all,[],{sourceId:'jun:patch',destinationId:'dst:mon1'});
  assert.equal(input[0].to,'jun:v');assert.equal(output[0].from,'jun:v');
  assert.deepEqual(output[0].groupParent,{from:'jun:patch',to:'dst:mon1'});
  const routes=[...input,...output].map((r,i)=>({...r,id:String(i)}));
  assert.deepEqual(planDisconnect(all,routes,{groupId:'jun:patch',side:'destination'}).map(r=>r.id),['0','1']);
  assert.deepEqual(planDisconnect(all,routes,{groupId:'jun:patch',side:'source',levelKey:'audio-1'}).map(r=>r.id),['3']);
  assert.throws(()=>planDisconnect(all,routes,{groupId:'jun:patch'}),/side/);
  assert.throws(()=>planRoute(all,routes,{sourceId:'jun:patch',destinationId:'jun:patch'}),/itself/);
  assert.throws(()=>planRoute(all,[{to:'jun:v',locked:true}],{sourceId:'src:cam1',destinationId:'jun:patch'}),/locked/);
});

test('name changes validate default names, length and control characters; fills use one alias set at a time',()=>{
  assert.equal(validateNameChange({groupId:'g',name:' New name ',previous:'Old'}).name,'New name');
  assert.equal(validateNameChange({groupId:'g',aliasSet:'eng',name:'',previous:'Old'}).name,'');
  for(const name of ['', 'x'.repeat(201),'bad\nname'])assert.throws(()=>validateNameChange({groupId:'g',name,previous:'Old'}),/name/);
  assert.throws(()=>validateNameChange({groupId:'g',name:'New'}),/Invalid/);
  assert.throws(()=>validateNameChanges([{groupId:'g',name:'A',previous:'a'},{groupId:'g',name:'B',previous:'b'}]),/once/);
  assert.throws(()=>validateNameChanges([]),/between/);
});

test('group routes match every content key and include the group parent',()=>{
  const entries=planRoute(groups,[],{sourceId:'src:cam1',destinationId:'dst:mon1'});
  assert.equal(entries.length,2);assert.equal(entries[0].to,'nmos_m1v');
  assert.deepEqual(entries[0].groupParent,{from:'src:cam1',to:'dst:mon1'});
});
test('breakaway routes change exactly one level without a group parent',()=>{
  const entries=planRoute(groups,[],{sourceId:'src:cam2',destinationId:'dst:mon1',levelKey:'audio-1'});
  assert.equal(entries.length,1);assert.equal(entries[0].from,'nmos_c2a');assert(!entries[0].groupParent);
});
test('reject missing groups, nonexistent content keys and locks',()=>{
  const data={sourceId:'src:cam1',destinationId:'dst:mon1'};
  assert.throws(()=>planRoute(groups,[],{...data,sourceId:'deleted'}),/no longer exists/);
  assert.throws(()=>planRoute(groups,[],{...data,levelKey:'bad'}),/No routable/);
  assert.throws(()=>planRoute(groups,[{to:'nmos_m1v',locked:true}],data),/locked/);
});
test('disconnect scopes destination groups, single levels and source fanout without touching unrelated routes',()=>{
  const routes=[{id:'video',from:'nmos_c1v',to:'nmos_m1v'},{id:'audio',from:'nmos_c1a',to:'nmos_m1a'},{id:'fanout',from:'nmos_c1v',to:'another:v'},{id:'unrelated',from:'nmos_c2v',to:'elsewhere:v'}];
  assert.deepEqual(planDisconnect(groups,routes,{groupId:'dst:mon1'}).map(r=>r.id),['video','audio']);
  assert.deepEqual(planDisconnect(groups,routes,{groupId:'dst:mon1',levelKey:'audio-1'}).map(r=>r.id),['audio']);
  assert.deepEqual(planDisconnect(groups,routes,{groupId:'src:cam1',levelKey:'video-1'}).map(r=>r.id),['video','fanout']);
  assert.deepEqual(planDisconnect(groups,routes,{groupId:'src:cam1'}).map(r=>r.id),['video','audio','fanout']);
  assert.throws(()=>planDisconnect(groups,[{...routes[0],locked:true}],{groupId:'dst:mon1'}),/locked/);
  assert.throws(()=>planDisconnect(groups,routes,{groupId:'deleted'}),/no longer exists/);
  assert.throws(()=>planDisconnect(groups,routes,{groupId:'dst:mon1',levelKey:'unknown'}),/Level no longer exists/);
});
test('missing levels disconnect by default, keep is explicit, and individual routing never clears other levels',()=>{
  const subset=groups.map(g=>g.id==='src:cam1'?{...g,levels:g.levels.slice(0,1)}:g);
  const routes=[{id:'audio',from:'nmos_c2a',to:'nmos_m1a'},{id:'unrelated',from:'nmos_c2a',to:'elsewhere:a'}];
  const data={sourceId:'src:cam1',destinationId:'dst:mon1'};
  assert.deepEqual(planMissingDisconnect(subset,routes,data),[routes[0]]);
  assert.deepEqual(planMissingDisconnect(subset,routes,{...data,missingLevelPolicy:'keep'}),[]);
  assert.deepEqual(planMissingDisconnect(subset,routes,{...data,levelKey:'video-1'}),[]);
  assert.throws(()=>planMissingDisconnect(subset,[{...routes[0],locked:true}],data),/locked/);
  assert.throws(()=>planMissingDisconnect(subset,routes,{...data,missingLevelPolicy:'invalid'}),/policy/);
});
