import {test} from 'node:test';
import {inventoryOf} from '../lib/nmos-model.mjs';
import {demoState} from '../lib/demo-state.mjs';
import assert from 'node:assert/strict';
import {compileSearch} from '../public/search.js';

test('contains, case-insensitivity and OR branches',()=>{
  assert(compileSearch('replay')('PAC-12 REPLAY 56'));
  assert(compileSearch('PCR1 | PCR2')('PCR2 PGM'));
  assert(!compileSearch('PCR1 | PCR2')('PCR3 PGM'));
  assert(compileSearch('replay 56')('REPLAY 56'));
  assert(!compileSearch('replay 56')('REPLAY 55'));
});
test('quotes match whole fields/tags, and preserve embedded pipes',()=>{
  assert(compileSearch('"REPLAY 56"')(['REPLAY 56','Program']));
  assert(!compileSearch('"REPLAY 56"')('PAC REPLAY 56'));
  assert(compileSearch('"A | B" | PCR1')('A | B'));
  assert(!compileSearch('"A | B"')('A'));
  assert(compileSearch('"a\\"b"')('a"b'));
});
test('literal regex punctuation and wildcard characters',()=>{
  assert(compileSearch('PCR?*PGM')('PCR2 TEST PGM'));
  assert(!compileSearch('PCR?PGM')('PCR22PGM'));
  assert(compileSearch('a.b')('a.b'));
  assert(!compileSearch('a.b')('axb'));
  assert(compileSearch('[x]*')('test [x] signal'));
  assert(compileSearch('')('anything'));
  assert(compileSearch(' | ')('anything'));
});
test('pre-folded cached search produces the same results',()=>{
  const fields=['REPLAY 56','Program'];
  for(const q of ['replay','"REPLAY 56"','program replay','replay | pcr','R*56']){
    assert.equal(compileSearch(q)(fields),compileSearch(q,{caseFolded:true})(fields.map(f=>f.toLowerCase())));
  }
});
test('hyphens stay literal in names, numeric ranges and wildcard searches',()=>{
  assert(compileSearch('PCR1-IPG-08')('PCR1-IPG-08 3'));
  assert(compileSearch('VPRX-*')('VPRX-109'));
  assert(compileSearch('1-8')('ACR1 AUX 1-8'));
  assert(!compileSearch('1-8')('ACR1 AUX 17-24'));
  assert(compileSearch('"4-SPR-01"')('4-SPR-01'));
  assert(!compileSearch('"4-SPR-01"')('4-SPR-010'));
});
test('unquoted hyphens match typographic dashes and optional separator spacing',()=>{
  const label='Audio Matrix 01 — In 22';
  for(const query of ['Audio Matrix 01 - In 22','Audio Matrix 01-In 22','01—In','01-*22','-']) {
    assert(compileSearch(query)(label),query);
    assert(compileSearch(query,{caseFolded:true})(label.toLowerCase()),query+' (cached)');
  }
  assert(compileSearch('CAM-1')('CAM‑1'));
  assert(compileSearch('CAM−1')('CAM-1'));
  assert(compileSearch('"Audio Matrix 01 — In 22"')(label));
  assert(!compileSearch('"Audio Matrix 01 - In 22"')(label),'quoted fields remain character-exact apart from case');
  assert(compileSearch('01-In "Audio Matrix 01 — In 22"')(label));
});
test('benchmark the demo inventory without network calls',async t=>{
  const {groups}=inventoryOf(demoState());
  const records=groups.map(g=>[g.name,g.system,g.description,...g.tags].map(s=>s.toLowerCase()));
  const durations=[];
  for(let i=0;i<100;i++) {
    const start=performance.now(), match=compileSearch(i%2?'replay | pcr1':'"PCR1 PGM"',{caseFolded:true});
    records.filter(match);durations.push(performance.now()-start);
  }
  durations.sort((a,b)=>a-b);
  t.diagnostic(`${groups.length} groups: median ${durations[50].toFixed(2)} ms, p95 ${durations[95].toFixed(2)} ms (search computation only)`);
  assert(durations[95]<100,'search computation should stay below 100ms even on slow hosts');
});
