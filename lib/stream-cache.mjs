// SDP parsing and the SDP popup view. Reads only come from cached engine state
// or from NMOS Node/Query APIs the operator pointed the viewer at.
import {junctionEndpoints,supportsSide} from '../public/route-options.js';
export function parseSdp(text) {
  let session='',sessionSource='',media=null;const legs=[];
  for(const line of text.split(/\r?\n/).map(s=>s.trim())) {
    if(line.startsWith('m=')){media={multicast:session,source:sessionSource,port:line.split(/\s+/)[1],mid:''};legs.push(media);}
    const address=line.match(/^c=IN IP[46] ([^/\s]+)/)?.[1];
    if(address){if(media)media.multicast=address;else session=address;}
    const filter=line.match(/^a=source-filter:\s*incl IN IP[46] \S+ (.+)$/);
    if(filter){if(media)media.source=filter[1].trim();else sessionSource=filter[1].trim();}
    if(line.startsWith('a=mid:')&&media)media.mid=line.slice(6);
  }
  return legs.filter(l=>l.multicast&&l.multicast!=='0.0.0.0'&&l.multicast!=='::');
}
export function httpUrl(value) {const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Unsupported NMOS URL');return u;}
export async function read(url,signal,json=true) {
  const response=await fetch(httpUrl(url),{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(3500)])});
  if(!response.ok)throw new Error(`Device returned HTTP ${response.status}`);
  let text='';for await(const chunk of response.body){text+=Buffer.from(chunk).toString('utf8');if(text.length>2*1024*1024)throw new Error('Device response is too large');}
  return json?JSON.parse(text):text;
}
export function sdpView(groups,routes,cache,{groupId,levelKey,view,side}) {
  if(!['source','destination','route'].includes(view))throw new Error('Unknown SDP view');
  const group=groups.find(g=>g.id===groupId);if(!group)throw new Error('Group no longer exists');
  const direction=group.side==='bidirectional'?side:group.side;
  if(!['source','destination'].includes(direction)||!supportsSide(group,direction))throw new Error('Choose the source or destination side of the junction.');
  const owner=new Map(groups.flatMap(g=>g.levels.map(l=>[l.id,g]))),blocks=[];
  const add=(endpoint,level,role,route)=>{
    const entry=cache?.entries.get(endpoint),g=owner.get(endpoint);
    blocks.push({endpoint,level,role,group:g?.name||endpoint,route,sdp:entry?.sdp||'',updatedAt:entry?.updatedAt||null,error:entry?.error||(entry?.active===false?'Receiver is disabled; no active stream':!entry?.sdp?'No SDP is cached for this endpoint':null)});
  };
  for(const level of group.levels.filter(l=>!levelKey||l.key===levelKey)) {
    const current=routes.filter(r=>direction==='source'?r.from===level.id:r.to===level.id);
    const resolved=(endpoint,role,route)=>{
      const physical=junctionEndpoints(endpoint,routes,role==='Source'?'source':'destination');
      if(!physical.length)blocks.push({endpoint,level:level.name,role,group:group.name,route,sdp:'',error:'No physical '+role.toLowerCase()+' is connected to this virtual junction.'});
      else for(const id of physical)add(id,level.name,role,route);
    };
    if(view==='route') {
      for(const route of current){const label=(owner.get(route.from)?.name||route.from)+' → '+(owner.get(route.to)?.name||route.to);resolved(route.from,'Source',label);resolved(route.to,'Destination',label);}
    } else if(group.side==='bidirectional')resolved(level.id,view==='source'?'Source':'Destination');
    else if((view==='source')===(direction==='source'))resolved(level.id,view==='source'?'Source':'Destination');
    else for(const route of current)resolved(view==='source'?route.from:route.to,view==='source'?'Source':'Destination');
  }
  return {group:group.name,view,blocks,note:view==='route'?'Sender SDP for each current route, as the engine cached it. No SDP is synthesized.':'Reported SDP from the engine\'s cached NMOS state.'};
}
