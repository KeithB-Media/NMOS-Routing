import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {NmosViewer,NodeViewer,RegistryViewer,apiBase,resolveApi} from '../lib/nmos-viewer.mjs';
import {createRouteDesk} from '../route-server.mjs';
import {mockNmos} from './nmos-fixture.mjs';

test('direct node resources, advertised IS-05 control, receiver disable state and both SDP legs',async t=>{
  const mock=await mockNmos();t.after(()=>mock.close());
  const viewer=new NodeViewer(mock.base+'/x-nmos/node/v1.3');
  const [a,b]=await Promise.all([viewer.inventory(),viewer.inventory()]);
  assert.equal(a.nodes.length,1);assert.equal(b.nodes.length,1);assert.equal(a.nodes[0].label,'Studio node');
  assert.equal(mock.state.requests.length,6,'concurrent inventory reads coalesce');
  for(const type of ['self','devices','senders','receivers','sources','flows'])assert.equal(a.nodes[0].resources[type].length,1);
  const cached=mock.state.requests.length;await viewer.inventory();assert.equal(mock.state.requests.length,cached);
  const node=a.nodes[0].id;
  const sender=await viewer.detail(node,'senders','sender-1');assert.equal(sender.sdp,mock.sdp);assert.equal(sender.legs.length,2);assert.equal(sender.active.master_enable,false);
  const receiver=await viewer.detail(node,'receivers','receiver-1');assert.equal(receiver.active.master_enable,false);assert.equal(receiver.sdp,mock.sdp);
  assert(mock.state.requests.every(r=>r.method==='GET'&&!r.auth));
  assert(mock.state.requests.some(r=>r.url==='/x-nmos/connection/v1.1/single/receivers/receiver-1/active'));
  await assert.rejects(viewer.detail(node,'senders','not-known'),/no longer available/);
  await assert.rejects(viewer.detail(node,'..','sender-1'),/Unknown/);
});

test('host and unversioned URLs discover the highest advertised Node or Query API version',async t=>{
  const mock=await mockNmos();t.after(()=>mock.close());
  assert.equal(await resolveApi(mock.base,'node'),mock.base+'/x-nmos/node/v1.3/');
  assert.equal(await resolveApi(mock.base+'/x-nmos/query/','query'),mock.base+'/x-nmos/query/v1.3/');
  await assert.rejects(resolveApi(mock.base+'/arbitrary/path','node'),/Enter a host URL/);
});

test('registry follows prev pagination toward older resources and associates resources with node devices',async t=>{
  const mock=await mockNmos();t.after(()=>mock.close());const viewer=new RegistryViewer(mock.base+'/x-nmos/query/v1.3/');
  const result=await viewer.inventory(),node=result.nodes[0];assert.equal(result.error,null);assert.equal(node.resources.senders.length,2);
  assert.equal(node.resources.flows[0].id,'flow-1');assert.equal(node.resources.sources[0].id,'source-1');
  assert(mock.state.requests.some(r=>r.url.includes('paging.until=10:0')));assert(!mock.state.requests.some(r=>r.url.includes('paging.since')));
  assert.equal((await viewer.detail(node.id,'senders','sender-1')).sdp,mock.sdp);
  mock.state.fail=true;viewer.attemptedAt=0;const failed=await viewer.inventory();assert.match(failed.error,/503/);assert.equal(failed.nodes[0].stale,true);assert.equal(failed.nodes[0].resources.senders.length,2);
});

test('manifest host checks and redirect rejection prevent unadvertised follow-up requests',async t=>{
  const mock=await mockNmos();t.after(()=>mock.close());const viewer=new NodeViewer(mock.base+'/x-nmos/node/v1.3/');
  const result=await viewer.inventory(),node=result.nodes[0];
  mock.state.redirect=true;let detail=await viewer.detail(node.id,'senders','sender-1');assert.equal(detail.sdp,'');assert(detail.errors.length);assert(!mock.state.requests.some(r=>r.url==='/redirect-target'));
  node.resources.senders[0].manifest_href='http://elsewhere.invalid/sdp';detail=await viewer.detail(node.id,'senders','sender-1');assert.match(detail.errors.join(' '),/host differs/);
  for(const value of ['file:///x-nmos/node/v1.3/','http://user:pass@host/x-nmos/node/v1.3/','http://host/not-nmos','http://host/x-nmos/node/v1.3/?x=1'])assert.throws(()=>apiBase(value,'node'));
});

test('NMOS Routing exposes an authenticated read-only NMOS viewer API and browser assets in demo mode',async t=>{
  const mock=await mockNmos();t.after(()=>mock.close());const dataDir=await mkdtemp(path.join(os.tmpdir(),'nmos-api-'));
  const app=await createRouteDesk({env:{PORT:'0',ROUTING_MODE:'demo',DATA_DIR:dataDir,UI_PASSWORD:'test-only'}});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const {url}=app;
  assert.equal((await fetch(url+'/api/nmos')).status,401);
  const headers={Authorization:'Basic '+Buffer.from('operator:test-only').toString('base64')};
  assert.equal((await fetch(url+'/api/nmos',{headers:{...headers,'Sec-Fetch-Site':'cross-site'}})).status,403);
  const get=async suffix=>{const response=await fetch(url+suffix,{headers});return {status:response.status,body:await response.json()};};
  const empty=await get('/api/nmos');assert.equal(empty.body.mode,'demo');assert.deepEqual(empty.body.nodes,[]);
  const source=new URLSearchParams({nodeUrl:mock.base}),inventory=await get('/api/nmos?'+source);assert.equal(inventory.body.nodes.length,1);
  source.set('node',inventory.body.nodes[0].id);source.set('type','senders');source.set('id','sender-1');assert.equal((await get('/api/nmos/detail?'+source)).body.sdp,mock.sdp);
  assert.equal((await fetch(url+'/nmos-viewer.js',{headers})).status,200);
  assert.match(await(await fetch(url+'/',{headers})).text(),/data-view="nmos"/);
  assert.equal((await fetch(url+'/api/nmos',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,404);
});
