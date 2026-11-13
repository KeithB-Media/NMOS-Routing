// BCP-007-03 (MXL) above the engine: adapter exposure, planner refusal of
// RTP<->MXL mixes, and the demo server end to end.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inventoryOf} from '../lib/nmos-model.mjs';
import {planRoute} from '../lib/model.mjs';
import {routeCompatibility} from '../public/route-options.js';
import {networkValues} from '../public/workspace.js';
import {demoState} from '../lib/demo-state.mjs';
import {createRouteDesk} from '../route-server.mjs';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const nmosState = {
  senders: {'demo-0000': {transport: 'urn:x-nmos:transport:mxl'}},
  receivers: {},
  senderActiveData: {},
};

test('adapter exposes transport and MXL params; address columns describe the MXL domain and flow', () => {
  const state = demoState();
  const mxlOut = state.devices.find(d => d.id === 'nmos_mxl1').senders.video[0], uuid = mxlOut.id.slice(5);
  const raw = {senders: {[uuid]: {transport: 'urn:x-nmos:transport:mxl'}}, receivers: {}, senderActiveData: {[uuid]: {transport_params: [{mxl_domain_id: 'studio-a', mxl_flow_id: 'flow-0001'}]}}};
  const {groups} = inventoryOf(state, {nmosState: raw});
  const level = groups.find(g => g.id === 'src:nmos_mxl1').levels[0];
  assert.equal(level.network.transport, 'mxl'); assert.deepEqual(level.network.legs, []);
  assert.deepEqual(level.network.mxl, {domainId: 'studio-a', flowId: 'flow-0001'});
  assert.deepEqual(networkValues({levels: [level]}, null, 'multicast'), ['MXL · studio-a']);
  assert.deepEqual(networkValues({levels: [level]}, null, 'sourceAddress'), ['flow flow-0001']);
  const receiverLevel = groups.find(g => g.id === 'dst:nmos_mxl1').levels[0];
  assert.equal(receiverLevel.network.transport, 'mxl', 'without a raw mirror the engine capability tag still identifies MXL');
  assert.equal(groups.find(g => g.id === 'src:nmosgrp_cam1').levels[0].network.transport, 'rtp');
  assert.deepEqual(inventoryOf(state, {nmosState}).groups.find(g => g.id === 'src:nmos_mxl1').levels[0].network.mxl, null, 'no params until the sender active data is mirrored');
});

test('planners refuse to mix transports and explain why; same-transport routes plan normally', () => {
  const {groups, routes} = inventoryOf(demoState());
  const cam = groups.find(g => g.id === 'src:nmosgrp_cam1'), mxlIn = groups.find(g => g.id === 'dst:nmos_mxl1'), mxlOut = groups.find(g => g.id === 'src:nmos_mxl1'), mon = groups.find(g => g.id === 'dst:nmosgrp_mon1');
  assert.throws(() => planRoute(groups, routes, {sourceId: cam.id, destinationId: mxlIn.id}), /uses MXL transport; CAM 1 offers RTP/);
  assert.throws(() => planRoute(groups, routes, {sourceId: mxlOut.id, destinationId: mon.id, levelKey: 'video-1'}), /uses RTP transport; MXL Function 1 offers MXL/);
  assert.deepEqual(planRoute(groups, routes, {sourceId: mxlOut.id, destinationId: mxlIn.id}).map(e => [e.from, e.to]), [[mxlOut.levels[0].id, mxlIn.levels[0].id]]);
  const mismatch = routeCompatibility(cam, mxlIn);
  assert.equal(mismatch.status, 'unavailable'); assert.match(mismatch.reason, /Video 1 uses MXL transport, source offers RTP/);
  assert.equal(routeCompatibility(mxlOut, mxlIn).status, 'full');
});

test('demo server routes MXL to MXL and rejects RTP to MXL before touching the backend', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'mxl-'));
  const app = await createRouteDesk({env: {PORT: '0', ROUTING_MODE: 'demo', DATA_DIR: dataDir}});
  t.after(async () => { await app.close(); await rm(dataDir, {recursive: true, force: true}); });
  const post = async (url, data) => { const r = await fetch(app.url + url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)}); return {status: r.status, body: await r.json()}; };
  const refused = await post('/api/route', {sourceId: 'src:nmosgrp_cam1', destinationId: 'dst:nmos_mxl1'});
  assert.equal(refused.status, 400); assert.match(refused.body.error, /MXL transport/);
  const ok = await post('/api/route', {sourceId: 'src:nmos_mxl1', destinationId: 'dst:nmos_mxl1'});
  assert.equal(ok.status, 200);
  const mxlIn = ok.body.groups.find(g => g.id === 'dst:nmos_mxl1');
  assert.equal(ok.body.routes.find(r => r.to === mxlIn.levels[0].id).from, ok.body.groups.find(g => g.id === 'src:nmos_mxl1').levels[0].id);
  assert.equal(mxlIn.type, 'MXL');
});
