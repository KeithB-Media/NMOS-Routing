// Routing planners shared by the server and tests. Groups/levels/routes come
// from lib/nmos-model.mjs (engine adapter). A level key is the content ID
// matched between source and destination; endpoints are engine flow ids.
import {supportsSide} from '../public/route-options.js';

export function planRoute(groups, routes, {sourceId, destinationId, levelKey}) {
  const source = groups.find(g => g.id === sourceId && supportsSide(g,'source'));
  const destination = groups.find(g => g.id === destinationId && supportsSide(g,'destination'));
  if (!source || !destination) throw new Error('Source or destination no longer exists. Refresh the inventory.');
  if(sourceId===destinationId)throw new Error('A junction cannot route to itself.');
  // Route the intersection of content keys. Never invent mappings or clear unmatched levels.
  const levels = destination.levels.filter(l=>(!levelKey||l.key===levelKey)&&source.levels.some(s=>s.key===l.key));
  if (!levels.length) throw new Error('No routable levels with matching content IDs.');
  return levels.map(d => {
    const s = source.levels.find(l => l.key === d.key);
    if(s.id===d.id)throw new Error('An endpoint cannot route to itself.');
    if (routes.some(r => r.to === d.id && r.locked)) throw new Error(`${d.name} is locked.`);
    return {from:s.id, to:d.id, profiles:d.profileId?[d.profileId]:[], tags:[], ctype:2, locked:false,
      ...(!levelKey&&levels.length===destination.levels.length ? {groupParent:{from:source.id, to:destination.id}} : {}),
      descriptor:{label:`${source.name} → ${destination.name}`, desc:d.name}};
  });
}

export function planDisconnect(groups, routes, {groupId, levelKey, side}) {
  const group = groups.find(g => g.id === groupId);
  if (!group) throw new Error('Group no longer exists. Refresh the inventory.');
  const direction=group.side==='bidirectional'?side:group.side;
  if(!['source','destination'].includes(direction)||!supportsSide(group,direction))throw new Error('Choose the source or destination side of the junction.');
  const levels = group.levels.filter(l => !levelKey || l.key === levelKey);
  if (!levels.length) throw new Error('Level no longer exists. Refresh the inventory.');
  const endpoints = new Set(levels.map(l => l.id));
  const selected = routes.filter(r => endpoints.has(direction === 'source' ? r.from : r.to));
  if (selected.some(r => r.locked)) throw new Error('A selected route is locked.');
  return selected;
}

export function planMissingDisconnect(groups, routes, {sourceId, destinationId, levelKey, missingLevelPolicy = 'disconnect'}) {
  if (!['disconnect','keep'].includes(missingLevelPolicy)) throw new Error('Unknown missing-level policy.');
  if (levelKey || missingLevelPolicy === 'keep') return [];
  const source = groups.find(g=>g.id===sourceId), destination = groups.find(g=>g.id===destinationId);
  if (!source || !destination) throw new Error('Source or destination no longer exists. Refresh the inventory.');
  const missing = new Set(destination.levels.filter(d=>!source.levels.some(s=>s.key===d.key)).map(d=>d.id));
  const selected = routes.filter(r=>missing.has(r.to));
  if (selected.some(r=>r.locked)) throw new Error('A missing destination level is locked.');
  return selected;
}

export function validateNameChange({groupId,aliasSet='',name,previous}) {
  if(typeof groupId!=='string'||typeof aliasSet!=='string'||typeof name!=='string'||typeof previous!=='string')throw new Error('Invalid name change.');
  name=name.trim();
  if((!aliasSet&&!name)||name.length>200||/[\u0000-\u001f\u007f]/.test(name))throw new Error('Use a name of up to 200 characters. The default name cannot be empty.');
  return {groupId,aliasSet,name,previous};
}
export function validateNameChanges(changes) {
  if(!Array.isArray(changes)||!changes.length||changes.length>500)throw new Error('Use between 1 and 500 name changes.');
  const result=changes.map(validateNameChange);
  if(new Set(result.map(c=>c.groupId)).size!==result.length)throw new Error('Each group can only be renamed once per fill.');
  if(new Set(result.map(c=>c.aliasSet)).size!==1)throw new Error('Fill names in one name set at a time.');
  return result;
}
