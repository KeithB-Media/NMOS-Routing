// AMWA BCP-002-01 and the NMOS grouphint parameter register.
export const groupHintKey='urn:x-nmos:tag:grouphint/v1.0';
export function naturalHint(resource) {
  const tags=resource?.tags||{},legacy=!Object.hasOwn(tags,groupHintKey);
  const values=tags[legacy?'urn:x-nmos:tag:grouphint':groupHintKey];
  if(!Array.isArray(values)||typeof values[0]!=='string'||!values[0])return null;
  const parts=values[0].split(':'),[name,role,scope='device']=parts;
  if(parts.length<2||parts.length>3||!name.trim()||!role.trim()||!['device','node'].includes(scope))return null;
  // Names and roles are identifiers; do not silently merge whitespace variants.
  return {name,role,scope,legacy};
}
export function essenceKind(resource,node,type) {
  const flow=type==='senders'?node.resources.flows?.find(f=>f.id===resource.flow_id):null;
  const format=resource.format||flow?.format,media=resource.media_type||flow?.media_type||'';
  if(format==='urn:x-nmos:format:audio'||media.startsWith('audio/'))return 'audio';
  if(format==='urn:x-nmos:format:data'||/smpte291/i.test(media))return 'data';
  if(format==='urn:x-nmos:format:video'||media.startsWith('video/'))return 'video';
  return 'unknown';
}
export function naturalGroups(nodes) {
  const groups=new Map();
  for(const node of nodes)for(const type of ['senders','receivers'])for(const resource of node.resources[type]||[]) {
    const hint=naturalHint(resource);if(!hint)continue;
    const nodeId=node.resources.self?.[0]?.id;
    if(!nodeId||(hint.scope==='device'&&!resource.device_id))continue;
    const scopeId=hint.scope==='node'?nodeId:resource.device_id,side=type==='senders'?'source':'destination';
    const id=JSON.stringify([nodeId,hint.scope,scopeId,hint.name,side]);
    if(!groups.has(id))groups.set(id,{id,nodeKey:node.id,nodeId,nodeLabel:node.label,name:hint.name,scope:hint.scope,scopeId,side,members:[],errors:[],warnings:[],stale:!!node.stale});
    const group=groups.get(id);
    if(group.nodeKey!==node.id)group.errors.push('The same NMOS node is advertised more than once. Select a single node API.');
    if(group.members.some(m=>m.role===hint.role))group.errors.push(`Duplicate ${side} role: ${hint.role}`);
    if(group.members.some(m=>m.id===resource.id))group.errors.push('A resource is advertised more than once.');
    if(hint.legacy&&!group.warnings.length)group.warnings.push('Device uses the legacy unversioned grouphint tag.');
    group.members.push({id:resource.id,label:resource.label||resource.id,role:hint.role,deviceId:resource.device_id,kind:essenceKind(resource,node,type),version:resource.version||null});
  }
  const rank={video:0,audio:1,data:2,unknown:3};
  return [...groups.values()].map(group=>({...group,members:group.members.sort((a,b)=>rank[a.kind]-rank[b.kind]||a.role.localeCompare(b.role,undefined,{numeric:true}))})).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})||a.side.localeCompare(b.side));
}
