export function attachColumnResize(root,{definition,width,onWidth}) {
  let drag=null;
  root.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('[data-resize-column]');if(!handle||event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    const id=handle.dataset.resizeColumn;drag={handle,id,pointer:event.pointerId,x:event.clientX,width:width(id)};
    handle.setPointerCapture(event.pointerId);handle.focus();document.body.classList.add('resizing-columns');
  });
  const resize=(id,value,commit)=>onWidth(id,Math.max(definition(id).min,Math.min(700,Math.round(value))),commit);
  root.addEventListener('pointermove',event=>{if(drag?.pointer===event.pointerId)resize(drag.id,drag.width+event.clientX-drag.x,false);});
  const finish=event=>{if(drag?.pointer!==event.pointerId)return;const current=drag;drag=null;resize(current.id,event.type==='pointercancel'?current.width:width(current.id),true);document.body.classList.remove('resizing-columns');if(current.handle.hasPointerCapture(event.pointerId))current.handle.releasePointerCapture(event.pointerId);};
  root.addEventListener('pointerup',finish);root.addEventListener('pointercancel',finish);
  root.addEventListener('keydown',event=>{
    const handle=event.target.closest('[data-resize-column]');if(!handle)return;
    const id=handle.dataset.resizeColumn,delta=event.shiftKey?1:10;
    if(['ArrowLeft','ArrowRight','Home'].includes(event.key)){event.preventDefault();event.stopPropagation();resize(id,event.key==='Home'?definition(id).width:width(id)+(event.key==='ArrowLeft'?-delta:delta),true);}
  });
  root.addEventListener('dblclick',event=>{const handle=event.target.closest('[data-resize-column]');if(handle){event.preventDefault();event.stopPropagation();resize(handle.dataset.resizeColumn,definition(handle.dataset.resizeColumn).width,true);}});
}
