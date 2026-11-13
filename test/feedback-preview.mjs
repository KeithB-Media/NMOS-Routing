// Isolated browser QA fixture. No real controller or credentials are used.
import http from 'node:http';
import WebSocket,{WebSocketServer} from 'ws';
import {spawn} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const group=(id,type,label)=>({_id:id,type,descriptor:{label,desc:'Isolated feedback preview'},endpoints:{'SMPTE211020-1':{endpointId:'topo:'+id+':v',profileId:'v'},'SMPTE211030-1':{endpointId:'topo:'+id+':a',profileId:'a'}}});
const groups=[group('camera1','sourceGroup','Camera 1'),group('camera2','sourceGroup','Camera 2'),group('delay','destinationGroup','01 · Delayed success'),group('reject','destinationGroup','02 · Rejected route'),group('instant','destinationGroup','03 · Immediate success')];
groups.push({_id:'schema-order',type:'destinationGroup',schemaId:'five',descriptor:{label:'00 · Schema order'},endpoints:Object.fromEntries(['ANC','Audio Z','Audio X','Video','Audio Y'].map(key=>[key,{endpointId:'order:'+key,profileId:key}]))});
const schemas=[{_id:'five',entries:['Video','Audio X','Audio Y','Audio Z','ANC'].map(contentId=>({contentId}))}];
groups.push({_id:'grp:preview-junction',type:'bidirGroup',_rev:'1',descriptor:{label:'05 · Virtual junction'},endpoints:Object.fromEntries(['Video','Audio','ANC'].map(key=>[key,{endpointId:'jun:preview-'+key,profileId:null}]))});
const aliasConfig={aliasKeys:{_items:[{_id:'engineering',label:'Engineering'},{_id:'operations',label:'Operations'}]},aliasNames:{_items:groups.map(g=>({_id:g._id,_rev:'1',names:{engineering:'ENG '+g.descriptor.label,operations:'OPS '+g.descriptor.label}}))}};
const sdpIds=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const rxIds=['44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666'];
const content=['Video','Audio','ANC'];
for(const [side,ids]of [['source',sdpIds],['destination',rxIds]])groups.push({_id:'sdp-'+side,type:side+'Group',descriptor:{label:'04 · SDP '+side},endpoints:Object.fromEntries(ids.map((id,i)=>[content[i],{endpointId:'topo:nmos.module.'+i+(side==='source'?'S':'R')+id,profileId:content[i]}]))});
const sampleSdp=i=>`v=0\r\no=- 1 1 IN IP4 10.0.0.1\r\ns=Isolated ${content[i]} SDP\r\nt=0 0\r\na=group:DUP A B\r\nm=${i===1?'audio':'video'} 5000 RTP/AVP 96\r\nc=IN IP4 232.1.1.${i+1}/64\r\na=source-filter: incl IN IP4 232.1.1.${i+1} 10.0.0.1\r\na=mid:A\r\nm=${i===1?'audio':'video'} 5002 RTP/AVP 96\r\nc=IN IP4 234.1.1.${i+1}/64\r\na=source-filter: incl IN IP4 234.1.1.${i+1} 10.0.1.1\r\na=mid:B\r\n`;
const recorded=JSON.parse(await readFile(path.join(root,'demo-inventory.json'),'utf8')).groups;
const example=recorded.filter(g=>g.name==='DDR 72'||g.name==='RPLY 43');
groups.push(...example.map(g=>({_id:g.id,type:g.side+'Group',descriptor:{label:g.name,desc:g.description},endpoints:Object.fromEntries(g.levels.map(l=>[l.key,{endpointId:l.id,profileId:l.profileId}]))})));
for(const g of groups)g._rev||='1';
const destination=example.find(g=>g.name==='DDR 72'&&g.side==='destination'),existing=example.find(g=>g.name==='DDR 72'&&g.side==='source');
let sequence=0;
let services=[{connection:{id:'keep-audio2',rev:'1',from:existing.levels.find(l=>l.name==='Audio 2').id,to:destination.levels.find(l=>l.name==='Audio 2').id,generic:{locked:false,state:1}}}];
services.push(...sdpIds.map((id,i)=>({connection:{id:'sdp-route-'+i,rev:'1',from:'topo:nmos.module.'+i+'S'+id,to:'topo:nmos.module.'+i+'R'+rxIds[i],generic:{locked:false,state:1}}})));
const mock=http.createServer(async(req,res)=>{
  const base='http://127.0.0.1:'+mock.address().port;
  if(req.method==='GET'&&req.url==='/x-nmos/node/v1.3/senders/')return res.end(JSON.stringify(sdpIds.map((id,i)=>({id,manifest_href:base+'/manifest/'+i}))));
  if(req.method==='GET'&&req.url.startsWith('/manifest/'))return res.end(sampleSdp(Number(req.url.split('/').pop())));
  if(req.method==='GET'&&req.url.endsWith('/active')){const id=req.url.split('/').at(-2),index=rxIds.indexOf(id);return res.end(JSON.stringify({master_enable:true,transport_file:{data:sampleSdp(index)},transport_params:[]}));}
  if(req.url==='/panel-test') {
    res.setHeader('Content-Type','text/html');
    return res.end('<!doctype html><title>Route Desk panel embedding check</title><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe title="Route Desk" src="http://127.0.0.1:8195/embed"></iframe>');
  }
  if(!['POST','PATCH'].includes(req.method)){res.writeHead(404);return res.end();}
  let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);
  res.setHeader('Content-Type','application/json');
  if(req.method==='PATCH'){
    const alias=req.url.endsWith('/aliasNames'),items=alias?aliasConfig.aliasNames._items:groups;
    if(request.actions.some(a=>{const current=items.find(i=>i._id===a._id);return (a._action==='update'&&current?._rev!==a._rev)||(a._action==='add'&&current);}))return res.end(JSON.stringify({header:{error:'Revision conflict'}}));
    const updated=request.actions.map(a=>{
      const current=items.find(i=>i._id===a._id),value={...current,...a,_rev:String(Number(current?._rev||0)+1)};delete value._action;
      if(current)Object.assign(current,value);else items.push(value);
      return {_id:a._id,_rev:value._rev};
    });
    for(const socket of nativeStreams.clients)if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({channel:'subsc',messageId:alias?4:1,id:'native'+(alias?4:1),payload:{data:{_e:'u'}}}));
    return res.end(JSON.stringify({header:{ok:true,code:'OK'},result:{items:updated}}));
  }
  if(req.url==='/rest/v2/data'&&request.path==='/status/devman/devices/**')return res.end(JSON.stringify({data:{status:{devman:{devices:{_items:[{_id:'nmos',deviceInfo:{report:[{field:{value:base+'/x-nmos/node/v1.3/'}},{field:{value:base+'/x-nmos/connection/v1.0/'}}]},modules:[{id:'module',ports:[...sdpIds.map((id,i)=>({id:i+'S'+id})),...rxIds.map((id,i)=>({id:i+'R'+id}))]}]}]}}}}}));
  if(req.url==='/rest/v2/data')return res.end(JSON.stringify(request.path==='/config/aliasnames/**'?{data:{config:{aliasnames:aliasConfig}}}:request.path.startsWith('/config')?{data:{config:{endpoint:{endpointGroups:{_items:groups},endpointGroupSchemas:{_items:schemas}}}}}:{data:{status:{conman:{services:{_items:services}}}}}));
  const entries=request.data.entries,disconnect=req.url==='/api/disconnect';
  const targeted=disconnect?services.filter(s=>entries.some(e=>e.id===s.connection.id)).map(s=>s.connection):entries;
  const rejected=targeted.some(e=>e.to.includes('reject'));
  const commit=()=>{
    if(disconnect)services=services.filter(s=>!entries.some(e=>e.id===s.connection.id&&e.rev===s.connection.rev));
    else {services=services.filter(s=>!entries.some(e=>e.to===s.connection.to));services.push(...entries.map(e=>({connection:{...e,id:String(++sequence),rev:'1',generic:{locked:false,state:1}}})));}
    for(const socket of nativeStreams.clients)if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({channel:'subsc',messageId:2,id:'native2',payload:{data:{_e:'u'}}}));
  };
  if(!rejected){if(targeted.some(e=>e.to.includes('delay')))setTimeout(commit,6000);else commit();}
  res.end(JSON.stringify({data:{entries:entries.map(()=>({result:{ok:!rejected}}))}}));
});
const nativeStreams=new WebSocketServer({noServer:true});
mock.on('upgrade',(req,socket,head)=>nativeStreams.handleUpgrade(req,socket,head,ws=>nativeStreams.emit('connection',ws)));
nativeStreams.on('connection',socket=>socket.on('message',raw=>{
  const message=JSON.parse(raw);socket.send(JSON.stringify({channel:message.channel,messageId:message.messageId,id:'native'+message.messageId,payload:{data:{}}}));
}));
await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const dataDir=path.join(root,'test-output','feedback-preview');await mkdir(dataDir,{recursive:true});
const app=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'8195',HOST:'127.0.0.1',VIP_MODE:'live',VIP_URL:`http://127.0.0.1:${mock.address().port}`,VIP_USERNAME:'test',VIP_PASSWORD:'test-only',VIP_WRITE_ENABLED:'true',UI_PASSWORD:'',DATA_DIR:dataDir,SYNC_INTERVAL_SECONDS:'1',EMBED_ALLOWED_ORIGINS:`http://127.0.0.1:${mock.address().port}`},stdio:['ignore','inherit','inherit']});
console.log(`Panel embedding preview: http://127.0.0.1:${mock.address().port}/panel-test`);
function stop(){app.kill();for(const socket of nativeStreams.clients)socket.terminate();nativeStreams.close();mock.closeAllConnections();mock.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);app.on('exit',()=>mock.close());
