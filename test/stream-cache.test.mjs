import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSdp,sdpView} from '../lib/stream-cache.mjs';
import {junctionEndpoints} from '../public/route-options.js';
const sender='11111111-1111-4111-8111-111111111111',receiver='22222222-2222-4222-8222-222222222222';
const source='topo:dev.module.0S'+sender,destination='topo:dev.module.1R'+receiver;
const sdp='v=0\r\no=- 1 1 IN IP4 10.0.0.1\r\ns=Test\r\nt=0 0\r\na=group:DUP A B\r\nm=video 5000 RTP/AVP 96\r\nc=IN IP4 232.1.1.1/64\r\na=source-filter: incl IN IP4 232.1.1.1 10.0.0.1\r\na=mid:A\r\nm=video 5002 RTP/AVP 96\r\nc=IN IP4 234.1.1.1/64\r\na=source-filter: incl IN IP4 234.1.1.1 10.0.1.1\r\na=mid:B\r\n';
const groups=[{id:'s',side:'source',name:'Camera',levels:[{id:source,key:'Video',name:'Video'}]},{id:'d',side:'destination',name:'Monitor',levels:[{id:destination,key:'Video',name:'Video'}]}],routes=[{from:source,to:destination}];

test('virtual junction metadata follows physical endpoints across chains and fanout without looping or synthesizing SDP',()=>{
  const all=[...groups,{id:'j',side:'bidirectional',name:'Patch',levels:[{id:'jun:1',key:'Video',name:'Video'}]}];
  const chain=[{from:source,to:'jun:1'},{from:'jun:1',to:'jun:2'},{from:'jun:2',to:destination},{from:'jun:2',to:'otherReceiver'}];
  const cache={entries:new Map([[source,{sdp}],[destination,{sdp:'receiver SDP'}]])};
  assert.deepEqual(junctionEndpoints('jun:2',chain),[source]);
  assert.deepEqual(new Set(junctionEndpoints('jun:1',chain,'destination')),new Set([destination,'otherReceiver']));
  assert.deepEqual(junctionEndpoints('jun:1',[{from:'jun:2',to:'jun:1'},{from:'jun:1',to:'jun:2'}]),[]);
  const src=sdpView(all,chain,cache,{groupId:'j',view:'source',side:'destination'});assert.equal(src.blocks[0].endpoint,source);assert.equal(src.blocks[0].sdp,sdp);
  const dst=sdpView(all,chain,cache,{groupId:'j',view:'destination',side:'source'});assert.equal(dst.blocks.length,2);assert(dst.blocks.some(b=>b.endpoint===destination&&b.sdp==='receiver SDP'));
  const route=sdpView(all,chain,cache,{groupId:'j',view:'route',side:'destination'});assert.equal(route.blocks[0].role,'Source');assert.equal(route.blocks[0].endpoint,source);
  assert.throws(()=>sdpView(all,chain,cache,{groupId:'j',view:'route'}),/side/);
  const empty=sdpView(all,[],cache,{groupId:'j',view:'source',side:'source'});assert.equal(empty.blocks[0].sdp,'');assert.match(empty.blocks[0].error,/No physical source/);
});
test('SDP parsing preserves both legs, source filters, ports and mids',()=>{
  assert.deepEqual(parseSdp(sdp),[{multicast:'232.1.1.1',source:'10.0.0.1',port:'5000',mid:'A'},{multicast:'234.1.1.1',source:'10.0.1.1',port:'5002',mid:'B'}]);
  assert.deepEqual(parseSdp('v=0\nc=IN IP4 239.1.1.1\nm=audio 5004 RTP/AVP 97\na=mid:audio\n')[0].multicast,'239.1.1.1');
});
test('source, destination and current route views remain distinct and do not invent SDP for absent levels',()=>{
  const cache={entries:new Map([[source,{sdp,updatedAt:'2026-10-15T00:00:00Z'}]])};
  assert.equal(sdpView(groups,routes,cache,{groupId:'d',view:'source'}).blocks[0].endpoint,source);
  const dst=sdpView(groups,routes,cache,{groupId:'d',view:'destination'});assert.equal(dst.blocks[0].endpoint,destination);assert.equal(dst.blocks[0].sdp,'');assert.match(dst.blocks[0].error,/No SDP/);
  assert.deepEqual(sdpView(groups,routes,cache,{groupId:'d',view:'route'}).blocks.map(b=>b.role),['Source','Destination']);
  assert.equal(sdpView(groups,[],cache,{groupId:'s',view:'destination'}).blocks.length,0);
  assert.throws(()=>sdpView(groups,routes,cache,{groupId:'d',view:'unknown'}),/Unknown/);
});
