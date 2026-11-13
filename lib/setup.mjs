// Setup page semantics, ported from the upstream crosspoint server.ts
// (setupConfig / releaseLease / exportLeases / importLeases). Operates on the
// engine handle from lib/engine.mjs; in demo mode on a plain settings object.
import {writeFile} from 'node:fs/promises';

const KEY_ALGORITHMS = ['hmac-sha256', 'hmac-sha512', 'hmac-sha1', 'hmac-md5', 'none'];
const CIDR = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;

/** What the Setup page may see. Secrets are never included. */
export function setupState(backend) {
  const s = backend.settings || {};
  const first = Array.isArray(s.staticNmosRegistries) && s.staticNmosRegistries[0] ? s.staticNmosRegistries[0] : {};
  const port = parseInt('' + first.port);
  const ddns = s.ddns && typeof s.ddns === 'object' ? s.ddns : {};
  const discovery = s.registryDiscovery && typeof s.registryDiscovery === 'object' ? s.registryDiscovery : {};
  const virtualNode = s.virtualNode && typeof s.virtualNode === 'object' ? s.virtualNode : {};
  return {
    registry: {ip: typeof first.ip === 'string' ? first.ip : '', port: !isNaN(port) && port > 0 && port < 65536 ? port : 80},
    registryDiscovery: {unicastDnssd: discovery.unicastDnssd !== false, domain: typeof discovery.domain === 'string' ? discovery.domain : ''},
    acceptableGmid: typeof s.acceptableGmid === 'string' ? s.acceptableGmid : '',
    vendorProfiles: Array.isArray(s.vendorProfiles) ? s.vendorProfiles.map(v => ({...v})) : [],
    virtualSenders: Array.isArray(s.virtualSenders) ? s.virtualSenders.map(v => ({id: v.id, name: v.name || '', sdp: v.sdp || '', senderId: v.senderId || ''})) : [],
    virtualNode: {enabled: virtualNode.enabled === true, deviceId: typeof virtualNode.deviceId === 'string' ? virtualNode.deviceId : '', nodeId: typeof virtualNode.nodeId === 'string' ? virtualNode.nodeId : ''},
    audioMonitor: {enabled: !!(s.audioMonitor && s.audioMonitor.enabled)},
    bcp008: {enabled: !(s.bcp008 && s.bcp008.enabled === false)},
    multicastRange: typeof s.multicastRange === 'string' ? s.multicastRange : '',
    autoMulticast: {enabled: !!(s.autoMulticast && s.autoMulticast.enabled), reconnectReceiversOnSenderChange: !!s.reconnectReceiversOnSenderChange},
    autoActivateInactiveSender: !!s.autoActivateInactiveSender,
    multicastStats: backend.leases ? backend.leases.getStats() : {pool: {used: 0, total: 0}},
    ddns: {
      enabled: !!ddns.enabled, server: typeof ddns.server === 'string' ? ddns.server : '', port: typeof ddns.port === 'number' ? ddns.port : 53,
      zone: typeof ddns.zone === 'string' ? ddns.zone : '', ttl: typeof ddns.ttl === 'number' ? ddns.ttl : 300, keyName: typeof ddns.keyName === 'string' ? ddns.keyName : '',
      keySecret: '', keySecretSet: typeof ddns.keySecret === 'string' && ddns.keySecret.length > 0,
      keyAlgorithm: typeof ddns.keyAlgorithm === 'string' && ddns.keyAlgorithm ? ddns.keyAlgorithm : 'hmac-sha256',
    },
    probeToken: typeof s.probe?.token === 'string' ? s.probe.token : '',
    settingsFile: backend.settingsFile || null,
  };
}

/** Validate and merge a Setup form submission into `next` (a setupState copy). Pure. */
export function mergeSetup(next, post) {
  if (!post || typeof post !== 'object') return next;
  if (post.registry && typeof post.registry === 'object') {
    if (typeof post.registry.ip === 'string') next.registry.ip = post.registry.ip.trim();
    if (post.registry.port !== undefined) { const p = parseInt('' + post.registry.port); if (!isNaN(p) && p > 0 && p < 65536) next.registry.port = p; }
  }
  if (post.registryDiscovery && typeof post.registryDiscovery === 'object') {
    if (typeof post.registryDiscovery.unicastDnssd === 'boolean') next.registryDiscovery.unicastDnssd = post.registryDiscovery.unicastDnssd;
    if (typeof post.registryDiscovery.domain === 'string') next.registryDiscovery.domain = post.registryDiscovery.domain.trim().replace(/\.+$/, '');
  }
  if (typeof post.acceptableGmid === 'string') next.acceptableGmid = post.acceptableGmid.trim().toUpperCase();
  if (typeof post.multicastRange === 'string') { const v = post.multicastRange.trim(); if (CIDR.test(v)) next.multicastRange = v; else if (v) throw new Error('Multicast range must be a CIDR such as 239.30.0.0/16.'); }
  if (post.autoMulticast && typeof post.autoMulticast === 'object') {
    if (typeof post.autoMulticast.enabled === 'boolean') next.autoMulticast.enabled = post.autoMulticast.enabled;
    if (typeof post.autoMulticast.reconnectReceiversOnSenderChange === 'boolean') next.autoMulticast.reconnectReceiversOnSenderChange = post.autoMulticast.reconnectReceiversOnSenderChange;
  }
  if (typeof post.autoActivateInactiveSender === 'boolean') next.autoActivateInactiveSender = post.autoActivateInactiveSender;
  if (post.ddns && typeof post.ddns === 'object') {
    const d = post.ddns;
    if (typeof d.enabled === 'boolean') next.ddns.enabled = d.enabled;
    if (typeof d.server === 'string') next.ddns.server = d.server.trim();
    if (d.port !== undefined) { const p = parseInt('' + d.port); if (!isNaN(p) && p > 0 && p < 65536) next.ddns.port = p; }
    if (typeof d.zone === 'string') next.ddns.zone = d.zone.trim().replace(/\.+$/, '');
    if (d.ttl !== undefined) { const t = parseInt('' + d.ttl); if (!isNaN(t) && t > 0) next.ddns.ttl = t; }
    if (typeof d.keyName === 'string') next.ddns.keyName = d.keyName.trim().replace(/\.+$/, '');
    if (typeof d.keySecret === 'string' && d.keySecret.length > 0) { next.ddns.keySecret = d.keySecret.trim(); next.ddns.keySecretSet = true; }
    if (typeof d.keyAlgorithm === 'string' && KEY_ALGORITHMS.includes(d.keyAlgorithm)) next.ddns.keyAlgorithm = d.keyAlgorithm;
  }
  if (Array.isArray(post.vendorProfiles)) {
    next.vendorProfiles = post.vendorProfiles.filter(v => v && typeof v === 'object').map(v => {
      let port = parseInt('' + v.port); if (isNaN(port) || port <= 0 || port > 65535) port = 80;
      let protocol = ('' + v.protocol).toLowerCase(); if (protocol !== 'http' && protocol !== 'https') protocol = 'http';
      let path = typeof v.path === 'string' && v.path ? v.path : '/'; if (!path.startsWith('/')) path = '/' + path;
      const labels = typeof v.labels === 'string' ? v.labels : typeof v.labelContains === 'string' ? v.labelContains : '';
      return {id: typeof v.id === 'string' && v.id ? v.id : 'v_' + Math.random().toString(36).slice(2, 8), name: typeof v.name === 'string' ? v.name : '', labels, protocol, port, path};
    });
  }
  if (Array.isArray(post.virtualSenders)) {
    const previous = new Map(next.virtualSenders.map(v => [v.id, v.senderId]));
    next.virtualSenders = post.virtualSenders.filter(v => v && typeof v === 'object').map(v => {
      const id = typeof v.id === 'string' && v.id ? v.id : 'vs_' + Math.random().toString(36).slice(2, 10);
      const senderId = typeof v.senderId === 'string' && /^[a-f0-9-]{36}$/i.test(v.senderId) ? v.senderId : previous.get(id) || '';
      return {id, name: typeof v.name === 'string' ? v.name.trim() : '', sdp: typeof v.sdp === 'string' ? v.sdp : '', senderId};
    });
    next.virtualSendersChanged = true;
  }
  if (post.virtualNode && typeof post.virtualNode === 'object' && typeof post.virtualNode.enabled === 'boolean') next.virtualNode.enabled = post.virtualNode.enabled;
  if (post.bcp008 && typeof post.bcp008 === 'object' && typeof post.bcp008.enabled === 'boolean') next.bcp008.enabled = post.bcp008.enabled;
  if (post.audioMonitor && typeof post.audioMonitor === 'object' && typeof post.audioMonitor.enabled === 'boolean') next.audioMonitor.enabled = post.audioMonitor.enabled;
  next.adoptOnEnable = !!(post.autoMulticast && post.autoMulticast.adoptOnEnable === true);
  return next;
}

/**
 * Apply a Setup submission: mutate the engine's live settings object (shared
 * with every engine service), hot-apply what can be hot-applied, persist
 * settings.json. Returns the new safe setup state.
 */
export async function applySetup(backend, post) {
  const settings = backend.settings;
  if (!settings) throw new Error('Settings are not available.');
  const next = mergeSetup(setupState(backend), post);
  const changed = [];

  if (!Array.isArray(settings.staticNmosRegistries) || !settings.staticNmosRegistries.length) settings.staticNmosRegistries = [{ip: '', port: 80, priority: 10, domain: ''}];
  let registryChanged = false;
  if (settings.staticNmosRegistries[0].ip !== next.registry.ip) { settings.staticNmosRegistries[0].ip = next.registry.ip; registryChanged = true; }
  if (settings.staticNmosRegistries[0].port !== next.registry.port) { settings.staticNmosRegistries[0].port = next.registry.port; registryChanged = true; }
  const prevDiscovery = settings.registryDiscovery && typeof settings.registryDiscovery === 'object' ? settings.registryDiscovery : {};
  const discoveryChanged = (prevDiscovery.unicastDnssd !== false) !== next.registryDiscovery.unicastDnssd || (prevDiscovery.domain || '') !== next.registryDiscovery.domain;
  if (discoveryChanged) settings.registryDiscovery = {unicastDnssd: next.registryDiscovery.unicastDnssd, domain: next.registryDiscovery.domain};
  const gmidChanged = (settings.acceptableGmid || '') !== next.acceptableGmid;
  settings.acceptableGmid = next.acceptableGmid;
  settings.vendorProfiles = next.vendorProfiles;

  const prevVirtualEnabled = !!(settings.virtualNode && settings.virtualNode.enabled === true);
  if (prevVirtualEnabled !== next.virtualNode.enabled) { if (!settings.virtualNode) settings.virtualNode = {}; settings.virtualNode.enabled = next.virtualNode.enabled; changed.push('virtualNode'); }
  if (next.virtualSendersChanged && JSON.stringify(next.virtualSenders) === JSON.stringify((settings.virtualSenders || []).map(v => ({id: v.id, name: v.name || "", sdp: v.sdp || "", senderId: v.senderId || ""})))) next.virtualSendersChanged = false; // form re-sent an unchanged list
  if (next.virtualSendersChanged) {
    settings.virtualSenders = next.virtualSenders;
    try { if (backend.parseSettings) { const tmp = {virtualSenders: settings.virtualSenders}; backend.parseSettings(tmp); settings.virtualSenders = tmp.virtualSenders; } } catch {}
    try { backend.crosspoint?.setVirtualSenders(settings.virtualSenders); } catch {}
    changed.push('virtualSenders');
  }
  if (gmidChanged) changed.push('acceptableGmid');
  try { backend.onVirtualNodeChange?.({toggled: prevVirtualEnabled !== next.virtualNode.enabled, enabled: next.virtualNode.enabled, resync: next.virtualSendersChanged || gmidChanged}); } catch {}

  const prevRange = typeof settings.multicastRange === 'string' ? settings.multicastRange : '';
  const rangeChanged = !!next.multicastRange && prevRange !== next.multicastRange;
  if (next.multicastRange) settings.multicastRange = next.multicastRange;
  const autoWas = !!(settings.autoMulticast && settings.autoMulticast.enabled);
  settings.autoMulticast = {enabled: !!next.autoMulticast.enabled};
  settings.reconnectReceiversOnSenderChange = !!next.autoMulticast.reconnectReceiversOnSenderChange;
  settings.autoActivateInactiveSender = !!next.autoActivateInactiveSender;
  const audioWas = !!(settings.audioMonitor && settings.audioMonitor.enabled);
  settings.audioMonitor = {enabled: !!next.audioMonitor.enabled};
  if (audioWas && !settings.audioMonitor.enabled) { try { backend.audioMonitor?.shutdownAll?.().catch(() => {}); } catch {} }
  delete settings.reconnectReceiversOnMulticastChange;
  try { backend.leases?.setSettings(settings); } catch {}

  const prevSecret = settings.ddns && typeof settings.ddns.keySecret === 'string' ? settings.ddns.keySecret : '';
  settings.ddns = {enabled: !!next.ddns.enabled, server: next.ddns.server, port: next.ddns.port, zone: next.ddns.zone, ttl: next.ddns.ttl, keyName: next.ddns.keyName, keySecret: next.ddns.keySecret || prevSecret, keyAlgorithm: next.ddns.keyAlgorithm};
  try { backend.ddns?.setSettings(settings.ddns); } catch {}

  const prevBcp = !(settings.bcp008 && settings.bcp008.enabled === false);
  settings.bcp008 = {enabled: next.bcp008.enabled};
  if (prevBcp !== next.bcp008.enabled) { try { backend.bcp008?.setEnabled(next.bcp008.enabled); } catch {} changed.push('bcp008'); }

  const needSweep = (!autoWas && settings.autoMulticast.enabled) || (settings.autoMulticast.enabled && rangeChanged);
  if (needSweep) { try { if (next.adoptOnEnable) backend.nmos?.adoptCurrentSenderIPs?.(); else backend.nmos?.sweepAllSenders?.(); } catch {} changed.push(next.adoptOnEnable ? 'leases adopted' : 'leases renewed'); }
  if (settings.ddns.enabled && backend.ddns) { try { const nodes = dnsPushNodes(backend); if (nodes.length) backend.ddns.syncAll(nodes).catch(() => {}); } catch {} }

  if (backend.settingsFile) await writeFile(backend.settingsFile, JSON.stringify(settings, null, 4));
  if (registryChanged || discoveryChanged) { try { backend.nmos?.reconnectStaticRegistries?.(); } catch {} changed.push('registry'); }
  return {config: setupState(backend), changed};
}

/** Nodes to publish via DDNS: operator alias wins over the node label (port of collectDnsPushNodes). */
export function dnsPushNodes(backend) {
  const out = [];
  const nmos = backend.nmosState?.() || {};
  if (!nmos.nodes) return out;
  const aliasByNode = {};
  for (const device of backend.state?.()?.devices || []) {
    const alias = typeof device.alias === 'string' ? device.alias : '', name = typeof device.name === 'string' ? device.name : '';
    if (!alias || alias === name) continue;
    let nodeId = '';
    if (device.id.startsWith('nmos_')) nodeId = nmos.devices?.[device.id.slice(5)]?.node_id || '';
    else if (device.id.startsWith('nmosgrp_')) {
      outer: for (const list of Object.values(device.senders || {})) for (const s of list) { const sender = nmos.senders?.[s.id?.slice(5)]; if (sender?.device_id) { nodeId = nmos.devices?.[sender.device_id]?.node_id || ''; if (nodeId) break outer; } }
    }
    if (nodeId && !aliasByNode[nodeId]) aliasByNode[nodeId] = alias;
  }
  for (const [nodeId, node] of Object.entries(nmos.nodes)) {
    let ip = ''; try { if (typeof node?.href === 'string' && node.href) ip = new URL(node.href).hostname; } catch {}
    const displayName = aliasByNode[nodeId] || node?.label || '';
    if (ip && displayName) out.push({nodeId, displayName, ip});
  }
  return out;
}

/** Lease inventory with live status and bitrate (port of getMulticastLeaseSnapshot). */
export function leaseSnapshot(backend) {
  if (!backend.leases) return {leases: {}, stats: {pool: {used: 0, total: 0}}};
  const raw = backend.leases.getAllLeases(), senders = backend.nmosState?.()?.senders || {}, bitrate = {};
  for (const device of backend.state?.()?.devices || []) for (const list of Object.values(device.senders || {})) for (const s of list) if (typeof s.id === 'string' && s.id.startsWith('nmos_')) bitrate[s.id.slice(5)] = s.bitrate;
  const leases = {};
  for (const [id, lease] of Object.entries(raw)) {
    if (!lease) continue;
    const s = senders[id];
    leases[id] = {...lease, liveStatus: s ? (s.subscription?.active ? 'active' : 'inactive') : 'missing', bitrate: bitrate[id]};
  }
  return {leases, stats: backend.leases.getStats()};
}
