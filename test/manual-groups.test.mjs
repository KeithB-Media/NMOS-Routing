import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {flowCatalog, validateManualGroup, applyManualGroups, ManualGroupStore} from '../lib/manual-groups.mjs';
import {inventoryOf} from '../lib/nmos-model.mjs';
import {planRoute} from '../lib/model.mjs';
import {fixtureState} from './crosspoint-fixture.mjs';

const state = fixtureState(), catalog = flowCatalog(state);

test('flow catalog lists every visible flow with side, kind and owning device', () => {
  assert(!catalog.some(f => f.id === 'nmos_hidden-v' || f.id === 'nmos_gw1-hidden'), 'hidden devices and flows are not offered');
  const cam = catalog.filter(f => f.deviceId === 'nmosgrp_cam1');
  assert.deepEqual(cam.map(f => [f.id, f.side, f.kind]), [['nmos_cam1-v', 'source', 'video'], ['nmos_cam1-a1', 'source', 'audio'], ['nmos_cam1-a2', 'source', 'audio'], ['nmos_cam1-anc', 'source', 'data']]);
  assert.equal(catalog.find(f => f.id === 'nmos_mon1-v').side, 'destination');
});

test('validation assigns positional keys per media type and rejects wrong sides, duplicates, unknown flows and double claims', () => {
  const group = validateManualGroup({side: 'source', name: ' Studio Mix ', levels: ['nmos_gw1-v', 'nmos_cam1-a2', 'nmos_cam1-v', {flowId: 'nmos_virt-a'}]}, catalog);
  assert.match(group.id, /^man:/); assert.equal(group.name, 'Studio Mix');
  assert.deepEqual(group.levels, [{flowId: 'nmos_gw1-v', key: 'video-1'}, {flowId: 'nmos_cam1-a2', key: 'audio-1'}, {flowId: 'nmos_cam1-v', key: 'video-2'}, {flowId: 'nmos_virt-a', key: 'audio-2'}], 'operator order is kept; keys count per type');
  assert.throws(() => validateManualGroup({side: 'source', name: 'x', levels: ['nmos_mon1-v']}, catalog), /destination flow/);
  assert.throws(() => validateManualGroup({side: 'source', name: 'x', levels: ['nmos_cam1-v', 'nmos_cam1-v']}, catalog), /only appear once/);
  assert.throws(() => validateManualGroup({side: 'source', name: 'x', levels: ['nmos_nope']}, catalog), /no longer exists/);
  assert.throws(() => validateManualGroup({side: 'source', name: '', levels: ['nmos_cam1-v']}, catalog), /name/);
  assert.throws(() => validateManualGroup({side: 'source', name: 'x', levels: []}, catalog), /between 1 and 64/);
  assert.throws(() => validateManualGroup({side: 'source', name: 'Other', levels: ['nmos_cam1-v']}, catalog, [group]), /already belongs to the manual group "Studio Mix"/);
  assert.equal(validateManualGroup({...group, name: 'Renamed'}, catalog, [group]).id, group.id, 'editing a group may keep its own flows');
});

test('manual groups overlay automatic groups: claimed flows move, emptied automatic groups vanish, routes still plan', () => {
  const manual = [validateManualGroup({side: 'source', name: 'Studio Mix', levels: ['nmos_gw1-v', 'nmos_cam1-a1', 'nmos_cam1-a2']}, catalog)];
  const base = inventoryOf(state), {groups, routes, unresolved} = applyManualGroups(base, manual);
  assert.deepEqual(unresolved, []);
  const mix = groups.find(g => g.id === manual[0].id);
  assert.equal(mix.type, 'Manual group'); assert.equal(mix.deviceId, null); assert.match(mix.description, /3 flows from 2 devices/);
  assert.deepEqual(mix.levels.map(l => [l.key, l.id, l.name, l.homeGroupName]), [['video-1', 'nmos_gw1-v', 'Video 1', 'Gateway'], ['audio-1', 'nmos_cam1-a1', 'Audio 1', 'Camera One'], ['audio-2', 'nmos_cam1-a2', 'Audio 2', 'Camera One']]);
  assert.deepEqual(groups.find(g => g.id === 'src:nmosgrp_cam1').levels.map(l => l.key), ['video-1', 'data-1'], 'claimed audio leaves the camera group; remaining keys are unchanged');
  assert.ok(!groups.some(g => g.id === 'src:nmos_gw1'), 'the gateway source group had one flow and is now empty');
  assert.ok(groups.some(g => g.id === 'dst:nmos_gw1'), 'the gateway destination group is untouched');
  assert.equal(routes.length, base.routes.length);
  const take = planRoute(groups, routes, {sourceId: mix.id, destinationId: 'dst:nmos_mon1'});
  assert.deepEqual(take.map(e => [e.from, e.to]), [['nmos_gw1-v', 'nmos_mon1-v'], ['nmos_cam1-a1', 'nmos_mon1-a1'], ['nmos_cam1-a2', 'nmos_mon1-a2']]);
  const stale = applyManualGroups(base, [{id: 'man:00000000-0000-4000-8000-000000000000', side: 'source', name: 'Gone', levels: [{flowId: 'nmos_missing', key: 'video-1'}]}]);
  assert.deepEqual(stale.unresolved.map(u => u.name), ['Gone']); assert.equal(stale.groups.length, base.groups.length);
});

test('store persists atomically and survives reload', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'manual-groups-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const store = new ManualGroupStore(path.join(dir, 'groups.json'));
  assert.deepEqual(await store.load(), []);
  const group = store.upsert({side: 'destination', name: 'Wall', levels: ['nmos_mon1-v', 'nmos_gw1-rv']}, catalog);
  await store.persist();
  const again = new ManualGroupStore(path.join(dir, 'groups.json'));
  assert.deepEqual(await again.load(), [group]);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'groups.json'), 'utf8')).groups[0].levels.map(l => l.key), ['video-1', 'video-2']);
  again.remove(group.id); assert.deepEqual(again.groups, []);
  assert.throws(() => again.remove(group.id), /no longer exists/);
});
