import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RouteFeedback} from '../public/route-feedback.js';
const details={sourceId:'source',destinationId:'destination',expected:[{from:'src:v',to:'dst:v'},{from:'src:a',to:'dst:a'}]};
const snapshot=routes=>({lastSync:new Date().toISOString(),error:null,routes});

test('feedback remains pending until both booking acceptance and all levels synchronize',()=>{
  const feedback=new RouteFeedback(),operation=feedback.begin(details);
  assert.equal(operation.status,'pending');assert.equal(operation.phase,'requesting');
  feedback.synchronize(snapshot(details.expected));assert.equal(operation.status,'pending','cached matching routes are insufficient before API acknowledgement');
  feedback.accepted(operation,true);assert.equal(operation.phase,'syncing');
  feedback.synchronize(snapshot(details.expected.slice(0,1)));assert.equal(operation.status,'pending');
  feedback.synchronize(snapshot(details.expected));assert.equal(operation.status,'success');
});
test('stale or failed synchronization cannot produce green success',()=>{
  const feedback=new RouteFeedback(),operation=feedback.begin(details);feedback.accepted(operation,true);
  feedback.synchronize({...snapshot(details.expected),error:'VIP unreachable'});assert.equal(operation.status,'pending');
  feedback.synchronize({...snapshot(details.expected),lastSync:null});assert.equal(operation.status,'pending');
});
test('whole-group feedback covers every level, individual feedback covers only its level and parent in both tabs',()=>{
  const feedback=new RouteFeedback(),group=feedback.begin(details);
  assert.equal(feedback.forRow('destination','video'),group);assert.equal(feedback.forRow('source','audio'),group);
  feedback.accepted(group);
  const level=feedback.begin({...details,levelKey:'audio',expected:[details.expected[1]]});
  assert.equal(feedback.forRow('destination'),level);assert.equal(feedback.forRow('destination','audio'),level);
  assert.equal(feedback.forRow('source','audio'),level);assert.equal(feedback.forRow('unrelated'),null);
  assert.equal(feedback.forRow('destination','video'),null);
});
test('success expires after three seconds and errors after ten without restarting on a redraw',()=>{
  let time=0;const feedback=new RouteFeedback({now:()=>time});
  const success=feedback.begin(details);feedback.accepted(success);
  const error=feedback.begin({...details,destinationId:'other'});feedback.finish(error,'error','Rejected');
  time=2999;feedback.sweep();assert.equal(feedback.forRow('destination'),success);
  feedback.forRow('destination');assert.equal(success.expiresAt,3000);
  time=3000;feedback.sweep();assert.equal(feedback.forRow('destination'),null);assert.equal(feedback.forRow('other'),error);
  time=10000;feedback.sweep();assert.equal(feedback.forRow('other'),null);
});
test('an unconfirmed route times out visibly, while retry supersedes old feedback',()=>{
  let time=0;const feedback=new RouteFeedback({now:()=>time}),operation=feedback.begin(details);
  feedback.accepted(operation,true);time=60000;feedback.sweep();assert.equal(operation.status,'error');assert.match(operation.message,/not confirmed/);
  const retry=feedback.begin(details);assert.equal(feedback.forRow('destination'),retry);
  time=70000;feedback.sweep();assert.equal(feedback.forRow('destination'),retry);assert(feedback.destinationPending('destination'));
});
test('selected-level feedback leaves unselected essence rows unchanged',()=>{
  const feedback=new RouteFeedback(),operation=feedback.begin({...details,levelKeys:['video','audio1']});
  assert.equal(feedback.forRow('destination','video'),operation);
  assert.equal(feedback.forRow('destination','audio2'),null);
  assert.equal(feedback.forRow('source','audio2'),null);
  assert.equal(feedback.forRow('destination'),operation);
});

test('disconnect feedback waits for removal and covers only affected fanout rows and levels',()=>{
  const feedback=new RouteFeedback(),operation=feedback.begin({action:'disconnect',groupId:'source',expected:[],removed:details.expected,affectedRows:[{id:'source',levelKeys:['video','audio']},{id:'destination',levelKeys:['video','audio']},{id:'fanout',levelKeys:['video']}]});
  feedback.accepted(operation,true);
  feedback.synchronize(snapshot(details.expected.slice(0,1)));assert.equal(operation.status,'pending');
  assert.equal(feedback.forRow('fanout','video'),operation);assert.equal(feedback.forRow('fanout','audio'),null);
  assert(feedback.destinationPending('source'));assert(feedback.destinationPending('fanout'));
  feedback.synchronize(snapshot([{from:'other',to:'unrelated'}]));assert.equal(operation.status,'success');
});

test('partial group route stays pending until matching routes arrive and missing levels disconnect',()=>{
  const feedback=new RouteFeedback(),removed=[{from:'old:a2',to:'dst:a2'}];
  const operation=feedback.begin({...details,removed});feedback.accepted(operation,true);
  feedback.synchronize(snapshot([...details.expected,...removed]));assert.equal(operation.status,'pending');
  feedback.synchronize(snapshot(details.expected));assert.equal(operation.status,'success');
});
