import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupSearchFields,routeCompatibility,destinationRouteSummary} from '../public/route-options.js';
import {compileSearch} from '../public/search.js';
import {planRoute} from '../lib/model.mjs';
import {inventoryOf} from '../lib/nmos-model.mjs';
import {demoState} from '../lib/demo-state.mjs';
const {groups}=inventoryOf(demoState());
// RPLY 1 carries video + 2 audio; MON 2 wants video + 4 audio, so Audio 3/4 are the missing levels.
const source=groups.find(g=>g.id==='src:nmosgrp_rply1');
const destination=groups.find(g=>g.id==='dst:nmosgrp_mon2');

test('mixed destination prominently names its video source and describes each routed level',()=>{
  const other=groups.find(g=>g.id==='src:nmosgrp_cam2');
  const owners=new Map(groups.filter(g=>g.side==='source').flatMap(g=>g.levels.map(l=>[l.id,g])));
  const routes=new Map(destination.levels.map(l=>[l.id,[{from:(source.levels.find(s=>s.key===l.key)||other.levels.find(s=>s.key===l.key)).id,to:l.id}]]));
  const summary=destinationRouteSummary(destination,routes,owners);
  assert.equal(summary.current,'RPLY 1');assert(summary.mixed);
  assert.match(summary.detail,/Video 1: RPLY 1/);assert.match(summary.detail,/Audio 3: CAM 2/);
});

test('partial and unrouted video states never imply an audio source is carrying video',()=>{
  const video=destination.levels.find(l=>l.kind==='video'),audio=destination.levels.find(l=>l.kind==='audio');
  const owners=new Map(source.levels.map(l=>[l.id,source]));
  const videoOnly=destinationRouteSummary(destination,new Map([[video.id,[{from:source.levels.find(l=>l.key===video.key).id}]]]),owners);
  assert.equal(videoOnly.current,'RPLY 1');assert(videoOnly.mixed);
  const audioOnly=destinationRouteSummary(destination,new Map([[audio.id,[{from:source.levels.find(l=>l.key===audio.key).id}]]]),owners);
  assert.equal(audioOnly.current,'Video unrouted');assert(audioOnly.mixed);
  const unrouted=destinationRouteSummary(destination,new Map(),owners);
  assert.equal(unrouted.current,'Unrouted');assert.equal(unrouted.mixed,false);
});

test('consistent routes have no breakaway warning, while identically named groups remain distinct',()=>{
  const origin={id:'origin',name:'Camera'},other={id:'other',name:'Camera'};
  const owners=new Map([['video',origin],['audio',other]]);
  const group={levels:[{id:'v',kind:'video',name:'Video 1'},{id:'a',kind:'audio',name:'Audio 1'}]};
  const routes=new Map([['v',[{from:'video'}]],['a',[{from:'audio'}]]]);
  assert.equal(destinationRouteSummary(group,routes,owners).mixed,true);
  owners.set('audio',origin);
  const summary=destinationRouteSummary(group,routes,owners);
  assert.equal(summary.current,'Camera');assert.equal(summary.mixed,false);
});

test('groups remain discoverable by display name, raw NMOS label, operator alias and node description',()=>{
  const renamed={...source,name:'Replay A',description:source.description+'\nAlias: Replay A'};
  const fields=groupSearchFields(renamed);
  for(const query of ['Replay A','"Replay A"','RPLY 1','Node 11'])assert(compileSearch(query)(fields),query);
  assert.equal(renamed.system,'RPLY 1','the raw NMOS label stays as the system name');
});
test('MON 2 versus RPLY 1 explains the missing Audio 3 and 4 instead of hiding the source',()=>{
  const plan=routeCompatibility(source,destination);
  assert.equal(plan.status,'partial');assert.equal(plan.matches.length,3);assert.equal(plan.required.length,5);
  assert.deepEqual(plan.unchanged.map(x=>x.level.name),['Audio 3','Audio 4']);assert.match(plan.reason,/Audio 3 will disconnect · Audio 4 will disconnect/);
  assert.match(routeCompatibility(source,destination,undefined,new Set(),'keep').reason,/Audio 3 stays unchanged/);
  const audio3=destination.levels.find(l=>l.name==='Audio 3');
  assert.equal(routeCompatibility(source,destination,undefined,new Set([audio3.id])).status,'unavailable');
  assert.equal(routeCompatibility(source,destination,undefined,new Set([audio3.id]),'keep').status,'partial');
  assert.equal(routeCompatibility(source,destination,'video-1').status,'full');
  assert.equal(routeCompatibility(source,destination,'audio-3').status,'unavailable');
});
test('a take routes matching content keys only; missing Audio 3/4 are handled by separate disconnects',()=>{
  const entries=planRoute(groups,[],{sourceId:source.id,destinationId:destination.id});
  assert.equal(entries.length,3);assert(entries.every(e=>!e.groupParent));
  assert(!entries.some(e=>e.to===destination.levels.find(l=>l.name==='Audio 3').id));
});
test('content key matching honors matching-level locks and ignores locks on unmatched levels',()=>{
  const data={sourceId:source.id,destinationId:destination.id};
  const video=destination.levels.find(l=>l.kind==='video');
  assert.throws(()=>planRoute(groups,[{to:video.id,locked:true}],data),/locked/);
  const audio3=destination.levels.find(l=>l.name==='Audio 3');assert.equal(planRoute(groups,[{to:audio3.id,locked:true}],data).length,3);
  assert.throws(()=>planRoute([{...source,levels:[]},destination],[],data),/matching content IDs/);
});
