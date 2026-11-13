import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=8000) {const end=Date.now()+timeout;while(Date.now()<end){const r=await fn();if(r)return r;await delay(75);}throw new Error('Timed out waiting for the server');}
async function start(env,startupMs=10000) {
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'0',HOST:'127.0.0.1',...env},stdio:['ignore','pipe','pipe']});
  let log='';child.stderr.on('data',s=>log+=s);
  const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Server startup timed out: '+log)),startupMs);
    // Match the server banner only: the engine also logs registry URLs to stdout.
    child.stdout.on('data',s=>{const match=String(s).match(/NMOS Routing \([a-z]+\): (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    child.on('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code+': '+log));});
  });
  return {base,child,async stop(){if(child.exitCode!==null)return;const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}};
}
async function api(base,url='/api/inventory',data) {
  const response=await fetch(base+url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  return {status:response.status,body:await response.json(),headers:response.headers};
}
async function tempDir(prefix){await mkdir(path.join(root,'test-output'),{recursive:true});return mkdtemp(path.join(root,'test-output',prefix));}
const cleanup=async dir=>{if(dir.startsWith(path.join(root,'test-output')+path.sep))await rm(dir,{recursive:true,force:true});};

test('demo server: inventory, ETag caching, routing with missing-level policy, breakaway, disconnect, names, tags, favorites and restart persistence',async t=>{
  const dataDir=await tempDir('demo-');
  let app;
  t.after(async()=>{await app?.stop();await cleanup(dataDir);});
  app=await start({DATA_DIR:dataDir,ROUTING_MODE:'demo',UI_PASSWORD:''});
  const initial=await api(app.base);
  assert.equal(initial.body.mode,'demo');assert.equal(initial.body.canWrite,true);assert.equal(initial.body.error,null);
  assert(initial.body.groups.length>40);assert(initial.body.routes.length>30);assert(initial.body.devices.length>40);
  assert.equal((await fetch(app.base+'/healthz')).status,200);
  assert.equal((await fetch(app.base+'/')).headers.get('content-type'),'text/html; charset=utf-8');
  const embedded=await fetch(app.base+'/embed');assert.equal(embedded.status,200);assert.match(await embedded.text(),/routing-panel/);
  assert.match(embedded.headers.get('content-security-policy'),/frame-ancestors 'self';/);
  assert.match((await fetch(app.base+'/')).headers.get('content-security-policy'),/frame-ancestors 'none';/);
  const unchanged=await fetch(app.base+'/api/inventory',{headers:{'If-None-Match':initial.headers.get('etag')}});assert.equal(unchanged.status,304);

  // Full take: RPLY 1 (video + 2 audio) → MON 2 (video + 4 audio) routes the intersection and disconnects MON 2's audio 3/4 (missing-level policy).
  const rply=initial.body.groups.find(g=>g.id==='src:nmosgrp_rply1'),mon=initial.body.groups.find(g=>g.id==='dst:nmosgrp_mon2');
  assert.deepEqual(rply.levels.map(l=>l.key),['video-1','audio-1','audio-2']);assert.equal(mon.levels.length,5);
  assert(initial.body.routes.some(r=>r.to===mon.levels[4].id),'MON 2 audio 4 starts routed from CAM 2');
  const route=await api(app.base,'/api/route',{sourceId:rply.id,destinationId:mon.id});
  assert.equal(route.status,200);assert.equal(route.body.routePending,false);
  for(const l of rply.levels)assert(route.body.routes.some(r=>r.to===mon.levels.find(x=>x.key===l.key).id&&r.from===l.id));
  assert(!route.body.routes.some(r=>r.to===mon.levels[4].id),'missing destination levels are disconnected by default');
  assert.deepEqual(route.body.disconnectedRoutes.map(r=>r.to).sort(),[mon.levels[3].id,mon.levels[4].id].sort());
  const kept=await api(app.base,'/api/route',{sourceId:'src:nmosgrp_cam1',destinationId:'dst:nmosgrp_mon3',missingLevelPolicy:'keep'});assert.equal(kept.status,200);assert.deepEqual(kept.body.disconnectedRoutes,[]);
  // Breakaway: one level only.
  const cam4=initial.body.groups.find(g=>g.id==='src:nmosgrp_cam4');
  const breakaway=await api(app.base,'/api/route',{sourceId:cam4.id,destinationId:mon.id,levelKey:'audio-1'});
  assert.equal(breakaway.status,200);
  assert.equal(breakaway.body.routes.find(r=>r.to===mon.levels[1].id).from,cam4.levels[1].id);
  assert.equal(breakaway.body.routes.find(r=>r.to===mon.levels[0].id).from,rply.levels[0].id,'breakaway leaves other levels untouched');
  // Disconnect a level, then the whole group.
  const level=await api(app.base,'/api/disconnect',{groupId:mon.id,levelKey:'audio-1'});assert.equal(level.status,200);assert(!level.body.routes.some(r=>r.to===mon.levels[1].id));
  const all=await api(app.base,'/api/disconnect',{groupId:mon.id});assert.equal(all.status,200);assert(!all.body.routes.some(r=>mon.levels.some(l=>l.id===r.to)));
  // Validation.
  assert.equal((await api(app.base,'/api/route',{sourceId:rply.id,destinationId:'dst:nmosgrp_mv1',levelKey:'data-1'})).status,400,'no matching content key');
  assert.equal((await api(app.base,'/api/route',{sourceId:'missing',destinationId:mon.id})).status,400);
  // Offline receivers refuse routes.
  const desk=initial.body.groups.find(g=>g.id==='dst:nmos_desk');assert.equal(desk.levels[3].available,false);
  const offline=await api(app.base,'/api/route',{sourceId:'src:nmosgrp_cam1',destinationId:desk.id,levelKey:'audio-4'});assert.equal(offline.status,502);assert.match(offline.body.error,/offline/);assert.equal(offline.body.routePending,true);
  assert.equal((await api(app.base,'/api/route',{sourceId:'src:nmos_virtual',destinationId:desk.id,levelKey:'audio-1'})).status,200,'a virtual sender routes like any other');
  // Names map to the engine alias; stale previous values are rejected; alias sets do not exist.
  const renamed=await api(app.base,'/api/name',{groupId:mon.id,name:'Renamed monitor',previous:mon.name});
  assert.equal(renamed.status,200);assert.equal(renamed.body.groups.find(g=>g.id===mon.id).name,'Renamed monitor');assert.equal(renamed.body.groups.find(g=>g.id===mon.id).system,'MON 2');
  assert.equal((await api(app.base,'/api/name',{groupId:mon.id,name:'Stale',previous:mon.name})).status,400);
  assert.equal((await api(app.base,'/api/name',{groupId:mon.id,aliasSet:'eng',name:'Alias',previous:''})).status,400);
  const targets=renamed.body.groups.filter(g=>g.side==='destination'&&g.id.startsWith('dst:nmosgrp_mv')).slice(0,2);
  const changes=targets.map((g,i)=>({groupId:g.id,name:'MV-0'+(i+1),previous:g.name}));
  assert.equal((await api(app.base,'/api/names',{changes:changes.map((c,i)=>i?{...c,previous:'stale'}:c)})).status,400);
  const filled=await api(app.base,'/api/names',{changes});assert.equal(filled.status,200);for(const c of changes)assert.equal(filled.body.groups.find(g=>g.id===c.groupId).name,c.name);
  // Tags and favorites (local metadata).
  assert.equal((await api(app.base,'/api/tags',{id:mon.id,tags:['New tag','Production']})).status,200);
  assert.equal((await api(app.base,'/api/favorite',{id:mon.id})).status,200);
  assert.equal((await api(app.base,'/api/tags',{id:mon.id,tags:['x'.repeat(49)]})).status,400);
  // Hidden flows leave the inventory; SDP popup reads cached manifests.
  const hidden=await api(app.base,'/api/hidden',{id:'nmos_virtual'});assert.equal(hidden.status,200);assert(!hidden.body.groups.some(g=>g.id==='src:nmos_virtual'));
  assert(!(await api(app.base,'/api/hidden',{id:'nmos_virtual'})).body.groups.some(g=>g.id==='src:nmos_virtual')===false);
  const sdp=await api(app.base,'/api/sdp?'+new URLSearchParams({groupId:'src:nmos_virtual',view:'source'}));assert.equal(sdp.status,200);assert.match(sdp.body.blocks[0].sdp,/m=audio/);
  const engine=await api(app.base,'/api/engine');assert.equal(engine.body.mode,'demo');assert.deepEqual(engine.body.log,[]);
  assert.equal((await api(app.base,'/api/audio/subscribe',{senderId:'x',listenerId:'l'})).status,404);assert.equal((await fetch(app.base+'/x-nmos/node/v1.3/self')).status,404);assert.deepEqual(initial.body.audioMonitor,{enabled:false,available:false});
  // BCP-008: the demo state carries one degraded receiver (MON 3 audio 4) and one healthy video.
  const mon3=initial.body.groups.find(g=>g.id==='dst:nmosgrp_mon3');assert.deepEqual(mon3.monitor,{worst:3,count:1});assert.equal(mon3.levels[4].monitor.status,3);assert.equal(mon3.levels[4].monitor.domains.length,4);
  const counters=await api(app.base,'/api/bcp008/counters',{id:mon3.levels[4].id});assert.equal(counters.status,200);assert.equal(counters.body.groups[0].counters.find(c=>c.name==='packets_lost').value,4210);
  assert.equal((await api(app.base,'/api/bcp008/counters',{id:mon3.levels[0].id})).status,404,'flows without a monitor have no counters');
  assert.equal((await api(app.base,'/api/bcp008/reset',{id:mon3.levels[4].id})).status,200);
  assert.equal((await api(app.base)).body.groups.find(g=>g.id==='dst:nmosgrp_mon3').levels[4].monitor.counter,0,'reset clears transition counters');
  const cross=await fetch(app.base+'/api/route',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});assert.equal(cross.status,403);
  // Metadata survives a restart; demo inventory does not (it is regenerated).
  await app.stop();app=await start({DATA_DIR:dataDir,ROUTING_MODE:'demo',UI_PASSWORD:''});
  const restored=(await api(app.base)).body;
  assert.deepEqual(restored.metadata.tags[mon.id],['New tag','Production']);assert(restored.metadata.favorites.includes(mon.id));assert(restored.metadata.activity.some(a=>a.type==='route'));
  assert.equal(restored.groups.find(g=>g.id===mon.id).name,'MON 2');
});

test('manual groups overlay automatic groups, route like any group, survive restart and release flows on delete',async t=>{
  const dataDir=await tempDir('groups-');
  let app;
  t.after(async()=>{await app?.stop();await cleanup(dataDir);});
  app=await start({DATA_DIR:dataDir,ROUTING_MODE:'demo',UI_PASSWORD:''});
  const listing=await api(app.base,'/api/groups');assert.equal(listing.status,200);assert.deepEqual(listing.body.groups,[]);
  const mv1=listing.body.catalog.filter(f=>f.deviceId==='nmosgrp_mv1'),mv2=listing.body.catalog.filter(f=>f.deviceId==='nmosgrp_mv2');
  assert.deepEqual(mv1.map(f=>[f.side,f.kind]),[['destination','video'],['destination','audio']]);
  // Wrong side is rejected; nothing is stored.
  assert.equal((await api(app.base,'/api/groups',{group:{side:'source',name:'Bad',levels:[mv1[0].id]}})).status,400);
  const created=await api(app.base,'/api/groups',{group:{side:'destination',name:'Quad wall',levels:[mv1[0].id,mv2[0].id,mv1[1].id,mv2[1].id]}});
  assert.equal(created.status,200);const id=created.body.group.id;assert.match(id,/^man:/);
  assert.deepEqual(created.body.group.levels.map(l=>l.key),['video-1','video-2','audio-1','audio-2']);
  const wall=created.body.groups.find(g=>g.id===id);
  assert.equal(wall.type,'Manual group');assert.deepEqual(wall.levels.map(l=>l.id),[mv1[0].id,mv2[0].id,mv1[1].id,mv2[1].id]);
  assert(!created.body.groups.some(g=>g.id==='dst:nmosgrp_mv1'||g.id==='dst:nmosgrp_mv2'),'fully claimed automatic groups disappear');
  assert(created.body.routes.some(r=>r.to===mv1[0].id),'existing routes to claimed flows are kept');
  // Routing through the manual group: two gateway outputs feed video-1/2; breakaway on video-2.
  const gw=created.body.groups.find(g=>g.id==='src:nmos_gw1');
  const routed=await api(app.base,'/api/route',{sourceId:gw.id,destinationId:id});assert.equal(routed.status,200);
  assert.equal(routed.body.routes.find(r=>r.to===mv1[0].id).from,gw.levels[0].id);assert.equal(routed.body.routes.find(r=>r.to===mv2[0].id).from,gw.levels[1].id);
  assert.deepEqual(routed.body.disconnectedRoutes,[],'audio levels without a source key stay as they were');
  // A second group may not claim the same flow; editing keeps its own flows.
  assert.match((await api(app.base,'/api/groups',{group:{side:'destination',name:'Other',levels:[mv1[0].id]}})).body.error,/already belongs/);
  const edited=await api(app.base,'/api/groups',{group:{id,side:'destination',name:'Quad wall A',levels:[mv2[0].id,mv1[0].id]}});assert.equal(edited.status,200);
  const changed=edited.body.groups.find(g=>g.id===id);assert.equal(changed.name,'Quad wall A');assert.deepEqual(changed.levels.map(l=>l.id),[mv2[0].id,mv1[0].id]);
  assert.deepEqual(edited.body.groups.find(g=>g.id==='dst:nmosgrp_mv1').levels.map(l=>l.key),['audio-1'],'released audio returns to its automatic group');
  // Persistence across restart.
  await app.stop();app=await start({DATA_DIR:dataDir,ROUTING_MODE:'demo',UI_PASSWORD:''});
  const restored=(await api(app.base)).body;assert.equal(restored.groups.find(g=>g.id===id)?.name,'Quad wall A');assert(restored.metadata.activity.some(a=>a.type==='group'));
  const deleted=await api(app.base,'/api/groups/delete',{id});assert.equal(deleted.status,200);
  assert(!deleted.body.groups.some(g=>g.id===id));assert.deepEqual(deleted.body.groups.find(g=>g.id==='dst:nmosgrp_mv1').levels.map(l=>l.key),['video-1','audio-1']);
  assert.equal((await api(app.base,'/api/groups/delete',{id})).status,400);
});

test('embed permits only the configured panel origins and keeps the full application unframeable',async t=>{
  const dataDir=await tempDir('embed-');
  const app=await start({DATA_DIR:dataDir,ROUTING_MODE:'demo',UI_PASSWORD:'',EMBED_ALLOWED_ORIGINS:'http://10.101.13.150'});
  t.after(async()=>{await app.stop();await cleanup(dataDir);});
  for(const url of ['/embed','/embed/']) {
    const response=await fetch(app.base+url);assert.equal(response.status,200);
    assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self' http:\/\/10\.101\.13\.150;/);
  }
  assert.match((await fetch(app.base+'/')).headers.get('content-security-policy'),/frame-ancestors 'none';/);
  const write=await fetch(app.base+'/api/route',{method:'POST',headers:{Origin:'http://10.101.13.150','Content-Type':'application/json'},body:'{}'});
  assert.equal(write.status,403,'framing permission must not enable cross-origin API writes');
});

test('live server boots the crosspoint engine in-process, reports a missing registry, seeds its config and blocks writes until connected',async t=>{
  const dataDir=await tempDir('live-');
  const app=await start({DATA_DIR:dataDir,ROUTING_MODE:'live',WRITE_ENABLED:'true',UI_PASSWORD:'',NMOS_REGISTRY:'127.0.0.1',NMOS_REGISTRY_PORT:'1'},20000);
  t.after(async()=>{await app.stop();await cleanup(dataDir);});
  const inventory=await until(async()=>{const r=await api(app.base);return r.body.engine?.registries?.length?r:null;},15000);
  assert.equal(inventory.body.mode,'live');assert.deepEqual(inventory.body.groups,[]);assert.equal(inventory.body.canWrite,true);
  assert.match(inventory.body.error,/registry/);assert.equal(inventory.body.engine.connected,false);
  assert.deepEqual(inventory.body.engine.registries.map(r=>[r.ip,r.port,r.source]),[['127.0.0.1',1,'static']]);
  const blocked=await api(app.base,'/api/route',{sourceId:'a',destinationId:'b'});assert.equal(blocked.status,409);assert.match(blocked.body.error,/registry/);
  const engine=await api(app.base,'/api/engine');assert(engine.body.log.some(l=>l.topic==='crosspoint'&&/Worker/.test(l.text)),'engine log is exposed');
  const settings=JSON.parse(await (await import('node:fs/promises')).readFile(path.join(dataDir,'engine','config','settings.json'),'utf8'));
  assert.deepEqual(settings.staticNmosRegistries,[{ip:'127.0.0.1',port:1,priority:10,domain:''}]);assert.equal(settings.logOutput,false);
  assert.equal((await fetch(app.base+'/healthz')).status,200);
  // Setup page: a registry change is written to settings.json and hot-applied to the connector.
  const setup=await api(app.base,'/api/setup');assert.equal(setup.status,200);assert.equal(setup.body.config.registry.ip,'127.0.0.1');assert.equal(setup.body.config.settingsFile,path.join(dataDir,'engine','config','settings.json'));
  const changed=await api(app.base,'/api/setup',{registry:{ip:'127.0.0.2',port:2},acceptableGmid:'00-1d-c1-ff-fe-00-00-01',bcp008:{enabled:false}});
  assert.equal(changed.status,200);assert.deepEqual(changed.body.changed,['acceptableGmid','bcp008','registry']);
  const written=JSON.parse(await (await import('node:fs/promises')).readFile(path.join(dataDir,'engine','config','settings.json'),'utf8'));
  assert.deepEqual(written.staticNmosRegistries[0],{ip:'127.0.0.2',port:2,priority:10,domain:''});assert.equal(written.acceptableGmid,'00-1D-C1-FF-FE-00-00-01');assert.equal(written.bcp008.enabled,false);
  await until(async()=>(await api(app.base)).body.engine.registries.some(r=>r.ip==='127.0.0.2'&&r.port===2),10000);
  // Virtual NMOS node: served without operator auth; empty until virtual senders exist.
  const self=await fetch(app.base+'/x-nmos/node/v1.3/self');assert.equal(self.status,200);const node=await self.json();assert.match(node.id,/^[0-9a-f-]{36}$/);assert.equal(node.api.versions[0],'v1.3');
  assert.deepEqual(await (await fetch(app.base+'/x-nmos/node/v1.3/senders')).json(),[]);
  const sdp='v=0\r\no=- 1 1 IN IP4 10.1.50.1\r\ns=Tone\r\nc=IN IP4 239.30.9.1/32\r\nt=0 0\r\nm=audio 5004 RTP/AVP 97\r\na=rtpmap:97 L24/48000/2\r\n';
  const withVirtual=await api(app.base,'/api/setup',{virtualSenders:[{name:'Tone',sdp}],virtualNode:{enabled:true}});assert.equal(withVirtual.status,200);
  assert.match(withVirtual.body.config.virtualSenders[0].senderId,/^[0-9a-f-]{36}$/,'a sender id is minted');
  const senders=await (await fetch(app.base+'/x-nmos/node/v1.3/senders')).json();assert.equal(senders.length,1);assert.equal(senders[0].id,withVirtual.body.config.virtualSenders[0].senderId);
  const manifest=await fetch(senders[0].manifest_href.replace(/^http:\/\/[^/]+/,app.base));assert.equal(manifest.status,200);assert.match(await manifest.text(),/m=audio/);
  assert.equal((await api(app.base)).body.engine.virtualNode.enabled,true);
  // Multicast probe: wrong token is dropped, correct hello is accepted and listed.
  const WebSocket=(await import('ws')).default,token=(await api(app.base,'/api/setup')).body.config.probeToken;assert.match(token,/.{8,}/);
  const bad=new WebSocket(app.base.replace('http','ws')+'/probe');bad.on('error',()=>{});await new Promise(r=>bad.on('open',()=>{bad.send(JSON.stringify({type:'hello',token:'wrong',name:'bad'}));bad.on('close',r);}));
  const good=new WebSocket(app.base.replace('http','ws')+'/probe');good.on('error',()=>{});await new Promise(r=>good.on('open',r));good.send(JSON.stringify({type:'hello',token,name:'Studio probe'}));
  await until(async()=>(await api(app.base)).body.engine.probes.some(p=>p.name==='Studio probe'),5000);good.terminate();
  // Audio monitor: disabled by default, then gated on the optional native modules.
  const off=await api(app.base,'/api/audio/subscribe',{senderId:'nmos_'+senders[0].id,listenerId:'lst_test'});assert.equal(off.status,409);
  assert.equal((await api(app.base,'/api/setup',{audioMonitor:{enabled:true}})).status,200);
  const on=await api(app.base,'/api/audio/subscribe',{senderId:'nmos_'+senders[0].id,listenerId:'lst_test'});
  assert([200,503].includes(on.status),'subscribe: '+on.status+' '+JSON.stringify(on.body));if(on.status===503)assert.match(on.body.error,/not available|opus|werift|multicast/i);
  assert.equal((await api(app.base,'/api/audio/unsubscribe',{listenerId:'lst_test'})).status,200);
});
