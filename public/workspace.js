export const columns=[
  {id:'expand',label:'Levels dropdown',width:30,min:28,filter:false,sort:false},
  {id:'favorite',label:'Favorite',width:30,min:28,filter:false,sort:false},
  {id:'name',label:'Display name',width:190,min:130},
  {id:'system',label:'System name',width:180,min:120},
  {id:'alias',label:'All aliases',width:170,min:110,defaultHidden:true},
  {id:'type',label:'Type',width:90,min:75},
  {id:'current',label:'Current route',width:260,min:180},
  {id:'tags',label:'Tags',width:160,min:100},
  {id:'multicast',label:'Multicast address',width:185,min:120},
  {id:'sourceAddress',label:'Source address',width:185,min:120},
  {id:'sdp',label:'SDP',width:56,min:48,filter:false,sort:false},
];
export function workspaceColumns(aliasSets=[],spacers=[]) {
  const all=[...columns];
  all.splice(5,0,...aliasSets.map(s=>({id:'alias:'+s.id,aliasId:s.id,label:s.label.trim()||s.id,width:170,min:100})));
  return [...all,...spacers.filter(s=>/^spacer:[a-z0-9-]+$/i.test(s.id)).slice(0,20).map((s,i)=>({id:s.id,label:'Spacer '+(i+1),width:24,min:8,spacer:true,filter:false,sort:false}))];
}
export function columnLayout(saved={},definitions=workspaceColumns([],saved?.spacers||[])) {
  const ids=new Set(definitions.map(c=>c.id));
  const oldOrder=Array.isArray(saved.order)?saved.order:[];
  const legacySdp=['sdpSource','sdpDestination','sdpRoute'];
  const order=[...new Set(oldOrder.map(id=>legacySdp.includes(id)?'sdp':id).filter(id=>ids.has(id)))];
  for(const id of ['favorite','expand'])if(ids.has(id)&&!order.includes(id))order.unshift(id);
  for(const {id} of definitions)if(!order.includes(id))order.push(id);
  const widths=Object.fromEntries(definitions.map(c=>[c.id,Math.max(c.min,Math.min(700,Number(saved.widths?.[c.id])||c.width))]));
  let hidden=Array.isArray(saved.hidden)?[...new Set(saved.hidden.filter(id=>ids.has(id)))]:[];
  if(ids.has('sdp')&&!hidden.includes('sdp')&&!oldOrder.includes('sdp')&&legacySdp.every(id=>saved.hidden?.includes(id)))hidden.push('sdp');
  for(const c of definitions)if(c.defaultHidden&&!oldOrder.includes(c.id)&&!hidden.includes(c.id))hidden.push(c.id);
  if(!definitions.some(c=>!c.spacer&&!hidden.includes(c.id)))hidden=hidden.filter(id=>id!=='name');
  return {order,widths,hidden,spacers:definitions.filter(c=>c.spacer).map(c=>({id:c.id}))};
}
export function aliasText(group,set='') {
  return set?group.aliases?.[set]||'':Object.values(group.aliases||{}).join(' · ');
}
export function namedGroup(group,set='') {
  return {...group,defaultName:group.name,name:group.aliases?.[set]||group.name};
}
export function networkValues(group,level,field) {
  return [...new Set((level?[level]:group.levels).flatMap(l=>l.network?.legs||[]).map(leg=>field==='multicast'?leg.multicast:leg.source).filter(Boolean))];
}
