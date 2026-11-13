function patchItems(items,patch) {
  if(!patch)return items;
  if(!Array.isArray(patch.upsert)||!Array.isArray(patch.remove))throw new Error('Invalid live patch');
  const map=new Map(items.map(item=>[item.id,item]));
  for(const id of patch.remove)map.delete(id);
  for(const item of patch.upsert){if(!item?.id)throw new Error('Invalid live entity');map.set(item.id,item);}
  return [...map.values()];
}
export function applyLiveMessage(state,message) {
  if(message.type==='snapshot'){
    const data=message.data;
    if(!Array.isArray(data?.groups)||!Array.isArray(data?.routes)||!data.metadata||!Number.isFinite(data.revision))throw new Error('Invalid live snapshot');
    return state&&data.revision<state.revision?{ignored:true}:{state:data,changed:true};
  }
  if(message.type!=='patch'||!state||!Number.isFinite(message.data?.revision))throw new Error('Live snapshot required');
  const revision=message.data.revision;
  if(revision<state.revision||(revision===state.revision&&message.baseRevision<revision))return {ignored:true};
  if(message.baseRevision!==state.revision)throw new Error('Live revision gap');
  return {state:{...state,...message.data,groups:patchItems(state.groups,message.groups),routes:patchItems(state.routes,message.routes),metadata:message.metadata||state.metadata},changed:!!(message.groups||message.routes||message.metadata||JSON.stringify(state.aliasSets)!==JSON.stringify(message.data.aliasSets)||JSON.stringify(state.devices)!==JSON.stringify(message.data.devices))};
}

export class LiveUpdates {
  constructor({url,getState,onSnapshot,onStatus,onConnection,refresh,WebSocketClass=globalThis.WebSocket,retryMs=500,pollMs=1000,watchdogMs=45000}={}){
    Object.assign(this,{url,getState,onSnapshot,onStatus,onConnection,refresh,WebSocketClass,retryMs,pollMs,watchdogMs});
    this.connected=false;this.stopped=true;this.attempt=0;
  }
  start(){this.stopped=false;this.fallback=setInterval(()=>{if(!this.connected)void this.refresh(false);},this.pollMs);this.connect();}
  ready(value){if(this.connected===value)return;this.connected=value;this.onConnection(value);}
  connect(){
    if(this.stopped)return;
    let socket;try{socket=this.socket=new this.WebSocketClass(this.url);}catch{return this.reconnectLater();}
    let lastMessage=Date.now();
    socket.onmessage=event=>{
      if(socket!==this.socket)return;lastMessage=Date.now();
      try{
        const message=JSON.parse(event.data);if(message.type==='heartbeat')return;
        const result=applyLiveMessage(this.getState(),message);
        if(!result.ignored)(result.changed?this.onSnapshot:this.onStatus)(result.state);
        this.attempt=0;this.ready(true);
      }catch{void this.resynchronize(socket);}
    };
    socket.onclose=()=>{if(socket!==this.socket)return;clearInterval(this.watchdog);this.ready(false);if(!this.stopped){void this.refresh(false);this.reconnectLater();}};
    socket.onerror=()=>{if(socket===this.socket)this.ready(false);};
    this.watchdog=setInterval(()=>{if(Date.now()-lastMessage>this.watchdogMs){this.ready(false);socket.close();}},Math.min(this.watchdogMs,15000));
  }
  async resynchronize(socket){
    this.ready(false);
    if(this.recovering)return;
    this.recovering=true;
    try{await this.refresh(true);if(socket===this.socket&&socket.readyState===1&&this.getState())this.ready(true);}
    finally{this.recovering=false;}
  }
  reconnectLater(){if(this.stopped)return;clearTimeout(this.retry);const delay=Math.min(15000,this.retryMs*2**Math.min(this.attempt++,5));this.retry=setTimeout(()=>this.connect(),delay);}
  stop(){this.stopped=true;clearTimeout(this.retry);clearInterval(this.fallback);clearInterval(this.watchdog);this.socket?.close();this.ready(false);}
}
