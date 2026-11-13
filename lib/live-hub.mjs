import WebSocket,{WebSocketServer} from 'ws';

function changes(previous,next) {
  if(previous===next)return null;
  const before=new Map(previous.map(item=>[item.id,JSON.stringify(item)])),ids=new Set(next.map(item=>item.id));
  const upsert=next.filter(item=>before.get(item.id)!==JSON.stringify(item)),remove=previous.filter(item=>!ids.has(item.id)).map(item=>item.id);
  return upsert.length||remove.length?{upsert,remove}:null;
}
export class LiveHub {
  constructor(server,{authenticated,snapshot,heartbeatMs=15000,upgrades={}}={}) {
    Object.assign(this,{snapshot});
    this.last=snapshot();this.metadata=JSON.stringify(this.last.metadata);
    this.wss=new WebSocketServer({noServer:true,maxPayload:1024,perMessageDeflate:false});
    server.on('upgrade',(request,socket,head)=>{
      socket.on('error',()=>{});
      const reject=status=>{socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);};
      const pathname=new URL(request.url,'http://localhost').pathname;
      // Engine services (multicast probe) own their own upgrade paths and authenticate themselves.
      if(upgrades[pathname])return upgrades[pathname](request,socket,head);
      if(pathname!=='/api/live')return reject('404 Not Found');
      if(!authenticated(request))return reject('401 Unauthorized');
      let sameOrigin=false;try{sameOrigin=new URL(request.headers.origin).host===request.headers.host;}catch{}
      if(!sameOrigin)return reject('403 Forbidden');
      if(this.wss.clients.size>=200)return reject('503 Service Unavailable');
      this.wss.handleUpgrade(request,socket,head,ws=>this.wss.emit('connection',ws));
    });
    this.wss.on('connection',socket=>{
      socket.alive=true;socket.on('pong',()=>{socket.alive=true;});socket.on('error',()=>{});
      socket.on('message',()=>socket.close(1008,'This stream is read-only'));
      this.send(socket,{type:'snapshot',data:this.snapshot()});
    });
    this.heartbeat=setInterval(()=>{
      for(const socket of this.wss.clients){
        if(!socket.alive){socket.terminate();continue;}
        socket.alive=false;socket.ping();this.send(socket,{type:'heartbeat'});
      }
    },heartbeatMs);this.heartbeat.unref();
  }
  send(socket,message) {
    if(socket.readyState!==WebSocket.OPEN)return;
    if(socket.bufferedAmount>4*1024*1024){socket.terminate();return;}
    socket.send(typeof message==='string'?message:JSON.stringify(message));
  }
  publish(next=this.snapshot()) {
    const {groups,routes,metadata,...status}=next;
    const message={type:'patch',baseRevision:this.last.revision,data:status};
    const groupChanges=changes(this.last.groups,groups),routeChanges=changes(this.last.routes,routes),metadataText=JSON.stringify(metadata);
    if(groupChanges)message.groups=groupChanges;if(routeChanges)message.routes=routeChanges;
    if(this.metadata!==metadataText)message.metadata=metadata;
    this.last=next;this.metadata=metadataText;
    const wire=JSON.stringify(message);for(const socket of this.wss.clients)this.send(socket,wire);
  }
  close(){clearInterval(this.heartbeat);for(const socket of this.wss.clients)socket.terminate();this.wss.close();}
}
