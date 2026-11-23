// BCP-004-01 Receiver Capabilities evaluation and its use for MXL (BCP-007-03).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCaps, checkConstraint, compareRational, senderParams, colorSampling, CAP} from '../public/caps.js';
import {routeCompatibility} from '../public/route-options.js';
import {planRoute, mxlCapsCheck} from '../lib/model.mjs';
import {inventoryOf} from '../lib/nmos-model.mjs';
import {demoState} from '../lib/demo-state.mjs';
import {createRouteDesk} from '../route-server.mjs';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const hd50 = {[CAP.mediaType]: 'video/v210', [CAP.frameWidth]: 1920, [CAP.frameHeight]: 1080, [CAP.grainRate]: {numerator: 50, denominator: 1}, [CAP.interlaceMode]: 'progressive'};

test('rationals compare by cross-multiplication with a default denominator of 1', () => {
  assert.equal(compareRational({numerator: 50}, {numerator: 100, denominator: 2}), 0);
  assert(compareRational({numerator: 60000, denominator: 1001}, {numerator: 60}) < 0);
  assert(compareRational({numerator: 30000, denominator: 1001}, {numerator: 29}) > 0);
  assert.equal(checkConstraint(CAP.grainRate, {enum: [{numerator: 50}]}, {numerator: 50, denominator: 1}).ok, true);
  assert.equal(checkConstraint(CAP.grainRate, {minimum: {numerator: 25}, maximum: {numerator: 60}}, {numerator: 60000, denominator: 1001}).ok, true);
  assert.match(checkConstraint(CAP.grainRate, {maximum: {numerator: 30}}, {numerator: 50}).why, /50 > maximum 30/);
  assert.equal(checkConstraint(CAP.grainRate, {enum: [{numerator: 50}]}, 50).ok, false, 'a non-rational value never matches a rational constraint');
});

test('enum, minimum and maximum are inclusive and all keywords must hold', () => {
  assert.equal(checkConstraint(CAP.channelCount, {minimum: 2, maximum: 16}, 2).ok, true);
  assert.equal(checkConstraint(CAP.channelCount, {minimum: 2, maximum: 16}, 16).ok, true);
  assert.equal(checkConstraint(CAP.channelCount, {minimum: 2, maximum: 16}, 17).ok, false);
  assert.equal(checkConstraint(CAP.channelCount, {enum: [2, 8, 16], maximum: 8}, 16).ok, false);
  assert.equal(checkConstraint(CAP.interlaceMode, {}, 'progressive').ok, true, 'no keywords means unconstrained');
});

test('constraint sets: OR across sets, AND within a set; absent means unconstrained, empty means nothing matches', () => {
  const sets = [{[CAP.frameWidth]: {enum: [3840]}}, {[CAP.frameWidth]: {enum: [1920]}, [CAP.frameHeight]: {enum: [1080]}}];
  const ok = evaluateCaps({constraint_sets: sets}, hd50);
  assert.equal(ok.ok, true); assert.equal(ok.matchedSet, 1); assert.deepEqual(ok.sets.map(s => s.ok), [false, true]);
  assert.equal(evaluateCaps({constraint_sets: [{[CAP.frameWidth]: {enum: [1920]}, [CAP.frameHeight]: {enum: [720]}}]}, hd50).ok, false, 'one failing constraint fails its set');
  assert.deepEqual(evaluateCaps({}, hd50), {ok: true, evaluated: false, reason: '', mediaTypes: null, sets: [], matchedSet: null});
  const empty = evaluateCaps({constraint_sets: []}, hd50); assert.equal(empty.ok, false); assert.match(empty.reason, /empty constraint_sets/);
});

test('meta: disabled sets are not considered; preference picks the matched set; labels name the closest set in the reason', () => {
  const caps = {constraint_sets: [
    {'urn:x-nmos:cap:meta:label': 'UHD', 'urn:x-nmos:cap:meta:enabled': false, [CAP.frameWidth]: {enum: [1920]}},
    {'urn:x-nmos:cap:meta:label': 'Low', 'urn:x-nmos:cap:meta:preference': -10, [CAP.frameWidth]: {enum: [1920]}},
    {'urn:x-nmos:cap:meta:label': 'High', 'urn:x-nmos:cap:meta:preference': 50, [CAP.frameHeight]: {enum: [1080]}},
  ]};
  const r = evaluateCaps(caps, hd50);
  assert.equal(r.ok, true); assert.equal(r.matchedSet, 2, 'highest preference wins'); assert.equal(r.sets[0].enabled, false); assert.equal(r.sets[0].ok, false);
  assert.match(evaluateCaps({constraint_sets: [caps.constraint_sets[0]]}, hd50).reason, /every constraint set is disabled/);
  const miss = evaluateCaps({constraint_sets: [{'urn:x-nmos:cap:meta:label': 'A', [CAP.frameWidth]: {enum: [1280]}, [CAP.frameHeight]: {enum: [720]}}, {'urn:x-nmos:cap:meta:label': 'B', [CAP.frameWidth]: {enum: [1920]}, [CAP.frameHeight]: {enum: [2160]}}]}, hd50);
  assert.equal(miss.reason, 'frame_height 1080 not in {2160} (closest of 2 constraint sets: B)');
});

test('unrecognised or undescribed parameters are ignored; a set with nothing evaluable is satisfied', () => {
  const r = evaluateCaps({constraint_sets: [{'urn:x-vendor:cap:magic': {enum: [1]}, [CAP.sampleRate]: {enum: [{numerator: 48000}]}}]}, hd50);
  assert.equal(r.ok, true); assert.deepEqual(r.sets[0].checked, []);
  assert.deepEqual(r.sets[0].ignored.map(i => i.why), ['unrecognised parameter', 'not described by the sender']);
});

test('media_types must match any entry and is ANDed with constraint_sets', () => {
  assert.equal(evaluateCaps({media_types: ['video/v210', 'video/v210a']}, hd50).ok, true);
  const bad = evaluateCaps({media_types: ['video/v210a'], constraint_sets: [{[CAP.frameWidth]: {enum: [1920]}}]}, hd50);
  assert.equal(bad.ok, false); assert.match(bad.reason, /media type video\/v210 not accepted/);
  assert.equal(evaluateCaps({media_types: ['video/v210a']}, {}).ok, true, 'a sender without a known media type is not judged');
});

test('sender parameters are derived from the IS-04 sender, flow and source per the Capabilities register', () => {
  const flow = {media_type: 'video/v210', grain_rate: undefined, frame_width: 1920, frame_height: 1080, interlace_mode: 'progressive', colorspace: 'BT2020', transfer_characteristic: 'HLG', components: [{name: 'Y', width: 1920, height: 1080, bit_depth: 10}, {name: 'Cb', width: 960, height: 1080, bit_depth: 10}, {name: 'Cr', width: 960, height: 1080, bit_depth: 10}]};
  const p = senderParams({bit_rate: 3000000}, flow, {grain_rate: {numerator: 50}});
  assert.deepEqual(p[CAP.grainRate], {numerator: 50}, 'grain_rate falls back to the source');
  assert.equal(p[CAP.colorSampling], 'YCbCr-4:2:2'); assert.equal(p[CAP.componentDepth], 10); assert.equal(p[CAP.transportBitRate], 3000000);
  const audio = senderParams({}, {media_type: 'audio/float32', sample_rate: {numerator: 48000}, bit_depth: 32}, {channels: [{}, {}, {}, {}]});
  assert.equal(audio[CAP.channelCount], 4); assert.equal(audio[CAP.sampleDepth], 32); assert.deepEqual(audio[CAP.sampleRate], {numerator: 48000});
  assert.equal(colorSampling([{name: 'Y', width: 1920, height: 1080}, {name: 'Cb', width: 960, height: 540}, {name: 'Cr', width: 960, height: 540}]), 'YCbCr-4:2:0');
  assert.equal(colorSampling([{name: 'R'}, {name: 'G'}, {name: 'B'}]), 'RGB');
});

test('MXL planners: incompatible flows are refused with the reason, compatible ones route, force overrides, RTP is not judged', () => {
  const st = demoState(), {groups, routes} = inventoryOf(st, {nmosState: st.nmosMirror});
  const g = id => groups.find(x => x.id === id);
  const out1 = g('src:nmos_mxl1'), out2 = g('src:nmos_mxl2'), in1 = g('dst:nmos_mxl1'), in2 = g('dst:nmos_mxl2');
  assert.equal(in1.levels[0].caps.constraint_sets.length, 3); assert.equal(out2.levels[0].params[CAP.frameWidth], 3840);
  assert.equal(routeCompatibility(out1, in1).status, 'full');
  const refused = routeCompatibility(out2, in1);
  assert.equal(refused.status, 'unavailable'); assert.equal(refused.capsMismatch.length, 2);
  assert.match(refused.reason, /Video 1 cannot consume this flow \(BCP-004-01\): frame_width 3840 not in \{1920\}/);
  assert.match(refused.reason, /Audio 1 cannot consume this flow \(BCP-004-01\): sample_rate 96000 not in \{48000\}/);
  assert.throws(() => planRoute(groups, routes, {sourceId: out2.id, destinationId: in1.id}), /BCP-004-01.*force:true/);
  assert.equal(planRoute(groups, routes, {sourceId: out2.id, destinationId: in1.id, force: true}).length, 2);
  assert.equal(routeCompatibility(out1, in2).status, 'full', 'HD is accepted by the "HD any rate" set');
  assert.equal(routeCompatibility(out2, in2).status, 'full');
  assert.equal(mxlCapsCheck(g('src:nmosgrp_cam1').levels[0], g('dst:nmosgrp_mon1').levels[0]), null, 'RTP receivers are not judged by the MXL check');
  // Without the IS-04 mirror there are no caps, so nothing is refused (cannot evaluate → do not block).
  assert.equal(routeCompatibility(...['src:nmos_mxl2', 'dst:nmos_mxl1'].map(id => inventoryOf(demoState()).groups.find(x => x.id === id))).status, 'full');
});

test('demo server refuses an incompatible MXL take with 400 and the reason, and honours force', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'caps-'));
  const app = await createRouteDesk({env: {PORT: '0', ROUTING_MODE: 'demo', DATA_DIR: dataDir}});
  t.after(async () => { await app.close(); await rm(dataDir, {recursive: true, force: true}); });
  const post = async (url, data) => { const r = await fetch(app.url + url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)}); return {status: r.status, body: await r.json()}; };
  const inventory = await (await fetch(app.url + '/api/inventory')).json();
  assert.equal(inventory.groups.find(g => g.id === 'dst:nmos_mxl1').levels[0].caps.media_types[0], 'video/v210');
  assert.equal((await fetch(app.url + '/caps.js')).status, 200, 'the browser loads the shared evaluator');
  const refused = await post('/api/route', {sourceId: 'src:nmos_mxl2', destinationId: 'dst:nmos_mxl1'});
  assert.equal(refused.status, 400); assert.match(refused.body.error, /frame_width 3840 not in \{1920\}/);
  const forced = await post('/api/route', {sourceId: 'src:nmos_mxl2', destinationId: 'dst:nmos_mxl1', force: true});
  assert.equal(forced.status, 200);
  const ok = await post('/api/route', {sourceId: 'src:nmos_mxl1', destinationId: 'dst:nmos_mxl1'});
  assert.equal(ok.status, 200); assert.equal(ok.body.routes.filter(r => r.to.startsWith('nmos_') && ok.body.groups.find(g => g.id === 'dst:nmos_mxl1').levels.some(l => l.id === r.to)).length, 2);
});
