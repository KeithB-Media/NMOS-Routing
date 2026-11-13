// In-process bootstrap of the vendored nmos-crosspoint engine
// (packages/crosspoint-engine, MIT © Johannes Grieb).
//
// This replaces the upstream server.ts composition root. The engine's lib/
// is used as-is (plus the marked patches in UPSTREAM-PATCHES.md): we
// construct the same singletons in the same order and wire the same
// cross-service hooks, skipping only what belonged to the Svelte UI (Express
// SPA, websocket sync server, auth users). The services that upstream hung
// off its websocket server (probe gateway upgrade path, virtual node routes)
// are exposed here for route-server to mount on its own HTTP server.
//
// The engine addresses its files relative to the process cwd
// ("./config/settings.json", "./state/*.json"), so the process is moved
// into a dedicated engine directory. Route Desk itself only uses absolute
// paths, so this is safe.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mkdir, readFile, writeFile, access} from 'node:fs/promises';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const enginePackage = path.join(root, 'packages', 'crosspoint-engine');

export const defaultSettingsPath = path.join(enginePackage, 'config.default', 'settings.json');

async function exists(file) { try { await access(file); return true; } catch { return false; } }

/** Create config/, state/, log/ and seed settings.json from the vendored defaults. */
export async function prepareEngineDir(dir, {registry, port} = {}) {
  await Promise.all(['config', 'state', 'log'].map(name => mkdir(path.join(dir, name), {recursive: true})));
  const settingsFile = path.join(dir, 'config', 'settings.json');
  if (!await exists(settingsFile)) {
    const defaults = JSON.parse(await readFile(defaultSettingsPath, 'utf8'));
    defaults.logOutput = false; // the engine log is read through SyncLog, not written to ./log
    if (registry) defaults.staticNmosRegistries = [{ip: registry, port: port || 80, priority: 10, domain: ''}];
    await writeFile(settingsFile, JSON.stringify(defaults, null, 4));
  }
  return settingsFile;
}

function load(name) { return require(path.join(enginePackage, 'dist', 'lib', name)); }

/**
 * Start the engine. Returns a handle with the live crosspoint state, the
 * registry connector and command methods used by route-server.
 *
 * @param {object} options
 * @param {string} options.dir        engine data directory (config/, state/)
 * @param {string} [options.registry] static registry IP seeded into a fresh settings.json
 * @param {number} [options.registryPort]
 * @param {number} [options.port]     HTTP port the virtual NMOS node is served on (route-server's port)
 * @param {string} [options.host]
 * @param {boolean} [options.consoleLog] mirror engine log to the console (default false)
 */
export async function startEngine({dir, registry, registryPort, port = 8194, host = '0.0.0.0', consoleLog = false}) {
  if (!await exists(path.join(enginePackage, 'dist', 'lib', 'crosspointAbstraction.js'))) {
    throw new Error('Engine is not built. Run `npm run build` first.');
  }
  await prepareEngineDir(dir, {registry, port: registryPort});
  const previousCwd = process.cwd();
  process.chdir(dir);

  const {SyncLog} = load('syncLog');
  const {parseSettings} = load('parseSettings');
  const {MdnsService} = load('mdnsService');
  const {CrosspointAbstraction} = load('crosspointAbstraction');
  const {NmosRegistryConnector} = load('nmosConnector');
  const {MulticastLeaseManager} = load('multicastLeaseManager');
  const {DdnsService} = load('ddnsService');
  const {Bcp008Monitor} = load('bcp008Monitor');
  const {AudioMonitorService} = load('audioMonitor');
  const {ProbeGateway} = load('probeGateway');
  const {WebsocketSyncServer} = load('SyncServer/websocketSyncServer');
  const {NmosNodeApi} = load('NmosNode/NmosNodeApi');
  const {NmosNodeRegistration} = load('NmosNode/NmosNodeRegistration');

  const log = new SyncLog();
  SyncLog.consoleDebug = !!consoleLog;
  SyncLog.log('info', 'Process', 'NMOS Routing engine startup.');

  const settingsFile = path.join(dir, 'config', 'settings.json');
  const raw = await readFile(settingsFile, 'utf8');
  const settings = parseSettings(JSON.parse(raw));
  settings.logOutput = false;
  // The virtual NMOS node advertises manifest/connection URLs on OUR server.
  if (!settings.server || typeof settings.server !== 'object') settings.server = {};
  settings.server.port = port;
  settings.server.address = host;
  const serialised = JSON.stringify(settings, null, 4);
  if (serialised !== raw) await writeFile(settingsFile, serialised); // persist minted ids (probe token, virtual sender uuids)

  // Upstream services register websocket upgrade paths on the sync server
  // singleton. We never start that server; a stub collects the paths so
  // route-server can serve them from its own HTTP server.
  const upgradePaths = {};
  if (!WebsocketSyncServer.getInstance()) WebsocketSyncServer.instance = {addUpgradePath(p, handler) { upgradePaths[p] = handler; }};

  const mdns = new MdnsService(settings);
  const nodeApi = new NmosNodeApi(settings);
  const crosspoint = new CrosspointAbstraction(settings);
  const nmos = new NmosRegistryConnector(settings);
  const leases = new MulticastLeaseManager(settings);
  const ddns = new DdnsService();
  try { ddns.setSettings(settings.ddns); } catch {}
  const audioMonitor = new AudioMonitorService();
  const probe = new ProbeGateway(typeof settings.probe?.token === 'string' ? settings.probe.token : '');
  const nodeRegistration = new NmosNodeRegistration(settings);

  // Same cross-service wiring as upstream server.ts.
  leases.setExternalIpsProvider(excludeSenderId => {
    try { return NmosRegistryConnector.instance.getActiveSenderIps(excludeSenderId); } catch { return new Set(); }
  });
  const stateListeners = new Set();
  const leaseListeners = new Set();
  crosspoint.onStateUpdated = () => { for (const fn of stateListeners) { try { fn(); } catch {} } };
  leases.setOnChange(() => { for (const fn of leaseListeners) { try { fn(); } catch {} } });

  // Virtual node: register after the registry subscriptions had a moment to
  // come up, and re-register whenever the registry is switched.
  const registerTimer = setTimeout(async () => {
    try { await nodeApi.detectAdvertiseHostAsync(); } catch {}
    try { await nodeRegistration.start(); } catch (e) { SyncLog.log('error', 'NMOS Node', 'Initial registration failed: ' + (e?.message || e)); }
  }, 2000);
  registerTimer.unref();
  const originalReconnect = nmos.reconnectStaticRegistries.bind(nmos);
  nmos.reconnectStaticRegistries = async function () {
    try { await nodeRegistration.stop(); } catch {}
    originalReconnect();
    const t = setTimeout(async () => {
      try { nodeApi.setSettings(settings); await nodeApi.detectAdvertiseHostAsync(); } catch {}
      try { await nodeRegistration.start(); } catch (e) { SyncLog.log('error', 'NMOS Node', 'Re-registration on new registry failed: ' + (e?.message || e)); }
    }, 2000);
    t.unref();
  };
  crosspoint.onVirtualSendersChange = () => {
    try { nodeApi.setSettings(settings); nodeRegistration.setSettings(settings); nodeRegistration.syncResources().catch(() => {}); } catch {}
  };

  const findFlow = (id, direction) => {
    for (const device of crosspoint.crosspointState.devices || []) {
      for (const list of Object.values(device[direction] || {})) {
        const flow = list.find(f => f.id === id);
        if (flow) return {flow, device};
      }
    }
    return null;
  };

  /** Normalise the engine's {status, detail} rejections into Errors. */
  const unwrap = async promise => {
    try { return await promise; }
    catch (e) {
      if (e instanceof Error) throw e;
      throw new Error(e?.detail?.message || e?.message || e?.status || 'Engine command failed');
    }
  };

  let closed = false;
  return {
    settings,
    settingsFile,
    parseSettings,
    log,
    crosspoint,
    nmos,
    leases,
    ddns,
    bcp008: Bcp008Monitor.instance,
    audioMonitor,
    probe,
    nodeApi,
    nodeRegistration,
    /** Websocket upgrade handlers registered by engine services (e.g. "/probe"). */
    upgradePaths,
    /** Mount the virtual NMOS Node/Connection API routes on an Express-style app. */
    mountNodeApi: app => nodeApi.mount(app),
    /** Called by lib/setup.mjs after a Setup save that touched the virtual node. */
    onVirtualNodeChange({toggled, enabled, resync}) {
      try { nodeApi.setSettings(settings); nodeRegistration.setSettings(settings); } catch {}
      if (toggled) { (enabled ? nodeRegistration.start() : nodeRegistration.stop()).catch(() => {}); }
      else if (resync) nodeRegistration.syncResources().catch(() => {});
    },
    /** Enriched crosspoint state (devices → senders/receivers). */
    state: () => crosspoint.crosspointState,
    /** Raw IS-04 registry mirror (nodes, devices, senders, receivers, flows, sendersManifestDetail). */
    nmosState: () => crosspoint.nmosState,
    connectionState: () => nmos.syncConnectionState?.getState?.() ?? null,
    probeState: () => { try { return probe.syncProbes.getState(); } catch { return null; } },
    onState(fn) { stateListeners.add(fn); return () => stateListeners.delete(fn); },
    onLeases(fn) { leaseListeners.add(fn); return () => leaseListeners.delete(fn); },
    findFlow,
    /** Route one sender flow to one receiver flow (exact, no numbering heuristics). */
    connect(senderFlowId, receiverFlowId) {
      const src = findFlow(senderFlowId, 'senders'), dst = findFlow(receiverFlowId, 'receivers');
      if (!src) throw new Error('Sender is no longer available. Refresh the inventory.');
      if (!dst) throw new Error('Receiver is no longer available. Refresh the inventory.');
      return unwrap(crosspoint.executeConnection(src.flow, dst.flow));
    },
    disconnect(receiverFlowId) {
      const dst = findFlow(receiverFlowId, 'receivers');
      if (!dst) throw new Error('Receiver is no longer available. Refresh the inventory.');
      return unwrap(crosspoint.executeConnection(null, dst.flow));
    },
    changeAlias: (id, alias) => unwrap(crosspoint.changeAlias(id, alias)),
    toggleHidden: id => unwrap(crosspoint.toggleHidden(id)),
    enableSender: (id, enable = true) => unwrap(crosspoint.enableFlow(id, !enable)),
    enableReceiver: (id, enable = true) => unwrap(crosspoint.enableReceiver(id, !enable)),
    setMulticast: (id, data) => unwrap(crosspoint.setMulticast(id, data)),
    flowInfo: id => crosspoint.getFlowInfo(id),
    senderSdp(id) {
      const nmosId = id.startsWith('nmos_') ? id.slice(5) : id;
      const sdp = crosspoint.nmosState?.sendersManifestDetail?.[nmosId]?._RAWSDP;
      if (typeof sdp === 'string' && sdp) return sdp;
      const virtual = findFlow(id.startsWith('nmos_') ? id : 'nmos_' + id, 'senders');
      if (typeof virtual?.flow?.sdp === 'string' && virtual.flow.sdp) return virtual.flow.sdp;
      // Virtual senders are defined locally; their SDP is known even before the registry mirrors our node.
      const defined = (settings.virtualSenders || []).find(v => v.senderId === nmosId);
      return typeof defined?.sdp === 'string' && defined.sdp ? defined.sdp : null;
    },
    async close() {
      if (closed) return; closed = true;
      clearTimeout(registerTimer);
      try { await audioMonitor.shutdownAll(); } catch {}
      try { await nodeRegistration.stop(); } catch {}
      try { Bcp008Monitor.instance?.setEnabled(false); } catch {}
      try { nmos.disconnectAllRegistries?.(); } catch {}
      // Discovery/sync timers are not cleared by disconnectAllRegistries.
      for (const key of ['dnssdQueryInterval', 'mdnsQueryInterval', 'syncNmosTimer', 'updateCrosspointTimer', 'connectionStateTimer', 'updateNewNmosItemTimer']) {
        try { clearInterval(nmos[key]); clearTimeout(nmos[key]); nmos[key] = null; } catch {}
      }
      try { mdns.mdns?.destroy?.(); } catch {}
      // The engine restarts its worker whenever it exits non-zero, and
      // terminate() reports code 1. Disarm the restart before terminating.
      crosspoint.startWorker = () => {};
      try { await crosspoint.worker?.terminate(); } catch {}
      try { process.chdir(previousCwd); } catch {}
    },
  };
}
