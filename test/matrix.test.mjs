import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matrixColumns,matrixCrosspoint} from '../public/matrix.js';
const source={id:'s',side:'source',name:'Camera',levels:[{id:'sv',key:'Video'},{id:'sa',key:'Audio'}]};
const destination={id:'d',side:'destination',name:'Monitor',levels:[{id:'dv',key:'Video'},{id:'da',key:'Audio'}]};
test('matrix axes switch groups and endpoints and include junctions on either side',()=>{
  const groups=[source,destination,{...source,id:'j',side:'bidirectional'}];
  assert.equal(matrixColumns(groups,'destination','groups').length,2);
  assert.equal(matrixColumns(groups,'source','endpoints').length,4);
  assert.equal(matrixColumns(groups,'destination','groups',fields=>fields.includes('Camera')).length,2);
});
test('matrix tracks full and breakaway routes in either orientation',()=>{
  const routes=new Map([['dv',[{from:'sv',to:'dv'}]]]);
  let plan=matrixCrosspoint({g:destination},{g:source},'destination',routes,new Set(),'disconnect');
  assert.equal(plan.partial,true);assert.equal(plan.active,false);
  routes.set('da',[{from:'sa',to:'da'}]);
  plan=matrixCrosspoint({g:source},{g:destination},'source',routes,new Set(),'disconnect');
  assert.equal(plan.active,true);assert.equal(plan.source.id,'s');assert.equal(plan.destination.id,'d');
});
test('endpoint crosspoints reject mismatched content, honor locks, and route only one level',()=>{
  const row={g:destination,level:destination.levels[0]};
  assert.equal(matrixCrosspoint(row,{g:source,level:source.levels[1]},'destination',new Map(),new Set(),'disconnect').status,'unavailable');
  const column={g:source,level:source.levels[0]};
  assert.equal(matrixCrosspoint(row,column,'destination',new Map(),new Set(['dv']),'disconnect').status,'unavailable');
  const plan=matrixCrosspoint(row,column,'destination',new Map(),new Set(),'disconnect');
  assert.equal(plan.levelKey,'Video');assert.equal(plan.matches.length,1);assert.equal(plan.status,'full');
  assert.equal(matrixCrosspoint({g:source},{g:source},'source',new Map(),new Set(),'disconnect').status,'unavailable');
});
