// Operator-defined routing groups.
//
// The engine groups flows automatically (one device, or one BCP-002-01
// grouphint group, per routable group). Manual groups let an operator
// override that: pick any sender flows (or any receiver flows), name the
// group and order its levels. A flow claimed by a manual group leaves its
// automatic group; deleting the manual group returns it. Manual groups are
// NMOS Routing metadata — nothing is written to a device or the registry.
import {readFile, writeFile, rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const KINDS = {video: 'video', audio: 'audio', audiochannel: 'audio'};
const kindOf = type => KINDS[type] || 'data';
const ORDER = ['video', 'audio', 'data', 'websocket', 'mqtt', 'unknown', 'audiochannel'];
const sortFlows = list => [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.num ?? 0) - (b.num ?? 0) || String(a.name).localeCompare(String(b.name), undefined, {numeric: true}));

/** Every routable flow in the engine state, for the builder's picker. */
export function flowCatalog(state) {
  const out = [];
  for (const device of state?.devices || []) {
    const deviceName = (device.displayLabel || device.alias || device.name || device.id).trim();
    for (const [direction, side] of [['senders', 'source'], ['receivers', 'destination']]) {
      for (const type of ORDER) {
        for (const flow of sortFlows(device[direction]?.[type] || [])) {
          if (flow.hidden || device.hidden) continue;
          out.push({id: flow.id, side, type, kind: kindOf(type), name: flow.alias?.trim() || flow.name || flow.id, flowName: flow.name || '', deviceId: device.id, deviceName, available: flow.available !== false, format: flow.format || ''});
        }
      }
    }
  }
  return out;
}

/** Validate one group definition against the current flow catalog. Returns a normalised copy. */
export function validateManualGroup(input, catalog, existing = []) {
  if (!input || typeof input !== 'object') throw new Error('Invalid group.');
  const id = typeof input.id === 'string' && /^man:[0-9a-f-]{36}$/.test(input.id) ? input.id : `man:${randomUUID()}`;
  const side = input.side;
  if (!['source', 'destination'].includes(side)) throw new Error('Choose source or destination.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Use a group name of 1–120 characters.');
  if (!Array.isArray(input.levels) || !input.levels.length || input.levels.length > 64) throw new Error('Choose between 1 and 64 flows.');
  const byId = new Map(catalog.map(f => [f.id, f]));
  const claimed = new Map(existing.filter(g => g.id !== id).flatMap(g => g.levels.map(l => [l.flowId, g.name])));
  const counters = {};
  const levels = input.levels.map(level => {
    const flowId = typeof level === 'string' ? level : level?.flowId;
    const flow = byId.get(flowId);
    if (!flow) throw new Error('A chosen flow no longer exists. Refresh the inventory.');
    if (flow.side !== side) throw new Error(`${flow.name} is a ${flow.side} flow; this is a ${side} group.`);
    if (claimed.has(flowId)) throw new Error(`${flow.name} already belongs to the manual group "${claimed.get(flowId)}".`);
    counters[flow.type] = (counters[flow.type] || 0) + 1;
    return {flowId, key: `${flow.type}-${counters[flow.type]}`};
  });
  if (new Set(levels.map(l => l.flowId)).size !== levels.length) throw new Error('A flow can only appear once in a group.');
  return {id, side, name, levels};
}

export class ManualGroupStore {
  constructor(file) { this.file = file; this.groups = []; this.queue = Promise.resolve(); }
  async load() {
    try { const data = JSON.parse(await readFile(this.file, 'utf8')); this.groups = Array.isArray(data?.groups) ? data.groups : []; }
    catch (e) { if (e.code !== 'ENOENT') throw e; this.groups = []; }
    return this.groups;
  }
  persist() {
    const data = JSON.stringify({groups: this.groups}, null, 2);
    const next = this.queue.catch(() => {}).then(async () => { await writeFile(this.file + '.tmp', data); await rename(this.file + '.tmp', this.file); });
    this.queue = next;
    return next;
  }
  upsert(input, catalog) {
    const group = validateManualGroup(input, catalog, this.groups);
    const index = this.groups.findIndex(g => g.id === group.id);
    if (index === -1) this.groups.push(group); else this.groups[index] = group;
    return group;
  }
  remove(id) {
    const index = this.groups.findIndex(g => g.id === id);
    if (index === -1) throw new Error('Manual group no longer exists.');
    return this.groups.splice(index, 1)[0];
  }
}

/**
 * Apply manual groups to an adapter inventory: build the manual groups from
 * the automatic groups' level records, remove those levels from their
 * automatic groups, and drop automatic groups left empty. Routes are
 * untouched (they reference flow ids). Manual groups whose flows are all
 * missing are reported in `unresolved` and omitted.
 */
export function applyManualGroups(inventory, manualGroups) {
  if (!manualGroups?.length) return {...inventory, manualGroups: [], unresolved: []};
  const levelById = new Map(inventory.groups.flatMap(g => g.levels.map(l => [l.id, {level: l, group: g}])));
  const claimed = new Set(manualGroups.flatMap(g => g.levels.map(l => l.flowId)));
  const groups = [], unresolved = [];
  for (const manual of manualGroups) {
    const levels = [], missing = [];
    for (const {flowId, key} of manual.levels) {
      const hit = levelById.get(flowId);
      if (!hit || hit.group.side !== manual.side) { missing.push(flowId); continue; }
      const kind = key.split('-')[0];
      levels.push({...hit.level, key, kind: kindOf(kind), name: `${kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'data' ? 'ANC' : kind[0].toUpperCase() + kind.slice(1)} ${key.split('-')[1]}`, homeGroupId: hit.group.id, homeGroupName: hit.group.name});
    }
    if (!levels.length) { unresolved.push({id: manual.id, name: manual.name, missing}); continue; }
    const devices = [...new Set(levels.map(l => l.deviceId))];
    groups.push({
      id: manual.id, side: manual.side, name: manual.name, system: manual.name, description: `Manual group · ${levels.length} flows from ${devices.length} device${devices.length === 1 ? '' : 's'}${missing.length ? ` · ${missing.length} missing` : ''}`,
      aliases: {}, type: 'Manual group', tags: [], deviceId: devices.length === 1 ? devices[0] : null, nodeId: null, nodeLabel: '', deviceUrl: '',
      available: levels.some(l => l.available !== false), hidden: false, virtual: false, manual: true, missingFlows: missing, gmid: '', gmidLocked: null,
      monitor: levels.some(l => l.monitor) ? {worst: Math.max(...levels.map(l => l.monitor?.status ?? 0)), count: levels.filter(l => (l.monitor?.status ?? 0) >= 2).length} : null,
      levels,
    });
  }
  for (const group of inventory.groups) {
    const remaining = group.levels.filter(l => !claimed.has(l.id));
    if (!remaining.length) continue;
    groups.push(remaining.length === group.levels.length ? group : {...group, levels: remaining});
  }
  groups.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}) || a.side.localeCompare(b.side));
  return {...inventory, groups, manualGroups, unresolved};
}
