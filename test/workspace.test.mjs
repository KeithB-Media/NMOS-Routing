import {test} from 'node:test';
import assert from 'node:assert/strict';
import {columns,workspaceColumns,columnLayout,namedGroup,aliasText,networkValues} from '../public/workspace.js';
import {groupSearchFields} from '../public/route-options.js';
import {compileSearch} from '../public/search.js';

test('saved layout tolerates new columns, duplicates and invalid widths while keeping at least one visible column',()=>{
  const layout=columnLayout({order:['tags','name','tags','unknown'],widths:{tags:200,name:1,current:900},hidden:['name','current','alias','unknown']});
  assert.deepEqual(layout.order.slice(0,4),['expand','favorite','tags','name']);assert.equal(new Set(layout.order).size,columns.length);
  assert.deepEqual(layout.hidden,['name','current','alias']);assert.equal(layout.widths.name,130);assert.equal(layout.widths.current,700);
  assert.deepEqual(columnLayout(JSON.parse(JSON.stringify(layout))),layout);
  assert(!columnLayout({hidden:layout.order}).hidden.includes('name'));
});
test('each alias gets a visible column, spacers persist, and old layout preferences migrate',()=>{
  const defs=workspaceColumns([{id:'eng',label:'ENG'},{id:'ops',label:'OPS'}],[{id:'spacer:one'}]);
  const saved=columnLayout({order:['name','current'],hidden:['system'],spacers:[{id:'spacer:one'}]},defs);
  for(const id of ['expand','favorite','multicast','sourceAddress','sdp','alias:eng','alias:ops','spacer:one'])assert(saved.order.includes(id));
  assert(!saved.hidden.includes('alias:eng'));assert(!saved.hidden.includes('alias:ops'));
  assert.equal(saved.spacers[0].id,'spacer:one');assert.deepEqual(columnLayout(saved,defs),saved);
  assert.deepEqual(networkValues({levels:[{network:{legs:[{multicast:'232.1.1.1',source:'10.0.0.1'},{multicast:'234.1.1.1',source:'10.0.1.1'}]}}]},null,'sourceAddress'),['10.0.0.1','10.0.1.1']);
});
test('name sets select VIP aliases consistently while original names remain searchable',()=>{
  const g={id:'g',name:'System camera',system:'System camera',aliases:{eng:'CAM-01',ops:'Studio 1'},levels:[]};
  const named=namedGroup(g,'eng');
  assert.equal(named.name,'CAM-01');assert.equal(named.defaultName,'System camera');assert.equal(named.id,g.id);
  assert.equal(namedGroup(g,'missing').name,'System camera');assert.equal(aliasText(g,'eng'),'CAM-01');
  const fields=groupSearchFields(named);
  for(const term of ['CAM-01','Studio 1','System camera'])assert(compileSearch(term)(fields));
});

test('three legacy SDP columns migrate to one menu in place and preserve visibility preferences',()=>{
  const legacy=['sdpSource','sdpDestination','sdpRoute'];
  const saved={order:['expand','favorite','name','sdpDestination','tags','sdpSource','sdpRoute','system'],widths:{name:225,tags:180,sdpSource:100},hidden:['system','sdpSource']};
  const layout=columnLayout(saved);
  assert.deepEqual(layout.order.slice(0,7),['expand','favorite','name','sdp','tags','system','alias']);
  assert.equal(layout.widths.name,225);assert.equal(layout.widths.tags,180);assert.equal(layout.widths.sdp,56);
  assert(!layout.hidden.includes('sdp'));assert(layout.hidden.includes('system'));
  for(const id of legacy){assert(!layout.order.includes(id));assert(!(id in layout.widths));assert(!layout.hidden.includes(id));}
  assert(columnLayout({...saved,hidden:legacy}).hidden.includes('sdp'));
  assert.deepEqual(columnLayout(layout),layout);
});
