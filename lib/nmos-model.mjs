// Adapter: nmos-crosspoint engine state → Route Desk inventory model.
//
// The engine already groups IS-04 senders/receivers into "devices": one per
// NMOS device, or one per BCP-002-01 grouphint group (device ids starting
// with "nmosgrp_"). Route Desk thinks in routable groups with ordered
// levels, so each engine device becomes:
//   - a source group      (id "src:<device>")  from its senders, and/or
//   - a destination group (id "dst:<device>")  from its receivers.
// A level is one flow; its id is the engine flow id ("nmos_<uuid>"), which is
// also the route endpoint identity. Level keys ("video-1", "audio-2", …) are
// the content IDs that routing matches between source and destination; they
// are positional within a media type, mirroring the engine's own matcher.
// Receiver.connectedFlow is the current route. Nothing here talks to a
// device; it only reshapes state the engine has already published.

const KINDS = {video: 'video', audio: 'audio', audiochannel: 'audio'};
const ORDER = ['video', 'audio', 'data', 'websocket', 'mqtt', 'unknown'];

function kindOf(type) { return KINDS[type] || 'data'; }
function sortFlows(list) { return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.num ?? 0) - (b.num ?? 0) || String(a.name).localeCompare(String(b.name), undefined, {numeric: true})); }

// Positional role name ("Audio 3"); the flow's own label is kept in flowName/flowAlias.
export function levelName(type, index) {
  const prefix = type === 'video' ? 'Video' : type === 'audio' ? 'Audio' : type === 'audiochannel' ? 'Channel' : type === 'data' ? 'ANC' : type[0].toUpperCase() + type.slice(1);
  return `${prefix} ${index}`;
}

export function networkOf(flow) {
  const legs = (flow.legs || []).filter(l => l.dstIp).map(l => ({index: l.index, multicast: l.dstIp, port: l.dstPort ? String(l.dstPort) : '', source: l.srcIp || '', mid: '', duplicate: !!l.dup, duplicateWith: l.dupText || ''}));
  const transport = flow.capabilities?.transport || (legs.length ? 'rtp' : '');
  return {legs, hasSdp: !!flow.manifestOk || typeof flow.sdp === 'string', active: !!flow.active, available: flow.available !== false, stale: false, transport, codec: flow.codec || '', format: flow.format || '', bitrate: flow.bitrate?.v ?? null, bitrateHint: flow.bitrate?.hint || ''};
}

export function monitorOf(flow) {
  if (!flow.monitor) return null;
  const {status, message, detail, counter, domains} = flow.monitor;
  return {status, message: message || '', detail: detail || '', counter: counter ?? 0, domains: domains || []};
}

function levels(device, direction) {
  const out = [];
  for (const type of ORDER) {
    let index = 0;
    for (const flow of sortFlows(device[direction]?.[type] || [])) {
      if (flow.hidden) continue;
      index++;
      out.push({
        key: `${type}-${index}`,
        id: flow.id,
        profileId: null,
        name: levelName(type, index, flow),
        kind: kindOf(type),
        flowName: flow.name || '',
        flowAlias: flow.alias || '',
        aliases: {},
        deviceId: device.id,
        available: flow.available !== false,
        active: !!flow.active,
        num: flow.num,
        virtual: !!flow.isVirtual,
        network: networkOf(flow),
        monitor: monitorOf(flow),
        ...(direction === 'receivers' && flow.connectedSenderLabel ? {connectedSenderLabel: flow.connectedSenderLabel} : {}),
      });
    }
  }
  return out;
}

export function groupType(device, levelList) {
  if (device.isVirtual) return 'Virtual sender';
  if (device.id.startsWith('nmosgrp_')) return 'Natural group';
  const transports = new Set(levelList.map(l => l.network.transport).filter(Boolean));
  if (transports.has('mxl')) return transports.size > 1 ? 'Mixed transport' : 'MXL';
  return 'ST 2110';
}

function group(device, direction, side) {
  const levelList = levels(device, direction);
  if (!levelList.length) return null;
  const name = (device.displayLabel || device.alias || device.name || device.id).trim();
  const system = device.name || device.id;
  const descriptionParts = [device.nodeLabel ? `Node: ${device.nodeLabel}` : '', device.ip ? `IP: ${device.ip}` : '', device.alias && device.alias !== device.name ? `Alias: ${device.alias}` : ''].filter(Boolean);
  const monitors = levelList.map(l => l.monitor).filter(Boolean);
  return {
    id: `${side === 'source' ? 'src' : 'dst'}:${device.id}`,
    side,
    name,
    system,
    description: descriptionParts.join('\n'),
    aliases: {},
    type: groupType(device, levelList),
    tags: [],
    deviceId: device.id,
    nodeId: device.nodeId || null,
    nodeLabel: device.nodeLabel || '',
    deviceUrl: device.deviceUrl || '',
    available: device.available !== false,
    hidden: !!device.hidden,
    virtual: !!device.isVirtual,
    gmid: device.gmid || '',
    gmidLocked: device.gmidLocked ?? null,
    monitor: monitors.length ? {worst: Math.max(...monitors.map(m => m.status)), count: monitors.filter(m => m.status >= 2).length} : null,
    levels: levelList,
  };
}

/** Routes: every receiver flow with a connected sender flow. */
export function routesOf(state) {
  const routes = [];
  for (const device of state?.devices || []) {
    for (const type of ORDER) {
      for (const flow of sortFlows(device.receivers?.[type] || [])) {
        if (!flow.connectedFlow) continue;
        routes.push({id: `${flow.connectedFlow}>${flow.id}`, rev: null, from: flow.connectedFlow, to: flow.id, locked: false, state: flow.active ? 1 : 0, health: flow.monitor?.status ?? null});
      }
    }
  }
  return routes;
}

/**
 * Build the Route Desk inventory from an enriched CrosspointState.
 * `options.includeHidden` keeps devices/flows the operator hid in the engine.
 */
export function inventoryOf(state, {includeHidden = false} = {}) {
  const groups = [], devices = [];
  for (const device of state?.devices || []) {
    if (device.hidden && !includeHidden) continue;
    devices.push({id: device.id, name: (device.displayLabel || device.alias || device.name || device.id).trim(), nodeId: device.nodeId || null, nodeLabel: device.nodeLabel || '', available: device.available !== false, virtual: !!device.isVirtual, deviceUrl: device.deviceUrl || ''});
    const source = group(device, 'senders', 'source'), destination = group(device, 'receivers', 'destination');
    if (source) groups.push(source);
    if (destination) groups.push(destination);
  }
  groups.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}) || a.side.localeCompare(b.side));
  const allowed = new Set(groups.flatMap(g => g.levels.map(l => l.id)));
  const routes = routesOf(state).filter(r => allowed.has(r.to));
  // The engine has one operator alias per device, and it IS the display name
  // (system keeps the raw NMOS label). No separate alias sets exist.
  return {groups, routes, devices, aliasSets: [], totals: state?.totals || null};
}

/**
 * SDP lookup compatible with stream-cache's sdpView(): entries.get(flowId)
 * → {sdp, updatedAt, error, active}. Sender SDP comes from the engine's
 * manifest cache; receivers report the connected sender's SDP (the SDP a
 * receiver was given IS the sender manifest). Nothing is synthesized.
 */
export function sdpCacheOf(state, nmosState) {
  const senders = new Map(), receivers = new Map();
  for (const device of state?.devices || []) {
    for (const list of Object.values(device.senders || {})) for (const f of list) senders.set(f.id, f);
    for (const list of Object.values(device.receivers || {})) for (const f of list) receivers.set(f.id, f);
  }
  const senderSdp = flow => {
    if (!flow) return null;
    if (typeof flow.sdp === 'string' && flow.sdp) return flow.sdp;
    const detail = nmosState?.sendersManifestDetail?.[flow.id.replace(/^nmos_/, '')];
    return typeof detail?._RAWSDP === 'string' && detail._RAWSDP ? detail._RAWSDP : null;
  };
  return {entries: {get(id) {
    if (senders.has(id)) {
      const flow = senders.get(id), sdp = senderSdp(flow);
      return {sdp: sdp || '', updatedAt: null, active: !!flow.active, error: flow.available === false ? 'Sender is offline' : sdp ? null : 'No SDP is cached for this sender'};
    }
    if (receivers.has(id)) {
      const flow = receivers.get(id);
      if (!flow.connectedFlow) return {sdp: '', updatedAt: null, active: !!flow.active, error: 'Receiver has no connected sender'};
      const sdp = senderSdp(senders.get(flow.connectedFlow));
      return {sdp: sdp || '', updatedAt: null, active: !!flow.active, error: flow.available === false ? 'Receiver is offline' : sdp ? null : 'No SDP is cached for the connected sender'};
    }
    return undefined;
  }}};
}
