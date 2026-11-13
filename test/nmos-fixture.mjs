import http from 'node:http';
export async function mockNmos() {
  const state={fail:false,redirect:false,requests:[],manifest:null};let base;
  const sdp='v=0\r\ns=Camera test\r\nt=0 0\r\nm=video 5000 RTP/AVP 96\r\nc=IN IP4 239.1.2.3/32\r\na=mid:A\r\nm=video 5002 RTP/AVP 96\r\nc=IN IP4 239.2.2.3/32\r\na=mid:B\r\n';
  const server=http.createServer((req,res)=>{
    state.requests.push({url:req.url,method:req.method,auth:req.headers.authorization});
    if(state.fail){res.statusCode=503;return res.end('{}');}
    const url=new URL(req.url,base),type=url.pathname.split('/').filter(Boolean).at(-1);
    const resources={nodes:[{id:'node-1',label:'Studio node',href:base}],devices:[{id:'device-1',node_id:'node-1',label:'Camera chassis',controls:[{type:'urn:x-nmos:control:sr-ctrl/v1.1',href:base+'/x-nmos/connection/v1.1/'}]}],senders:[{id:'sender-1',device_id:'device-1',flow_id:'flow-1',label:'Camera 2 <script>',manifest_href:state.manifest??base+'/manifest',tags:{'urn:x-nmos:tag:grouphint':['Camera:Video']}}],receivers:[{id:'receiver-1',device_id:'device-1',label:'Monitor 1',subscription:{active:false,sender_id:null}}],sources:[{id:'source-1',device_id:'device-1',label:'Camera source'}],flows:[{id:'flow-1',device_id:'device-1',source_id:'source-1',media_type:'video/raw',label:'Video flow'}]};
    Object.assign(resources,state.resources||{});
    res.setHeader('Content-Type','application/json');
    if(['/x-nmos/node/','/x-nmos/query/'].includes(url.pathname))return res.end(JSON.stringify(['v1.2/','v1.3/']));
    if(url.pathname==='/manifest'||type==='transportfile'){
      if(state.redirect){res.writeHead(302,{Location:base+'/redirect-target'});return res.end();}
      res.setHeader('Content-Type','application/sdp');return res.end(sdp);
    }
    if(type==='active')return res.end(JSON.stringify({master_enable:false,transport_file:{data:sdp},transport_params:[]}));
    if(url.pathname.startsWith('/x-nmos/node/v1.3/'))return res.end(JSON.stringify(type==='self'?resources.nodes[0]:resources[type]||[]));
    if(url.pathname.startsWith('/x-nmos/query/v1.3/')){
      if(type==='senders'&&!url.searchParams.has('paging.until')){
        res.setHeader('X-Paging-Limit','1');res.setHeader('Link',`<${base}/x-nmos/query/v1.3/senders/?paging.until=10:0>; rel="prev", <${base}/x-nmos/query/v1.3/senders/?paging.since=20:0>; rel="next"`);
        return res.end(JSON.stringify(resources.senders));
      }
      if(type==='senders')return res.end(JSON.stringify([{id:'sender-2',device_id:'device-1',label:'Camera 10'}]));
      return res.end(JSON.stringify(resources[type]||[]));
    }
    res.statusCode=404;res.end('{}');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  return {base,state,sdp,close:()=>new Promise(r=>server.close(r))};
}
