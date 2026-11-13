import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setupState, mergeSetup, applySetup, leaseSnapshot, dnsPushNodes} from '../lib/setup.mjs';
import {createRouteDesk} from '../route-server.mjs';
import {defaultSettingsPath} from '../lib/engine.mjs';

async function demoBackend() { return {settings: JSON.parse(await readFile(defaultSettingsPath, 'utf8')), settingsFile: null, leases: null, nmosState: () => ({}), state: () => ({devices: []})}; }

test('setup state never exposes the TSIG secret and reports defaults', async () => {
  const backend = await demoBackend();
  backend.settings.ddns = {enabled: true, server: '10.0.0.53', keySecret: 'c2VjcmV0', keyName: 'k'};
  const state = setupState(backend);
  assert.equal(state.ddns.keySecret, ''); assert.equal(state.ddns.keySecretSet, true); assert.equal(state.ddns.port, 53);
  assert.equal(state.registry.port, 80); assert.equal(state.bcp008.enabled, true); assert.equal(state.autoMulticast.enabled, false);
  assert.ok(!JSON.stringify(state).includes('c2VjcmV0'));
});

test('merge validates and normalises form input', async () => {
  const backend = await demoBackend();
  const next = mergeSetup(setupState(backend), {registry: {ip: ' 10.1.1.10 ', port: '8010'}, registryDiscovery: {domain: 'media.example.net.'}, acceptableGmid: 'aa-bb', multicastRange: '239.40.0.0/16', autoMulticast: {enabled: true, adoptOnEnable: true}, ddns: {keyAlgorithm: 'rot13', ttl: '60', zone: 'z.'}, vendorProfiles: [{name: 'X', labels: 'x', protocol: 'ftp', port: '0', path: 'ui'}], virtualSenders: [{name: ' Tone ', sdp: 'v=0'}]});
  assert.deepEqual(next.registry, {ip: '10.1.1.10', port: 8010}); assert.equal(next.registryDiscovery.domain, 'media.example.net'); assert.equal(next.acceptableGmid, 'AA-BB');
  assert.equal(next.autoMulticast.enabled, true); assert.equal(next.adoptOnEnable, true);
  assert.equal(next.ddns.keyAlgorithm, 'hmac-sha256', 'unknown algorithms are ignored'); assert.equal(next.ddns.ttl, 60); assert.equal(next.ddns.zone, 'z');
  assert.deepEqual(next.vendorProfiles.map(v => [v.protocol, v.port, v.path]), [['http', 80, '/ui']]);
  assert.equal(next.virtualSenders[0].name, 'Tone'); assert.match(next.virtualSenders[0].id, /^vs_/); assert.equal(next.virtualSendersChanged, true);
  assert.throws(() => mergeSetup(setupState(backend), {multicastRange: 'not-a-cidr'}), /CIDR/);
});

test('apply mutates the shared settings object in place, keeps an unchanged secret, and reports what changed', async () => {
  const backend = await demoBackend();
  const settings = backend.settings;
  settings.ddns = {enabled: false, keySecret: 'old-secret'};
  const calls = [];
  backend.leases = {setSettings: () => calls.push('leases'), getStats: () => ({pool: {used: 0, total: 0}}), getAllLeases: () => ({})};
  backend.ddns = {setSettings: s => calls.push('ddns:' + s.keySecret), syncAll: async () => calls.push('syncAll'), getPushedEntries: () => []};
  backend.bcp008 = {setEnabled: v => calls.push('bcp008:' + v)};
  backend.nmos = {reconnectStaticRegistries: () => calls.push('reconnect'), sweepAllSenders: () => calls.push('sweep'), adoptCurrentSenderIPs: () => calls.push('adopt')};
  const result = await applySetup(backend, {registry: {ip: '10.1.1.10', port: 80}, ddns: {enabled: true, server: '10.0.0.53', keySecret: ''}, bcp008: {enabled: false}, autoMulticast: {enabled: true, adoptOnEnable: true}});
  assert.equal(settings.staticNmosRegistries[0].ip, '10.1.1.10'); assert.equal(settings.ddns.keySecret, 'old-secret', 'empty secret keeps the stored one');
  assert.equal(settings.bcp008.enabled, false); assert.equal(settings.autoMulticast.enabled, true);
  assert.deepEqual(calls, ['leases', 'ddns:old-secret', 'bcp008:false', 'adopt', 'reconnect']);
  assert.deepEqual(result.changed, ['bcp008', 'leases adopted', 'registry']);
  assert.equal(result.config.ddns.keySecret, '');
  const second = await applySetup(backend, {ddns: {keySecret: 'new-secret'}, autoMulticast: {enabled: true, adoptOnEnable: false}, multicastRange: '239.50.0.0/16'});
  assert.equal(settings.ddns.keySecret, 'new-secret'); assert.deepEqual(second.changed, ['leases renewed']);
});

test('lease snapshot and DNS push nodes derive from engine state', () => {
  const backend = {
    leases: {getAllLeases: () => ({s1: {primaryIp: '239.30.0.1', secondaryIp: '239.30.0.2'}, s2: {primaryIp: '239.30.0.3'}}), getStats: () => ({pool: {used: 2, total: 100}})},
    nmosState: () => ({senders: {s1: {subscription: {active: true}, device_id: 'd1'}}, devices: {d1: {node_id: 'n1'}}, nodes: {n1: {label: 'Camera', href: 'http://10.1.0.5:80/'}, n2: {label: 'Nameless'}}}),
    state: () => ({devices: [{id: 'nmos_d1', name: 'Camera', alias: 'CAM 1', senders: {video: [{id: 'nmos_s1', bitrate: {v: 2650}}]}}]}),
  };
  const snap = leaseSnapshot(backend);
  assert.equal(snap.leases.s1.liveStatus, 'active'); assert.equal(snap.leases.s1.bitrate.v, 2650); assert.equal(snap.leases.s2.liveStatus, 'missing');
  assert.deepEqual(dnsPushNodes(backend), [{nodeId: 'n1', displayName: 'CAM 1', ip: '10.1.0.5'}]);
});

test('demo server serves and applies setup in memory; secrets never round-trip', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'setup-'));
  const app = await createRouteDesk({env: {PORT: '0', ROUTING_MODE: 'demo', DATA_DIR: dataDir}});
  t.after(async () => { await app.close(); await rm(dataDir, {recursive: true, force: true}); });
  const get = async url => (await fetch(app.url + url)).json();
  const post = async (url, data) => { const r = await fetch(app.url + url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)}); return {status: r.status, body: await r.json()}; };
  const initial = await get('/api/setup');
  assert.equal(initial.config.registry.ip, ''); assert.equal(initial.config.settingsFile, null); assert.deepEqual(initial.leases.leases, {});
  const saved = await post('/api/setup', {acceptableGmid: 'aa-bb-cc', ddns: {enabled: true, server: 'dns.local', keySecret: 'top-secret'}});
  assert.equal(saved.status, 200); assert.equal(saved.body.config.acceptableGmid, 'AA-BB-CC'); assert.equal(saved.body.config.ddns.keySecretSet, true); assert.ok(!JSON.stringify(saved.body).includes('top-secret'));
  assert.equal((await get('/api/setup')).config.ddns.server, 'dns.local');
  assert.equal((await post('/api/setup', {multicastRange: 'bad'})).status, 400);
  assert.equal((await post('/api/leases/release', {all: true})).status, 400, 'no lease manager in demo mode');
  assert.ok((await get('/api/inventory')).metadata.activity.some(a => a.type === 'setup'));
});
