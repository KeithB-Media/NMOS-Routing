import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nameSeries} from '../public/name-series.js';

test('fill preserves numeric prefixes, zero padding and large counters',()=>{
  assert.deepEqual(nameSeries('TR-01',6),['TR-01','TR-02','TR-03','TR-04','TR-05','TR-06']);
  assert.deepEqual(nameSeries('spg1',4),['spg1','spg2','spg3','spg4']);
  assert.deepEqual(nameSeries('Rack2-099',3),['Rack2-099','Rack2-100','Rack2-101']);
  assert.deepEqual(nameSeries('s9007199254740992',2),['s9007199254740992','s9007199254740993']);
});
test('fill preserves letter case, separators and the original prefix through Z-to-AA carry',()=>{
  for(const [seed,next] of [['input a','input b'],['input-A','input-B'],['inputa','inputb'],['inputA','inputB']])assert.deepEqual(nameSeries(seed,2),[seed,next]);
  assert.deepEqual(nameSeries('input z',3),['input z','input aa','input ab']);
  assert.deepEqual(nameSeries('input-Z',3),['input-Z','input-AA','input-AB']);
  assert.deepEqual(nameSeries('inputz',3),['inputz','inputaa','inputab']);
  assert.deepEqual(nameSeries('input-AZ',3),['input-AZ','input-BA','input-BB']);
});
test('fill rejects unsupported seeds, oversized selections and names beyond VIP limits',()=>{
  for(const seed of ['', 'input-', 'input aB'])assert.throws(()=>nameSeries(seed,3));
  for(const count of [0,-1,502,1.5])assert.throws(()=>nameSeries('TR-01',count));
  assert.equal(nameSeries('TR-01',501).at(-1),'TR-501');
  assert.throws(()=>nameSeries('x'.repeat(199)+'9',2),/200/);
});
