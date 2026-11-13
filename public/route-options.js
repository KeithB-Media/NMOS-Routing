export function groupSearchFields(group,tags=group.tags||[]) {
  const aliases=[...String(group.description||'').matchAll(/^Alias:\s*(.+)$/gmi)].map(m=>m[1].trim());
  return [group.name,group.system,group.description,...Object.values(group.aliases||{}),...aliases,...tags].filter(Boolean);
}

export function destinationRouteSummary(group, routesByDestination, endpointOwner) {
  const levels=group.levels.map(level=>({level,routes:routesByDestination.get(level.id)||[]}));
  const ownerKey=route=>endpointOwner.get(route.from)?.id||route.from;
  const sourceName=route=>endpointOwner.get(route.from)?.name||route.from;
  const routed=levels.filter(item=>item.routes.length);
  const owners=new Set(routed.flatMap(item=>item.routes.map(ownerKey)));
  const mixed=!!routed.length&&(owners.size>1||routed.length<levels.length);
  const video=levels.find(item=>item.level.kind==='video');
  const videoNames=video?[...new Set(video.routes.map(sourceName))]:[];
  const names=[...new Set(routed.flatMap(item=>item.routes.map(sourceName)))];
  const current=!routed.length?'Unrouted':video?(videoNames.length===1?videoNames[0]:videoNames.length?'Mixed video':'Video unrouted'):names.length===1?names[0]:'Mixed sources';
  const detail=levels.map(({level,routes})=>`${level.name}: ${[...new Set(routes.map(sourceName))].join(', ')||'Unrouted'}`).join('\n');
  return {current,mixed,detail};
}

export function routeCompatibility(source,destination,levelKey,lockedEndpoints=new Set(),missingLevelPolicy='disconnect') {
  const required=destination.levels.filter(l=>!levelKey||l.key===levelKey);
  const matches=[],unchanged=[],locked=[];
  for(const level of required) {
    const sourceLevel=source.levels.find(s=>s.key===level.key);
    if(!sourceLevel) {unchanged.push({level});if(!levelKey&&missingLevelPolicy==='disconnect'&&lockedEndpoints.has(level.id))locked.push(level);}
    else {matches.push(level);if(lockedEndpoints.has(level.id))locked.push(level);}
  }
  const self=source.id===destination.id||matches.some(d=>source.levels.find(s=>s.key===d.key)?.id===d.id);
  return {required,matches,unchanged,locked,status:self||locked.length?'unavailable':matches.length===required.length&&matches.length?'full':matches.length?'partial':'unavailable',
    reason:self?'A junction cannot route to itself':locked.length?locked.map(l=>l.name+' is locked').join(' · '):unchanged.map(({level})=>`${level.name} ${missingLevelPolicy==='keep'?'stays unchanged':'will disconnect'}`).join(' · ')||(!required.length?'No routable levels':'')};
}
export function supportsSide(group,side) {return group.side===side||group.side==='bidirectional'||group.bidirectional===true;}

// Resolve media metadata through junction chains without inventing an SDP for
// a virtual endpoint. A visited set also bounds malformed/cyclic graphs.
export function junctionEndpoints(endpoint,routes,direction='source') {
  if(!endpoint.startsWith('jun:'))return [endpoint];
  const index=new Map();
  for(const r of routes){const key=direction==='source'?r.to:r.from;if(!index.has(key))index.set(key,[]);index.get(key).push(direction==='source'?r.from:r.to);}
  const seen=new Set(),physical=new Set(),pending=[endpoint];
  while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);if(!id.startsWith('jun:'))physical.add(id);else pending.push(...(index.get(id)||[]));}
  return [...physical];
}

