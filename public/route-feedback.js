// Feedback is independent of inventory renders, filters and tab switches.
export class RouteFeedback {
  constructor({now = () => Date.now(), successMs = 3000, errorMs = 10000, pendingMs = 60000} = {}) {
    Object.assign(this, {now, successMs, errorMs, pendingMs});
    this.operations = new Map(); this.sequence = 0;
  }
  begin(details) {
    const time = this.now();
    const operation = {...details, id:++this.sequence, status:'pending', phase:'requesting', startedAt:time, changedAt:time, expiresAt:time+this.pendingMs};
    for (const [id,old] of this.operations) if((details.groupId ? old.groupId===details.groupId : details.destinationId && old.destinationId===details.destinationId) && (!old.levelKey || !details.levelKey || old.levelKey===details.levelKey) && old.status!=='pending') this.operations.delete(id);
    this.operations.set(operation.id,operation); return operation;
  }
  accepted(operation, pending = false) {
    if(!this.operations.has(operation.id) || operation.status!=='pending') return;
    if(pending) {operation.phase='syncing';operation.expiresAt=this.now()+this.pendingMs;}
    else this.finish(operation,'success');
  }
  finish(operation,status,message='') {
    if(!this.operations.has(operation.id)) return;
    operation.status=status;operation.message=message;operation.changedAt=this.now();
    operation.expiresAt=operation.changedAt+(status==='success'?this.successMs:this.errorMs);
  }
  synchronize(snapshot) {
    if(snapshot.error || !snapshot.lastSync) return [];
    const routesByDestination=new Map();
    for(const route of snapshot.routes) {
      if(!routesByDestination.has(route.to)) routesByDestination.set(route.to,new Set());
      routesByDestination.get(route.to).add(route.from);
    }
    const completed=[];
    for(const operation of this.operations.values()) {
      if(operation.status!=='pending'||operation.phase!=='syncing') continue;
      const removed = operation.removed || [];
      const confirmed = operation.expected.every(pair=>routesByDestination.get(pair.to)?.has(pair.from)) && removed.every(pair=>!routesByDestination.get(pair.to)?.has(pair.from));
      if((operation.expected.length || removed.length) && confirmed) {
        this.finish(operation,'success');completed.push(operation);
      }
    }
    return completed;
  }
  sweep() {
    const time=this.now();let changed=false;
    for(const [id,operation] of this.operations) if(time>=operation.expiresAt) {
      if(operation.status==='pending') this.finish(operation,'error','Route was not confirmed within 60 seconds. Check the engine log before retrying.');
      else this.operations.delete(id);
      changed=true;
    }
    return changed;
  }
  forRow(groupId,levelKey) {
    let selected=null;
    for(const operation of this.operations.values()) {
      if(operation.affectedRows) {
        const affected = operation.affectedRows.find(row=>row.id===groupId);
        if(!affected || (levelKey && !affected.levelKeys.includes(levelKey))) continue;
      } else if(operation.sourceId!==groupId && operation.destinationId!==groupId) continue;
      if(levelKey && operation.levelKey && operation.levelKey!==levelKey) continue;
      if(levelKey && operation.levelKeys && !operation.levelKeys.includes(levelKey)) continue;
      if(!selected || operation.id>selected.id) selected=operation;
    }
    return selected;
  }
  destinationPending(id) {return [...this.operations.values()].some(o=>(o.destinationId===id||o.affectedRows?.some(row=>row.id===id))&&o.status==='pending');}
  nextExpiry() {return Math.min(...[...this.operations.values()].map(o=>o.expiresAt));}
}
