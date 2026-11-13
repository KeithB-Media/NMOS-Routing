// NMOS Routing server: the Route Desk operator UI driven by the
// nmos-crosspoint engine (packages/crosspoint-engine) running in-process.
//
// Modes:
//   ROUTING_MODE=live  — start the engine; inventory and routes come from the
//                        NMOS registry it discovers (or NMOS_REGISTRY), and
//                        routing issues IS-05 PATCHes through the engine.
//   ROUTING_MODE=demo  — a generated in-memory facility; no network access.
import http from 'node:http';
import {readFile, mkdir, writeFile, rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash, timingSafeEqual, randomUUID} from 'node:crypto';
import {planRoute, planDisconnect, planMissingDisconnect, validateNameChanges} from './lib/model.mjs';
import {inventoryOf, sdpCacheOf} from './lib/nmos-model.mjs';
import {ManualGroupStore, applyManualGroups, flowCatalog} from './lib/manual-groups.mjs';
import {setupState, applySetup, leaseSnapshot} from './lib/setup.mjs';
import {defaultSettingsPath} from './lib/engine.mjs';
import {demoState} from './lib/demo-state.mjs';
import {LiveHub} from './lib/live-hub.mjs';
import {sdpView} from './lib/stream-cache.mjs';
import {NmosViewer, RegistryViewer, NodeViewer, resolveApi} from './lib/nmos-viewer.mjs';

/** In-memory backend with the same command surface as lib/engine.mjs. */
function demoBackend(state) {
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) fn(); };
  const find = (id, direction) => {
    for (const device of state.devices) for (const list of Object.values(device[direction])) { const flow = list.find(f => f.id === id); if (flow) return {flow, device}; }
    return null;
  };
  return {
    mode: 'demo', state: () => state, nmosState: () => ({}), connectionState: () => ({registries: [], dnssd: {enabled: false}}),
    onState(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async connect(from, to) {
      const src = find(from, 'senders'), dst = find(to, 'receivers');
      if (!src || !dst) throw new Error('Sender or receiver is no longer available.');
      if (dst.flow.available === false) throw new Error(`${dst.flow.name} is offline.`);
      dst.flow.connectedFlow = src.flow.id; dst.flow.connectedSenderLabel = `${src.device.displayLabel} / ${src.flow.name}`; dst.flow.active = true; notify();
    },
    async disconnect(to) { const dst = find(to, 'receivers'); if (!dst) throw new Error('Receiver is no longer available.'); dst.flow.connectedFlow = ''; dst.flow.connectedSenderLabel = ''; notify(); },
    async changeAlias(id, alias) {
      const device = state.devices.find(d => d.id === id);
      if (device) { device.alias = alias; device.displayLabel = alias || device.name; notify(); return; }
      for (const direction of ['senders', 'receivers']) { const hit = find(id, direction); if (hit) { hit.flow.alias = alias || hit.flow.name; notify(); return; } }
      throw new Error('Unknown device or flow.');
    },
    async toggleHidden(id) {
      const device = state.devices.find(d => d.id === id);
      if (device) { device.hidden = !device.hidden; notify(); return; }
      for (const direction of ['senders', 'receivers']) { const hit = find(id, direction); if (hit) { hit.flow.hidden = !hit.flow.hidden; notify(); return; } }
      throw new Error('Unknown device or flow.');
    },
    async enableSender(id, enabled) { const hit = find(id, 'senders'); if (!hit) throw new Error('Unknown sender.'); hit.flow.active = enabled; notify(); },
    async enableReceiver(id, enabled) { const hit = find(id, 'receivers'); if (!hit) throw new Error('Unknown receiver.'); hit.flow.active = enabled; notify(); },
    log: {getState: () => ({logList: [], lastLogId: 0})},
    leases: null, settings: null, settingsFile: null, parseSettings: null,
    // BCP-008 stand-in: counters for flows that carry a monitor in the demo state.
    bcp008: {
      async getPacketCounters(uuid) { for (const d of ['senders', 'receivers']) { const hit = find('nmos_' + uuid, d); if (hit?.flow.monitor) return [{label: hit.flow.monitor.status >= 3 ? 'Stream' : 'Link', counters: [{name: 'packets_received', value: 123456}, {name: 'packets_lost', value: hit.flow.monitor.status >= 3 ? 4210 : 0}, {name: 'packets_late', value: 0}]}]; } return null; },
      async resetCounters(uuid) { for (const d of ['senders', 'receivers']) { const hit = find('nmos_' + uuid, d); if (hit?.flow.monitor) { hit.flow.monitor.counter = 0; for (const dom of hit.flow.monitor.domains || []) dom.counter = 0; notify(); return true; } } return false; },
    },
    async close() {},
  };
}

export async function createRouteDesk({env = process.env, readAsset} = {}) {
const root = path.dirname(fileURLToPath(import.meta.url));
readAsset ||= name => readFile(path.join(root, name));
const mode = env.ROUTING_MODE === 'live' ? 'live' : 'demo';
const dataDir = path.resolve(env.DATA_DIR || path.join(root, 'data'));
await mkdir(dataDir, {recursive: true});
const stateFile = path.join(dataDir, `${mode}-state.json`);
let saved;
try { saved = JSON.parse(await readFile(stateFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
let metadata = saved?.metadata || {tags: {}, favorites: [], tagLibrary: [], activity: []};
const manualGroups = new ManualGroupStore(path.join(dataDir, `${mode}-groups.json`));
await manualGroups.load();
const canWrite = mode === 'demo' || env.WRITE_ENABLED === 'true';
const embedAncestors = (env.EMBED_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean).map(value => {
  const origin = new URL(value);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== value) throw new Error('EMBED_ALLOWED_ORIGINS requires exact HTTP(S) origins');
  return origin.origin;
});

// ---- backend ----
let backend;
if (mode === 'live') {
  const {startEngine} = await import('./lib/engine.mjs');
  backend = await startEngine({dir: path.resolve(env.ENGINE_DIR || path.join(dataDir, 'engine')), registry: env.NMOS_REGISTRY || undefined, registryPort: Number(env.NMOS_REGISTRY_PORT) || undefined, consoleLog: env.ENGINE_LOG === 'true'});
  backend.mode = 'live';
} else {
  backend = demoBackend(demoState());
  backend.settings = JSON.parse(await readFile(defaultSettingsPath, 'utf8')); // editable in memory; demo never writes a file
}

let cache = {groups: [], routes: [], devices: [], aliasSets: [], totals: null, manualGroups: [], unresolved: []};
let revision = Date.now(), inventoryHash = '', lastSync = null, syncError = mode === 'live' ? 'Waiting for the NMOS registry' : null;
let liveHub = null, writeBusy = false, saveQueue = Promise.resolve(), refreshTimer = null, closed = false;
const stateWaiters = new Set();

function registries() { return backend.connectionState()?.registries || []; }
function connectedRegistry() { return registries().find(r => Array.isArray(r.connected) && r.connected.some(c => c.connected)) || null; }
function registryQueryUrl(registry = connectedRegistry()) {
  if (!registry) return null;
  const version = registry.connected?.find(c => c.connected)?.version || 'v1.3';
  return `http://${registry.ip}:${registry.port}/x-nmos/query/${version}/`;
}

function refresh() {
  const next = applyManualGroups(inventoryOf(backend.state(), {nmosState: backend.nmosState()}), manualGroups.groups);
  const nextHash = createHash('sha256').update(JSON.stringify(next)).digest('hex');
  const changed = nextHash !== inventoryHash;
  if (changed) { cache = next; inventoryHash = nextHash; revision++; }
  lastSync = new Date().toISOString();
  if (mode === 'live') {
    const error = connectedRegistry() ? null : (registries().length ? 'NMOS registry connection is down' : 'Waiting for the NMOS registry');
    if (error !== syncError) { syncError = error; revision++; }
  }
  for (const waiter of [...stateWaiters]) if (waiter.test()) { stateWaiters.delete(waiter); waiter.resolve(true); }
  if (changed || !liveHub) liveHub?.publish();
  return changed;
}
function scheduleRefresh() {
  if (refreshTimer || closed) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; try { refresh(); } catch (e) { syncError = e.message; revision++; liveHub?.publish(); } }, 40);
  refreshTimer.unref();
}
/** Resolve once the inventory satisfies `test`, or false after `timeout` ms. */
function waitForState(test, timeout = 2500) {
  if (test()) return Promise.resolve(true);
  return new Promise(resolve => {
    const waiter = {test, resolve};
    const timer = setTimeout(() => { stateWaiters.delete(waiter); resolve(false); }, timeout); timer.unref();
    waiter.resolve = value => { clearTimeout(timer); resolve(value); };
    stateWaiters.add(waiter);
  });
}
const unsubscribe = backend.onState(scheduleRefresh);
refresh();
// Registry connection state changes do not go through onState, and the UI
// judges freshness from lastSync, so tick every 2 s in both modes.
const statusTimer = setInterval(scheduleRefresh, 2000); statusTimer.unref();

const nmosViewer = new NmosViewer(null), registries_ = new Map();
async function viewerFor(url, nodeUrl) {
  if (nodeUrl) url = nodeUrl;
  if (!url && !nodeUrl) url = registryQueryUrl();
  if (!url) return nmosViewer;
  if (url.length > 2048) throw new Error('NMOS URL is too long');
  const key = (nodeUrl ? 'node:' : 'query:') + url;
  if (!registries_.has(key)) {
    const base = await resolveApi(url, nodeUrl ? 'node' : 'query');
    if (registries_.size >= 8) {
      const idle = [...registries_].find(([, viewer]) => !viewer.inFlight);
      if (!idle) throw new Error('NMOS connections are busy. Try again shortly.');
      registries_.delete(idle[0]);
    }
    registries_.set(key, nodeUrl ? new NodeViewer(base) : new RegistryViewer(base));
  }
  return registries_.get(key);
}

function persist() {
  const data = JSON.stringify({metadata});
  const next = saveQueue.catch(() => {}).then(async () => { await writeFile(stateFile + '.tmp', data); await rename(stateFile + '.tmp', stateFile); });
  saveQueue = next;
  return next;
}
function logAction(type, text) {
  metadata.activity.unshift({id: randomUUID(), type, text, time: new Date().toISOString()});
  metadata.activity = metadata.activity.slice(0, 150);
}
function engineStatus() {
  const registry = connectedRegistry();
  return {mode, connected: !!registry, registry: registry ? {ip: registry.ip, port: registry.port, source: registry.source, priority: registry.priority, domain: registry.domain || ''} : null, registries: registries().map(r => ({ip: r.ip, port: r.port, source: r.source, priority: r.priority, connected: (r.connected || []).filter(c => c.connected).length})), totals: cache.totals, leases: backend.leases ? backend.leases.getStats() : null};
}
function snapshot() {
  return {...cache, metadata, mode, desktop: false, controllerUrl: registryQueryUrl(), canWrite, ephemeralState: env.EPHEMERAL_STATE === 'true', syncSeconds: 2, stream: {controller: 'live', reconciliationSeconds: 2}, engine: engineStatus(), lastSync, error: syncError, revision};
}
function send(res, status, value, headers = {}) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers});
  res.end(JSON.stringify(value));
}
async function body(req, limit = 32768) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > limit) throw new Error('Request too large'); }
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON request'); }
}
function authenticated(req) {
  if (!env.UI_PASSWORD) return true;
  const wanted = Buffer.from('Basic ' + Buffer.from(`${env.UI_USERNAME || 'operator'}:${env.UI_PASSWORD}`).toString('base64'));
  const got = Buffer.from(req.headers.authorization || '');
  return got.length === wanted.length && timingSafeEqual(got, wanted);
}
function requireWrite(res) {
  if (!canWrite) { send(res, 403, {error: 'Routing is read-only. Set WRITE_ENABLED=true on the server.'}); return false; }
  if (writeBusy) { send(res, 409, {error: 'Another change is being applied. Please try again.'}); return false; }
  if (mode === 'live' && syncError) { send(res, 409, {error: 'The NMOS registry is not connected. Wait for a connection before making changes.'}); return false; }
  return true;
}
/** Run engine commands; collect failures instead of stopping at the first. */
async function applyAll(jobs) {
  const results = await Promise.allSettled(jobs.map(job => job()));
  const failures = results.filter(r => r.status === 'rejected').map(r => r.reason?.message || String(r.reason));
  return failures;
}
const routed = (from, to) => cache.routes.some(r => r.from === from && r.to === to);

const files = {'/': ['index.html', 'text/html'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'], '/fonts/Lora.ttf': ['fonts/Lora.ttf', 'font/ttf'], '/fonts/CormorantGaramond.ttf': ['fonts/CormorantGaramond.ttf', 'font/ttf']};
for (const name of ['app', 'matrix', 'name-series', 'workspace', 'column-sorter', 'column-resize', 'live-updates', 'route-options', 'route-feedback', 'search', 'themes', 'nmos-viewer', 'nmos-groups', 'panels', 'panel-model', 'setup']) files['/' + name + '.js'] = [name + '.js', 'text/javascript'];
for (const name of ['style', 'themes', 'panels']) files['/' + name + '.css'] = [name + '.css', 'text/css'];
const staticCache = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([url, [name, type]]) => [url, {data: await readAsset('public/' + name), type}])));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const embed = ['/embed', '/embed/'].includes(url.pathname);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors ${embed ? ["'self'", ...embedAncestors].join(' ') : "'none'"}; base-uri 'self'`);
  if (url.pathname === '/healthz') return send(res, 200, {status: 'ok', mode, registry: !!connectedRegistry()});
  if (!authenticated(req)) return send(res, 401, {error: 'Operator login required'}, {'WWW-Authenticate': 'Basic realm="NMOS Routing"'});
  const crossSite = req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host);
  try {
    if (['/api/nmos', '/api/nmos/detail'].includes(url.pathname)) {
      if (req.method !== 'GET') return send(res, 404, {error: 'Not found'});
      if (crossSite) return send(res, 403, {error: 'Open the NMOS viewer in NMOS Routing to connect.'});
      const viewer = await viewerFor(url.searchParams.get('registry'), url.searchParams.get('nodeUrl'));
      return send(res, 200, url.pathname === '/api/nmos' ? {...await viewer.inventory(), engineRegistry: registryQueryUrl(), groupCreationAvailable: false, canCreateGroups: false} : await viewer.detail(url.searchParams.get('node'), url.searchParams.get('type'), url.searchParams.get('id')));
    }
    if (req.method === 'GET' && url.pathname === '/api/sdp') return send(res, 200, sdpView(cache.groups, cache.routes, sdpCacheOf(backend.state(), backend.nmosState()), {groupId: url.searchParams.get('groupId'), levelKey: url.searchParams.get('levelKey') || undefined, view: url.searchParams.get('view'), side: url.searchParams.get('side')}));
    if (req.method === 'GET' && url.pathname === '/api/setup') return send(res, 200, {config: setupState(backend), leases: leaseSnapshot(backend), detectedDevices: backend.state()?.detectedDevices || [], dnsPushed: backend.ddns ? backend.ddns.getPushedEntries() : [], registries: registries(), dnssd: backend.connectionState()?.dnssd || null});
    if (req.method === 'GET' && url.pathname === '/api/leases/export') return send(res, 200, backend.leases ? backend.leases.exportLeases() : {version: 1, leases: {}});
    if (req.method === 'GET' && url.pathname === '/api/groups') return send(res, 200, {groups: manualGroups.groups, unresolved: cache.unresolved, catalog: flowCatalog(backend.state())});
    if (req.method === 'GET' && url.pathname === '/api/engine') {
      const after = Number(url.searchParams.get('after') || 0), log = backend.log?.getState?.()?.logList || [];
      return send(res, 200, {...engineStatus(), connection: backend.connectionState(), log: log.filter(l => l.id > after).slice(-200).map(({id, time, severity, topic, text}) => ({id, time, severity, topic, text}))});
    }
    if (req.method === 'GET' && url.pathname === '/api/inventory') {
      const etag = '"' + revision + '"';
      const headers = {'ETag': etag, 'X-Last-Sync': lastSync || '', 'X-Sync-Error': encodeURIComponent(syncError || '')};
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, {...headers, 'Cache-Control': 'no-cache'}); return res.end(); }
      return send(res, 200, snapshot(), headers);
    }
    if (req.method === 'GET' && (files[url.pathname] || embed)) { const f = staticCache[embed ? '/' : url.pathname]; res.writeHead(200, {'Content-Type': f.type + '; charset=utf-8', 'Cache-Control': 'no-cache'}); return res.end(f.data); }
    if (req.method !== 'POST') return send(res, 404, {error: 'Not found'});
    if (crossSite) return send(res, 403, {error: 'Cross-origin writes are not allowed'});
    if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, {error: 'JSON required'});
    if (url.pathname === '/api/sync') { refresh(); return send(res, 200, snapshot()); }
    const data = await body(req, url.pathname === '/api/names' ? 512 * 1024 : 32768);

    if (['/api/name', '/api/names'].includes(url.pathname)) {
      if (!requireWrite(res)) return;
      const changes = validateNameChanges(url.pathname === '/api/name' ? [data] : data.changes);
      if (changes[0].aliasSet) throw new Error('NMOS Routing has one operator alias per device; alias sets are not available.');
      for (const change of changes) {
        const group = cache.groups.find(g => g.id === change.groupId);
        if (!group) throw new Error('Group no longer exists. Refresh the inventory.');
        if (group.name !== change.previous) throw new Error('This name changed. Reselect the rows and try again.');
      }
      writeBusy = true;
      try {
        const failures = await applyAll(changes.map(change => () => backend.changeAlias(cache.groups.find(g => g.id === change.groupId).deviceId, change.name)));
        if (failures.length) throw new Error(failures.join(' '));
        const confirmed = await waitForState(() => changes.every(c => cache.groups.find(g => g.id === c.groupId)?.name === c.name));
        if (!confirmed) throw new Error('The engine has not confirmed every new name. Refresh before retrying.');
        logAction('name', changes.length === 1 ? `Renamed ${changes[0].previous} to ${changes[0].name}` : `Filled ${changes.length} names`);
        revision++; await persist(); liveHub?.publish(); return send(res, 200, snapshot());
      } finally { writeBusy = false; }
    }
    if (url.pathname === '/api/disconnect') {
      if (!requireWrite(res)) return;
      writeBusy = true;
      try {
        const selected = planDisconnect(cache.groups, cache.routes, data);
        const failures = await applyAll(selected.map(r => () => backend.disconnect(r.to)));
        const settled = selected.length ? await waitForState(() => selected.every(r => !routed(r.from, r.to))) : true;
        const routePending = !settled || !!failures.length;
        const group = cache.groups.find(g => g.id === data.groupId);
        logAction('route', `${routePending ? 'Requested: ' : ''}Disconnect ${group?.name || data.groupId}${data.levelKey ? ' · ' + data.levelKey : ' · all levels'}`);
        revision++; await persist(); liveHub?.publish();
        if (failures.length) return send(res, 502, {...snapshot(), error: failures.join(' '), routePending: true, disconnectedRoutes: selected.map(({from, to}) => ({from, to}))});
        return send(res, routePending ? 202 : 200, {...snapshot(), routePending, disconnectedRoutes: selected.map(({from, to}) => ({from, to}))});
      } finally { writeBusy = false; }
    }
    if (url.pathname === '/api/route') {
      if (!requireWrite(res)) return;
      writeBusy = true;
      try {
        const entries = planRoute(cache.groups, cache.routes, data);
        const removed = planMissingDisconnect(cache.groups, cache.routes, data);
        const failures = await applyAll([...entries.map(e => () => backend.connect(e.from, e.to)), ...removed.map(r => () => backend.disconnect(r.to))]);
        const settled = await waitForState(() => entries.every(e => routed(e.from, e.to)) && removed.every(r => !routed(r.from, r.to)));
        const routePending = !settled || !!failures.length;
        const source = cache.groups.find(g => g.id === data.sourceId), destination = cache.groups.find(g => g.id === data.destinationId);
        logAction('route', `${routePending ? 'Requested: ' : ''}${source?.name} → ${destination?.name}${data.levelKey ? ' · ' + data.levelKey : ' · ' + entries.length + ' matching levels'}`);
        revision++; await persist(); liveHub?.publish();
        if (failures.length) return send(res, 502, {...snapshot(), error: failures.join(' '), routePending: true, disconnectedRoutes: removed.map(({from, to}) => ({from, to}))});
        return send(res, routePending ? 202 : 200, {...snapshot(), routePending, disconnectedRoutes: removed.map(({from, to}) => ({from, to}))});
      } finally { writeBusy = false; }
    }
    if (['/api/bcp008/counters', '/api/bcp008/reset'].includes(url.pathname)) {
      if (typeof data.id !== 'string') throw new Error('Flow id required');
      const uuid = data.id.startsWith('nmos_') ? data.id.slice(5) : data.id;
      if (!backend.bcp008) return send(res, 404, {error: 'BCP-008 monitoring is not running.'});
      if (url.pathname.endsWith('/reset')) {
        if (!canWrite) return send(res, 403, {error: 'Routing is read-only. Set WRITE_ENABLED=true on the server.'});
        const ok = await backend.bcp008.resetCounters(uuid);
        if (!ok) return send(res, 404, {error: 'No BCP-008 monitor is connected for this flow.'});
        logAction('route', `Reset BCP-008 counters on ${data.id}`);
        refresh(); revision++; liveHub?.publish();
        return send(res, 200, {reset: true});
      }
      const groups = await backend.bcp008.getPacketCounters(uuid);
      if (!groups) return send(res, 404, {error: 'No BCP-008 monitor is connected for this flow.'});
      return send(res, 200, {groups});
    }
    if (url.pathname === '/api/hidden') {
      if (!requireWrite(res)) return;
      if (typeof data.id !== 'string') throw new Error('Device or flow id required');
      writeBusy = true;
      try { await backend.toggleHidden(data.id); await waitForState(() => true, 300); refresh(); logAction('tag', `Toggled visibility of ${data.id}`); revision++; await persist(); liveHub?.publish(); return send(res, 200, snapshot()); }
      finally { writeBusy = false; }
    }
    if (url.pathname === '/api/enable') {
      if (!requireWrite(res)) return;
      if (typeof data.id !== 'string' || typeof data.enabled !== 'boolean' || !['sender', 'receiver'].includes(data.direction)) throw new Error('id, direction and enabled are required');
      writeBusy = true;
      try { await (data.direction === 'sender' ? backend.enableSender(data.id, data.enabled) : backend.enableReceiver(data.id, data.enabled)); logAction('route', `${data.enabled ? 'Enabled' : 'Disabled'} ${data.direction} ${data.id}`); revision++; await persist(); liveHub?.publish(); return send(res, 202, snapshot()); }
      finally { writeBusy = false; }
    }
    if (url.pathname === '/api/setup') {
      if (!canWrite) return send(res, 403, {error: 'Settings are read-only. Set WRITE_ENABLED=true on the server.'});
      const result = await applySetup(backend, data);
      logAction('setup', 'Updated engine settings' + (result.changed.length ? ' · ' + result.changed.join(', ') : ''));
      refresh(); revision++; await persist(); liveHub?.publish();
      return send(res, 200, {...result, leases: leaseSnapshot(backend)});
    }
    if (url.pathname === '/api/leases/release') {
      if (!canWrite) return send(res, 403, {error: 'Settings are read-only. Set WRITE_ENABLED=true on the server.'});
      if (!backend.leases) throw new Error('Lease manager is not available in demo mode.');
      const ids = data.all === true ? Object.keys(backend.leases.getAllLeases()) : typeof data.senderId === 'string' && data.senderId.trim() ? [data.senderId.trim()] : [];
      if (!ids.length) throw new Error('senderId or all:true required');
      backend.leases.releaseLeases(ids);
      logAction('setup', `Released ${ids.length} multicast lease${ids.length === 1 ? '' : 's'}`);
      return send(res, 200, {released: ids.length, leases: leaseSnapshot(backend)});
    }
    if (url.pathname === '/api/leases/import') {
      if (!canWrite) return send(res, 403, {error: 'Settings are read-only. Set WRITE_ENABLED=true on the server.'});
      if (!backend.leases) throw new Error('Lease manager is not available in demo mode.');
      const result = backend.leases.importLeases(data);
      logAction('setup', `Imported ${result.imported} multicast leases`);
      return send(res, 200, {...result, leases: leaseSnapshot(backend)});
    }
    if (url.pathname === '/api/groups') {
      // Manual groups are local metadata: allowed even when device writes are off.
      const group = manualGroups.upsert(data.group, flowCatalog(backend.state()));
      await manualGroups.persist(); refresh();
      logAction('group', `${data.group?.id ? 'Updated' : 'Created'} manual group ${group.name}`);
      revision++; await persist(); liveHub?.publish(); return send(res, 200, {...snapshot(), group});
    }
    if (url.pathname === '/api/groups/delete') {
      if (typeof data.id !== 'string') throw new Error('Group id required');
      const removed = manualGroups.remove(data.id);
      await manualGroups.persist(); refresh();
      logAction('group', `Deleted manual group ${removed.name}`);
      revision++; await persist(); liveHub?.publish(); return send(res, 200, snapshot());
    }
    if (url.pathname === '/api/tags') {
      if (!cache.groups.some(g => g.id === data.id)) throw new Error('Unknown group');
      if (!Array.isArray(data.tags) || data.tags.length > 24 || data.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 48)) throw new Error('Use up to 24 tags, each 1–48 characters');
      metadata.tags[data.id] = [...new Set(data.tags.map(t => t.trim()))];
      metadata.tagLibrary = [...new Set([...metadata.tagLibrary, ...metadata.tags[data.id]])].sort();
      logAction('tag', `Updated tags on ${cache.groups.find(g => g.id === data.id).name}`);
      revision++; await persist(); liveHub?.publish(); return send(res, 200, snapshot());
    }
    if (url.pathname === '/api/favorite') {
      if (!cache.groups.some(g => g.id === data.id)) throw new Error('Unknown group');
      const set = new Set(metadata.favorites); set.has(data.id) ? set.delete(data.id) : set.add(data.id);
      metadata.favorites = [...set]; revision++; await persist(); liveHub?.publish(); return send(res, 200, snapshot());
    }
    return send(res, 404, {error: 'Not found'});
  } catch (e) { return send(res, 400, {error: e.message}); }
});
liveHub = new LiveHub(server, {authenticated, snapshot});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(env.PORT || 8194), env.HOST || '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
async function close() {
  if (closed) return; closed = true;
  clearTimeout(refreshTimer); clearInterval(statusTimer); unsubscribe(); liveHub?.close();
  for (const waiter of stateWaiters) waiter.resolve(false);
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await backend.close(); await saveQueue.catch(() => {});
}
return {server, ready: Promise.resolve(), close, snapshot, backend, url: `http://${env.HOST || '127.0.0.1'}:${server.address().port}`};
}
