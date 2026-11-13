import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import WebSocket,{WebSocketServer} from 'ws';
import {LiveHub} from '../lib/live-hub.mjs';
import {applyLiveMessage,LiveUpdates} from '../public/live-updates.js';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await delay(20);}throw new Error('Live update timed out');}
const initial=()=>({revision:1,groups:[{id:'g',name:'Monitor'}],routes:[{id:'r',from:'s1',to:'d'}],metadata:{tags:{},favorites:[],activity:[]},lastSync:'now',error:null});
function packet(socket,predicate=()=>true){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.off('message',listener);reject(new Error('Missing WebSocket message'));},5000);
  function listener(raw){const message=JSON.parse(raw);if(predicate(message)){clearTimeout(timer);socket.off('message',listener);resolve(message);}}
  socket.on('message',listener);
});}

test('browser stream authenticates, rejects foreign origins, sends deltas, and is read-only',async t=>{
  let state=initial();const server=http.createServer();
  const hub=new LiveHub(server,{snapshot:()=>state,authenticated:req=>req.headers.authorization==='Basic test'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{hub.close();await new Promise(r=>server.close(r));});
  const origin=`http://127.0.0.1:${server.address().port}`,url=origin.replace('http:','ws:')+'/api/live';
  async function rejected(headers){return new Promise(resolve=>{const socket=new WebSocket(url,{headers});socket.on('error',()=>{});socket.on('unexpected-response',(_,response)=>{response.resume();socket.terminate();resolve(response.statusCode);});});}
  assert.equal(await rejected({Origin:origin}),401);
  assert.equal(await rejected({Origin:'http://other.example',Authorization:'Basic test'}),403);
  const socket=new WebSocket(url,{origin,headers:{Authorization:'Basic test'}});socket.on('error',()=>{});
  const snapshot=await packet(socket);assert.equal(snapshot.type,'snapshot');
  const changed=packet(socket,m=>m.type==='patch');state={...state,revision:2,routes:[{id:'r',from:'s2',to:'d'}]};hub.publish();
  const delta=await changed;assert.equal(delta.groups,undefined);assert.equal(delta.routes.upsert.length,1);
  assert.equal(applyLiveMessage(snapshot.data,delta).state.routes[0].from,'s2');
  const metadata=packet(socket,m=>!!m.metadata);state.metadata.tags.g=['Production'];state={...state,revision:3};hub.publish();
  const metadataDelta=await metadata;assert.deepEqual(metadataDelta.metadata.tags.g,['Production'],'in-place metadata changes must be broadcast');assert.equal(metadataDelta.baseRevision,2);
  const closed=new Promise(r=>socket.once('close',r));socket.send('route something');assert.equal(await closed,1008);
});

test('client patch reconciliation rejects gaps and ignores a delayed patch already covered by HTTP',()=>{
  const state=initial();
  assert.throws(()=>applyLiveMessage(state,{type:'patch',baseRevision:0,data:{revision:2}}),/gap/);
  assert.deepEqual(applyLiveMessage({...state,revision:2},{type:'patch',baseRevision:1,data:{revision:2},routes:{upsert:[],remove:['r']}}),{ignored:true});
  const removed=applyLiveMessage(state,{type:'patch',baseRevision:1,data:{revision:2},routes:{upsert:[],remove:['r']}});
  assert.equal(removed.state.routes.length,0);assert.equal(removed.state.groups,state.groups);
});

test('browser reconnects, falls back to HTTP, and resynchronizes a revision gap',async t=>{
  class FakeSocket {
    static sockets=[];
    constructor(){this.readyState=1;FakeSocket.sockets.push(this);}
    close(){this.readyState=3;this.onclose?.();}
    message(value){this.onmessage({data:JSON.stringify(value)});}
  }
  let state=initial(),polls=0,forced=0;const connections=[];
  const updates=new LiveUpdates({url:'ws://test',WebSocketClass:FakeSocket,getState:()=>state,onSnapshot:s=>state=s,onStatus:s=>state=s,onConnection:value=>connections.push(value),refresh:async force=>{polls++;if(force){forced++;state={...state,revision:9};}},retryMs:10,pollMs:10,watchdogMs:1000});
  updates.start();t.after(()=>updates.stop());
  FakeSocket.sockets[0].message({type:'snapshot',data:state});assert(updates.connected);
  FakeSocket.sockets[0].message({type:'patch',baseRevision:7,data:{revision:8}});
  await until(()=>forced===1);await delay(0);assert.equal(state.revision,9);
  FakeSocket.sockets[0].close();await until(()=>FakeSocket.sockets.length===2);assert(polls>0);assert.equal(updates.connected,false);
  FakeSocket.sockets[1].message({type:'snapshot',data:state});assert(updates.connected);assert(connections.includes(false));
});
