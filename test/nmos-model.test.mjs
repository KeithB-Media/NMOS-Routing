import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inventoryOf, routesOf, sdpCacheOf} from '../lib/nmos-model.mjs';
import {planRoute, planDisconnect, planMissingDisconnect} from '../lib/model.mjs';
import {sdpView} from '../lib/stream-cache.mjs';
import {fixtureState, fixtureNmosState} from './crosspoint-fixture.mjs';

test('engine devices become source/destination groups with positional content keys and engine flow ids as endpoints', () => {
  const {groups, devices, aliasSets} = inventoryOf(fixtureState());
  assert.deepEqual(aliasSets, []);
  const camera = groups.find(g => g.id === 'src:nmosgrp_cam1');
  assert.equal(camera.side, 'source'); assert.equal(camera.name, 'Camera One'); assert.equal(camera.system, 'CAM 1'); assert.equal(camera.type, 'Natural group');
  assert.match(camera.description, /Alias: Camera One/);
  assert.deepEqual(camera.levels.map(l => l.key), ['video-1', 'audio-1', 'audio-2', 'data-1']);
  assert.deepEqual(camera.levels.map(l => l.id), ['nmos_cam1-v', 'nmos_cam1-a1', 'nmos_cam1-a2', 'nmos_cam1-anc'], 'audio levels follow engine order, not insertion order');
  assert.deepEqual(camera.levels.map(l => l.kind), ['video', 'audio', 'audio', 'data']);
  assert.equal(camera.levels[0].network.legs.length, 2); assert.equal(camera.levels[0].network.legs[1].multicast, '239.30.2.1'); assert.equal(camera.levels[0].network.transport, 'rtp');
  assert.ok(!groups.some(g => g.id === 'dst:nmosgrp_cam1'), 'a sender-only device has no destination group');
  const monitor = groups.find(g => g.id === 'dst:nmos_mon1');
  assert.equal(monitor.side, 'destination'); assert.equal(monitor.type, 'ST 2110');
  assert.deepEqual(monitor.levels.map(l => l.key), ['video-1', 'audio-1', 'audio-2', 'audio-3', 'audio-4']);
  assert.equal(monitor.levels[0].connectedSenderLabel, 'Camera One / CAM 1 Video');
  assert.deepEqual(monitor.monitor, {worst: 3, count: 1});
  assert.equal(monitor.levels[4].monitor.status, 3);
  const gateway = groups.filter(g => g.deviceId === 'nmos_gw1');
  assert.deepEqual(gateway.map(g => g.side).sort(), ['destination', 'source'], 'a device with both directions yields two groups');
  assert.deepEqual(gateway.find(g => g.side === 'destination').levels.map(l => l.id), ['nmos_gw1-rv'], 'hidden flows are omitted');
  assert.ok(!groups.some(g => g.deviceId === 'nmos_hidden'), 'hidden devices are omitted');
  assert.equal(inventoryOf(fixtureState(), {includeHidden: true}).groups.some(g => g.deviceId === 'nmos_hidden'), true);
  assert.equal(groups.find(g => g.deviceId === 'nmos_virtual').type, 'Virtual sender');
  assert.equal(groups.find(g => g.deviceId === 'nmos_mxl').type, 'MXL');
  assert.deepEqual(devices.map(d => d.id), ['nmosgrp_cam1', 'nmos_mon1', 'nmos_gw1', 'nmos_virtual', 'nmos_mxl']);
  const ids = groups.flatMap(g => g.levels.map(l => l.id));
  assert.equal(new Set(ids).size, ids.length, 'every flow appears in exactly one group');
});

test('routes come from receiver connectedFlow and never reference hidden endpoints', () => {
  const state = fixtureState();
  assert.equal(routesOf(state).length, 3);
  const {routes} = inventoryOf(state);
  assert.deepEqual(routes.map(r => [r.from, r.to]), [['nmos_cam1-v', 'nmos_mon1-v'], ['nmos_cam1-a1', 'nmos_mon1-a1'], ['nmos_cam1-a2', 'nmos_mon1-a2']]);
  assert.ok(routes.every(r => r.locked === false && r.rev === null));
  assert.equal(routes[0].health, 1);
});

test('Route Desk planners work on adapted groups: full take, breakaway, missing-level policy and disconnect', () => {
  const {groups, routes} = inventoryOf(fixtureState());
  const camera = 'src:nmosgrp_cam1', monitor = 'dst:nmos_mon1';
  const full = planRoute(groups, routes, {sourceId: camera, destinationId: monitor});
  assert.deepEqual(full.map(e => [e.from, e.to]), [['nmos_cam1-v', 'nmos_mon1-v'], ['nmos_cam1-a1', 'nmos_mon1-a1'], ['nmos_cam1-a2', 'nmos_mon1-a2']], 'only matching content keys route');
  assert.ok(full.every(e => !e.groupParent), 'partial matches do not claim the whole group');
  const missing = planMissingDisconnect(groups, routes, {sourceId: camera, destinationId: monitor});
  assert.deepEqual(missing, [], 'audio-3/4 are not routed, so nothing to disconnect');
  const breakaway = planRoute(groups, routes, {sourceId: 'src:nmos_gw1', destinationId: monitor, levelKey: 'video-1'});
  assert.deepEqual(breakaway.map(e => [e.from, e.to]), [['nmos_gw1-v', 'nmos_mon1-v']]);
  // A device's sender and receiver are distinct flows: looping a gateway onto itself is a legitimate NMOS route.
  assert.deepEqual(planRoute(groups, routes, {sourceId: 'src:nmos_gw1', destinationId: 'dst:nmos_gw1'}).map(e => [e.from, e.to]), [['nmos_gw1-v', 'nmos_gw1-rv']]);
  const disconnect = planDisconnect(groups, routes, {groupId: monitor, levelKey: 'audio-2'});
  assert.deepEqual(disconnect.map(r => r.to), ['nmos_mon1-a2']);
  assert.equal(planDisconnect(groups, routes, {groupId: camera}).length, 3, 'source-side disconnect fans out to every destination');
});

test('SDP view reads the engine manifest cache for senders, the connected sender for receivers, and never synthesizes', () => {
  const state = fixtureState(), {groups, routes} = inventoryOf(state), cache = sdpCacheOf(state, fixtureNmosState);
  const source = sdpView(groups, routes, cache, {groupId: 'src:nmosgrp_cam1', levelKey: 'video-1', view: 'source'});
  assert.match(source.blocks[0].sdp, /s=CAM 1 Video/);
  assert.equal(sdpView(groups, routes, cache, {groupId: 'src:nmosgrp_cam1', levelKey: 'audio-1', view: 'source'}).blocks[0].error, 'No SDP is cached for this sender');
  const route = sdpView(groups, routes, cache, {groupId: 'dst:nmos_mon1', levelKey: 'video-1', view: 'route'});
  assert.deepEqual(route.blocks.map(b => b.role), ['Source', 'Destination']); assert.match(route.blocks[1].sdp, /s=CAM 1 Video/);
  assert.equal(sdpView(groups, routes, cache, {groupId: 'dst:nmos_mon1', levelKey: 'audio-3', view: 'destination'}).blocks[0].error, 'Receiver has no connected sender');
  assert.match(sdpView(groups, routes, cache, {groupId: 'src:nmos_virtual', view: 'source'}).blocks[0].sdp, /m=audio/);
});
