// Reorder the menu immediately; redraw the grid and persist only on drop.
// Pointer capture keeps dragging reliable with mouse, pen and touch.
export function attachColumnSorter(list,{onChange,announce=()=>{}}) {
  let drag=null;
  const rows=()=>[...list.children];
  const order=()=>rows().map(row=>row.dataset.columnId);
  function start(handle,pointer) {
    if(drag)return false;
    drag={handle,row:handle.closest('[data-column-id]'),original:order(),pointer,moved:false};
    handle.setAttribute('aria-pressed','true');
    drag.row.classList.add('column-grabbed');
    return true;
  }
  function describe() {
    const items=rows(),index=items.indexOf(drag.row);
    announce(`${drag.handle.dataset.label}, position ${index+1} of ${items.length}`);
  }
  function finish(commit) {
    if(!drag)return;
    const current=drag;drag=null;
    if(!commit)for(const id of current.original)list.append(rows().find(row=>row.dataset.columnId===id));
    current.handle.setAttribute('aria-pressed','false');current.row.classList.remove('column-grabbed');
    list.classList.remove('column-dragging');
    if(current.pointer!==undefined&&current.handle.hasPointerCapture(current.pointer))current.handle.releasePointerCapture(current.pointer);
    if(commit&&current.original.join()!==order().join())onChange(order());
    announce(commit?'Column order saved':'Column move cancelled');
  }
  function pointerDown(event) {
    const handle=event.target.closest('[data-drag-column]');
    if(!handle||event.button!==0||!start(handle,event.pointerId))return;
    event.preventDefault();handle.focus();drag.startY=event.clientY;handle.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if(!drag||drag.pointer!==event.pointerId)return;
    if(!drag.moved&&Math.abs(event.clientY-drag.startY)<4)return;
    drag.moved=true;list.classList.add('column-dragging');
    const others=rows().filter(row=>row!==drag.row);
    const before=others.find(row=>{const rect=row.getBoundingClientRect();return event.clientY<rect.top+rect.height/2;});
    if(drag.row.nextElementSibling!==(before||null)){list.insertBefore(drag.row,before||null);drag.handle.setPointerCapture(event.pointerId);drag.handle.focus({preventScroll:true});describe();}
  }
  function pointerEnd(event) {if(drag?.pointer===event.pointerId)finish(event.type==='pointerup');}
  function keyDown(event) {
    const handle=event.target.closest('[data-drag-column]');if(!handle)return;
    if([' ','Enter'].includes(event.key)){
      event.preventDefault();event.stopPropagation();
      if(drag?.handle===handle)finish(true);else if(start(handle)){describe();announce('Column picked up. Use the arrow keys, then Space to drop.');}
    } else if(drag?.handle===handle&&['ArrowUp','ArrowDown','Home','End'].includes(event.key)){
      event.preventDefault();event.stopPropagation();
      const items=rows(),index=items.indexOf(drag.row);
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:Math.max(0,Math.min(items.length-1,index+(event.key==='ArrowUp'?-1:1)));
      if(next!==index){list.insertBefore(drag.row,next<index?items[next]:items[next].nextElementSibling);handle.focus();describe();}
    } else if(event.key==='Escape'&&drag){event.preventDefault();event.stopPropagation();finish(false);handle.focus();}
  }
  const handlers={pointerdown:pointerDown,pointermove:pointerMove,pointerup:pointerEnd,pointercancel:pointerEnd,keydown:keyDown};
  for(const [event,handler] of Object.entries(handlers))list.addEventListener(event,handler);
  return ()=>{if(drag)finish(false);for(const [event,handler] of Object.entries(handlers))list.removeEventListener(event,handler);};
}
