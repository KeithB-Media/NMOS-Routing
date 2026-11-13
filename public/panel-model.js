import {supportsSide, routeCompatibility} from './route-options.js';

export const widgetKinds=['tags','devices','tree','sources','destinations','context'];
export const uid=()=> 'p-'+Array.from(crypto.getRandomValues(new Uint32Array(2)),n=>n.toString(16)).join('-');
export function starterPanel() {
  return {id:uid(),name:'Routing panel',folders:[{id:'root',parentId:null,name:'My routing tree',groupIds:[]}],widgets:[
    {id:'tags',title:'Source tags',kind:'tags',scope:'source',target:'sources',x:0,y:0,w:3,h:4},
    {id:'devices',title:'Devices',kind:'devices',scope:'both',target:'device-context',x:0,y:4,w:3,h:4},
    {id:'tree',title:'Custom tree',kind:'tree',scope:'both',target:'device-context',x:0,y:8,w:3,h:5},
    {id:'sources',title:'Sources',kind:'context',scope:'source',x:3,y:0,w:4,h:8,initialAll:true},
    {id:'destinations',title:'Destinations',kind:'context',scope:'destination',x:7,y:0,w:5,h:8,initialAll:true},
    {id:'device-context',title:'Linked context',kind:'context',scope:'both',x:3,y:8,w:9,h:5},
  ]};
}
export function validPanel(panel) {
  if(!panel||typeof panel.id!=='string'||typeof panel.name!=='string'||!Array.isArray(panel.widgets)||!Array.isArray(panel.folders))return false;
  if(panel.widgets.length>40||panel.folders.length>500)return false;
  const ids=new Set();
  for(const w of panel.widgets){if(!w||typeof w.id!=='string'||ids.has(w.id)||!widgetKinds.includes(w.kind)||typeof w.title!=='string'||!['source','destination','both'].includes(w.scope)||!Number.isInteger(w.x)||w.x<0||!Number.isInteger(w.w)||w.w<2||w.x+w.w>12||!Number.isInteger(w.y)||w.y<0||w.y>200||!Number.isInteger(w.h)||w.h<3||w.h>30)return false;ids.add(w.id);}
  const folders=new Map();
  for(const f of panel.folders){if(!f||typeof f.id!=='string'||folders.has(f.id)||typeof f.name!=='string'||!Array.isArray(f.groupIds)||f.groupIds.some(id=>typeof id!=='string'))return false;folders.set(f.id,f);}
  for(const f of panel.folders){const seen=new Set([f.id]);let parent=f.parentId;while(parent!=null){if(seen.has(parent)||!folders.has(parent))return false;seen.add(parent);parent=folders.get(parent).parentId;}}
  return true;
}
// Levels carry the engine device id they belong to (legacy VIP topology ids
// "topo:<device>.<module>.<port>" are still understood). Never infer devices from labels.
export function deviceIds(group) {
  return [...new Set(group.levels.flatMap(l=>{if(l.deviceId)return [l.deviceId];const match=/^topo:([^.]+)\./.exec(l.id);return match?[match[1]]:[];}))];
}
export function deviceCatalog(groups,reported=[]) {
  const catalog=new Map(reported.map(d=>[d.id,{id:d.id,name:d.name||d.id,groupIds:[]}]));
  for(const g of groups)for(const id of deviceIds(g)){if(!catalog.has(id))catalog.set(id,{id,name:id,groupIds:[]});catalog.get(id).groupIds.push(g.id);}
  return [...catalog.values()].filter(d=>d.groupIds.length).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
}
export function contextGroups(groups,context,scope,folders=[],tags=g=>g.tags||[]) {
  if(!context)return [];
  let allowed;
  if(context.type==='folder')allowed=new Set(folders.find(f=>f.id===context.id)?.groupIds||[]);
  return groups.filter(g=>(scope==='both'||supportsSide(g,scope))&&(
    context.type==='all'||context.type==='tag'&&tags(g).includes(context.id)||context.type==='device'&&deviceIds(g).includes(context.id)||context.type==='group'&&g.id===context.id||context.type==='folder'&&allowed.has(g.id)));
}
export function takePlan(state,source,destination,policy='disconnect',now=Date.now()) {
  if(!state)return {reason:'Waiting for inventory'};
  if(state.error||!Number.isFinite(Date.parse(state.lastSync))||now-Date.parse(state.lastSync)>(state.syncSeconds||5)*3000)return {reason:'Disconnected or stale inventory — routing unavailable'};
  if(!state.canWrite)return {reason:'This connection is read-only'};
  if(!destination)return {reason:'Select a destination'};
  if(!source)return {reason:'Select a source'};
  const plan=routeCompatibility(source,destination,undefined,new Set(state.routes.filter(r=>r.locked).map(r=>r.to)),policy);
  return {...plan,reason:plan.status==='unavailable'?plan.reason||'No matching content IDs':'',warning:plan.status==='partial'?plan.reason:''};
}
