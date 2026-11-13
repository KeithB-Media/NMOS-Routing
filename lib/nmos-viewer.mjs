import {httpUrl,read,parseSdp} from './stream-cache.mjs';

export const resourceTypes=['self','devices','senders','receivers','sources','flows'];
export function apiBase(value,kind) {
  const url=httpUrl(value);
  if(!new RegExp(`^/x-nmos/${kind}/v[0-9]+\\.[0-9]+/?$`).test(url.pathname)||url.search||url.hash)throw new Error('Invalid reported NMOS API URL');
  return url.href.replace(/\/?$/,'/');
}
export async function resolveApi(value,kind) {
  try{return apiBase(value,kind);}catch{}
  const url=httpUrl(value);
  if(url.search||url.hash||!['/','/x-nmos/'+kind,'/x-nmos/'+kind+'/'].includes(url.pathname))throw new Error(`Enter a host URL or a versioned /x-nmos/${kind}/v1.3/ API URL`);
  const base=url.origin+'/x-nmos/'+kind+'/';
  const versions=await read(base,AbortSignal.timeout(5000));
  const version=Array.isArray(versions)?versions.filter(v=>typeof v==='string'&&/^v1\.\d+\/?$/.test(v)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1):null;
  if(!version)throw new Error(`No supported IS-04 ${kind} API version advertised at ${base}`);
  return apiBase(base+version,kind);
}
async function pool(jobs) {
  let index=0;
  await Promise.all(Array.from({length:Math.min(6,jobs.length)},async()=>{while(index<jobs.length)await jobs[index++]();}));
}
// VIP discovery reads only the Node API locations in the controller inventory.
export class NmosViewer {
  constructor(client) {this.client=client;this.nodes=[];this.updatedAt=null;this.attemptedAt=0;this.error=null;this.inFlight=null;}
  async inventory({force=false}={}) {
    if(!this.client)return {nodes:[],updatedAt:null,error:null,mode:'demo'};
    if(this.inFlight)await this.inFlight;
    else if(force||Date.now()-this.attemptedAt>=30000) {
      this.attemptedAt=Date.now();
      this.inFlight=this.update().finally(()=>{this.inFlight=null;});
      await this.inFlight;
    }
    return {nodes:this.nodes,updatedAt:this.updatedAt,error:this.error,mode:'live'};
  }
  async update() {
    try {
      const data=await this.client.request('/rest/v2/data',{path:'/status/devman/devices/**'});
      const devices=data.data?.status?.devman?.devices?._items;
      if(!Array.isArray(devices))throw new Error('VIP device inventory is unavailable');
      const discovered=new Map(),old=new Map(this.nodes.map(n=>[n.url,n])),jobs=[];
      for(const device of devices) {
        const urls=(device.deviceInfo?.report||[]).map(r=>r.field?.value).filter(v=>typeof v==='string');
        let control=null;
        for(const url of urls)try{control=apiBase(url,'connection');break;}catch{}
        for(const value of urls) {
          let url;try{url=apiBase(value,'node');}catch{continue;}
          if(discovered.has(url))continue;
          const previous=old.get(url);
          const node={id:url,url,control,label:previous?.label||device.name||device._id||url,resources:{},errors:{},updatedAt:null};
          discovered.set(url,node);
          for(const type of resourceTypes)jobs.push(async()=>{
            try {
              const result=await read(url+type+'/',signal);
              if(type==='self'?(!result||typeof result!=='object'||Array.isArray(result)||typeof result.id!=='string'):(!Array.isArray(result)||result.some(r=>!r||typeof r.id!=='string')))throw new Error('Invalid NMOS resource response');
              node.resources[type]=type==='self'?[result]:result;
            }catch(e){
              node.resources[type]=previous?.resources[type]||[];
              node.errors[type]=e.message;
            }
          });
        }
      }
      const signal=AbortSignal.timeout(20000);
      await pool(jobs);
      const now=new Date().toISOString();
      for(const node of discovered.values()) {
        node.label=node.resources.self?.[0]?.label||node.label;
        node.controls=Object.fromEntries((node.resources.devices||[]).map(d=>[d.id,(d.controls||[]).find(c=>/^urn:x-nmos:control:sr-ctrl\/v\d+\.\d+$/.test(c.type))?.href||null]));
        node.stale=Object.keys(node.errors).length>0;
        node.updatedAt=node.stale?old.get(node.url)?.updatedAt||null:now;
      }
      this.nodes=[...discovered.values()];this.updatedAt=now;this.error=null;
    }catch(e){this.error=e.message;this.nodes=this.nodes.map(n=>({...n,stale:true}));}
  }
  async detail(nodeId,type,id) {
    if(!resourceTypes.includes(type))throw new Error('Unknown NMOS resource type');
    const node=this.nodes.find(n=>n.id===nodeId),resource=node?.resources[type]?.find(r=>r.id===id);
    if(!resource)throw new Error('NMOS resource is no longer available. Refresh the viewer.');
    const result={resource,active:null,sdp:'',legs:[],errors:[],readAt:new Date().toISOString(),stale:!!this.error||node.stale};
    if(!['senders','receivers'].includes(type))return result;
    const signal=AbortSignal.timeout(8000);
    const control=node.controls?.[resource.device_id]||node.control;
    if(control) {
      try {result.active=await read(apiBase(control,'connection')+'single/'+type+'/'+encodeURIComponent(id)+'/active',signal);}
      catch(e){result.errors.push('IS-05 active state: '+e.message);}
    }else result.errors.push('No IS-05 connection API advertised for this device.');
    try {
      if(type==='senders') {
        if(resource.manifest_href){
          const manifest=httpUrl(resource.manifest_href);
          if(manifest.hostname!==httpUrl(node.manifestBase||node.url).hostname)throw new Error('Manifest host differs from the reported NMOS node');
          result.sdp=await read(manifest.href,signal,false);
        }else if(control)result.sdp=await read(apiBase(control,'connection')+'single/senders/'+encodeURIComponent(id)+'/transportfile',signal,false);
        else throw new Error('Sender does not advertise an SDP');
      }else result.sdp=typeof result.active?.transport_file?.data==='string'?result.active.transport_file.data:'';
      if(result.sdp&&!/^v=0(?:\r?\n)/.test(result.sdp))throw new Error('Device did not return an SDP');
      result.legs=parseSdp(result.sdp);
    }catch(e){result.sdp='';result.errors.push('SDP: '+e.message);}
    return result;
  }
}

async function collection(base,type,signal) {
  let next=base+type+'/?paging.limit=100',items=[];
  const seen=new Set();
  while(next) {
    const url=httpUrl(next);
    if(url.origin!==new URL(base).origin||url.pathname!==new URL(base+type+'/').pathname)throw new Error('Registry pagination leaves the requested collection');
    if(seen.has(url.href)||seen.size>=100)throw new Error('Registry pagination limit reached; inventory is incomplete');
    seen.add(url.href);
    let response=await fetch(url,{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});
    if(response.status===501&&seen.size===1){url.search='';response=await fetch(url,{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});}
    if(!response.ok)throw new Error(`Registry returned HTTP ${response.status}`);
    let text='';for await(const chunk of response.body){text+=Buffer.from(chunk).toString('utf8');if(text.length>8*1024*1024)throw new Error('Registry page is too large');}
    const page=JSON.parse(text);
    if(!Array.isArray(page)||page.some(r=>!r||typeof r.id!=='string'))throw new Error('Invalid registry resource response');
    items.push(...page);
    if(items.length>50000)throw new Error('Registry collection exceeds 50,000 resources');
    if(!page.length)break;
    // The initial page is newest first; prev walks toward older resources.
    const link=(response.headers.get('link')||'').split(/,(?=\s*<)/).find(link=>/;\s*rel\s*=\s*"?prev"?(?:\s*;|\s*$)/i.test(link));
    const href=link?.match(/<([^>]+)>/)?.[1];next=href?new URL(href,url).href:null;
  }
  return [...new Map(items.map(r=>[r.id,r])).values()];
}

export class RegistryViewer extends NmosViewer {
  constructor(url){super({});this.url=apiBase(url,'query');}
  async update() {
    const signal=AbortSignal.timeout(25000),resources={},errors={};
    await Promise.all(['nodes',...resourceTypes.slice(1)].map(async type=>{
      try{resources[type]=await collection(this.url,type,signal);}catch(e){errors[type]=e.message;}
    }));
    if(Object.keys(errors).length){this.error=Object.entries(errors).map(([type,error])=>type+': '+error).join('; ');this.nodes=this.nodes.map(n=>({...n,stale:true}));return;}
    const now=new Date().toISOString();
    this.nodes=resources.nodes.map(resource=>{
      const devices=resources.devices.filter(d=>d.node_id===resource.id),ids=new Set(devices.map(d=>d.id));
      let control=null;
      // A connection API belongs to a device, so retain it per sender/receiver.
      const controls=Object.fromEntries(devices.map(d=>[d.id,(d.controls||[]).find(c=>/^urn:x-nmos:control:sr-ctrl\/v\d+\.\d+$/.test(c.type))?.href||null]));
      return {id:resource.id,label:resource.label||resource.id,url:this.url,manifestBase:resource.href,control,controls,updatedAt:now,stale:false,errors:{},resources:{self:[resource],devices,...Object.fromEntries(['senders','receivers','sources','flows'].map(type=>[type,resources[type].filter(r=>ids.has(r.device_id))]))}};
    });
    this.error=null;this.updatedAt=now;
  }
}

export class NodeViewer extends NmosViewer {
  constructor(url) {
    const base=apiBase(url,'node');
    super({request:async()=>({data:{status:{devman:{devices:{_items:[{_id:base,deviceInfo:{report:[{field:{value:base}}]}}]}}}}})});
    this.url=base;
  }
}
