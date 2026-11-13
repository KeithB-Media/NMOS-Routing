import {starterPanel,validPanel,widgetKinds,uid,deviceCatalog,contextGroups,takePlan} from './panel-model.js';
import {supportsSide,destinationRouteSummary,groupSearchFields} from './route-options.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={tags:'Tags',devices:'Devices',tree:'Custom tree',sources:'Sources',destinations:'Destinations',context:'Context area'};
const option=(value,label,current)=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;

export function createPanels(root,{getData,onTake,notify}) {
  let panel,panels=[],storageKey,edit=false,visible=false,busy=false,sourceId=null,destinationId=null,contexts=new Map(),queries=new Map(),selected=new Map(),message='',drag=null,lastTake=null,collapsed=new Set();
  const dialog=document.createElement('dialog');dialog.className='panel-dialog';document.body.append(dialog);
  let routeMap=new Map(),owner=new Map();
  function data(){return getData();}
  function load(){
    const key='vip-panels-v1:'+ (data().state?.controllerUrl||'demo');if(storageKey===key)return;
    storageKey=key;lastTake=null;message='';
    try{const saved=JSON.parse(localStorage.getItem(key));if(Array.isArray(saved?.panels)&&saved.panels.length&&saved.panels.length<=30&&saved.panels.every(validPanel)){panels=saved.panels;panel=panels.find(p=>p.id===saved.activeId)||panels[0];}else throw Error();}
    catch{panel=starterPanel();panels=[panel];}
    sourceId=null;destinationId=null;contexts.clear();selected.clear();queries.clear();
  }
  function save(){try{localStorage.setItem(storageKey,JSON.stringify({panels,activeId:panel.id}));}catch{notify('Panel could not be saved in this browser',true);}}
  function endpoint(id){return data().groups.find(g=>g.id===id);}
  function plan(){const d=data();return takePlan(d.state,endpoint(sourceId),endpoint(destinationId),d.policy);}
  function toolbar(){
    return `<div class="panels-toolbar"><div><span class="eyebrow">OPERATOR WORKSPACE</span><h1>Panels</h1></div><label class="panel-picker">Panel <select data-panel-choice aria-label="Choose panel">${panels.map(p=>option(p.id,p.name,panel.id)).join('')}</select></label><button data-panel-action="new">New panel</button><button data-panel-action="edit" class="${edit?'latched':''}" aria-pressed="${edit}">${edit?'Done editing':'Edit layout'}</button>${edit?'<button data-panel-action="add">+ Add widget</button><button data-panel-action="rename">Rename panel</button><button data-panel-action="delete-panel">Delete panel</button>':''}</div><div class="panels-help">${edit?'Drag a widget header or resize its corner. Configure widgets to link them to a context area. Changes save in this browser.':'Choose a destination, choose a source, then Take. Tags, devices and folders update their linked areas.'}</div>`;
  }
  function routebar(){
    const p=plan(),s=endpoint(sourceId),d=endpoint(destinationId),pending=lastTake?.status==='pending',result=lastTake?(lastTake.status==='success'?'Route confirmed: ':lastTake.status==='error'?'Route failed: ':'Waiting for VIP synchronization: ')+(lastTake.message||lastTake.description):'',status=busy?'Applying route…':p.reason||result||p.warning||'Ready to take';
    return `<div class="panels-routebar"><div><small>DESTINATION</small><strong>${esc(d?.name||'Choose a destination')}</strong></div><span class="panel-route-arrow">←</span><div><small>SOURCE · PRESELECTED</small><strong>${esc(s?.name||'Choose a source')}</strong></div><div class="panels-route-status" role="status">${esc(p.reason||message||status)}</div><button data-panel-action="clear" ${busy?'disabled':''}>Clear</button><button class="panels-take" data-panel-action="take" ${edit||busy||pending||p.reason?'disabled':''} title="${esc(edit?'Finish editing to route':status)}">${busy?'Taking…':'Take'}</button></div>`;
  }
  function render(){
    if(!visible||drag)return;load();
    routeMap=new Map();owner=new Map();
    for(const r of data().state?.routes||[]){if(!routeMap.has(r.to))routeMap.set(r.to,[]);routeMap.get(r.to).push(r);}
    for(const g of data().groups)for(const l of g.levels)owner.set(l.id,g);
    root.classList.toggle('panels-stale',!!data().state?.error);
    // Preserve browsing positions and keyboard focus across live inventory updates.
    const scrolls=new Map([...root.querySelectorAll('.panel-widget-body')].map(n=>[n.closest('[data-widget]').dataset.widget,n.scrollTop]));
    const active=root.contains(document.activeElement)?document.activeElement:null,focus=active?.dataset.searchWidget,selection=focus?[active.selectionStart,active.selectionEnd]:null;
    root.innerHTML=toolbar()+`<div class="panel-canvas-scroll"><div class="panel-canvas ${edit?'editing':''}">${edit?'<svg class="panel-links" aria-hidden="true"></svg>':''}${panel.widgets.map(widgetMarkup).join('')}</div></div>`+routebar();
    root.querySelector('.panel-canvas').style.height=Math.max(13,...panel.widgets.map(w=>w.y+w.h))*48+'px';
    for(const el of root.querySelectorAll('[data-widget]')){const w=panel.widgets.find(w=>w.id===el.dataset.widget);Object.assign(el.style,{left:`calc(${w.x/12*100}% + 5px)`,top:w.y*48+5+'px',width:`calc(${w.w/12*100}% - 10px)`,height:w.h*48-10+'px'});}
    for(const el of root.querySelectorAll('[data-folder-depth]'))el.style.paddingLeft=Math.min(Number(el.dataset.folderDepth),12)*13+'px';
    for(const n of root.querySelectorAll('.panel-widget-body'))n.scrollTop=scrolls.get(n.closest('[data-widget]').dataset.widget)||0;
    if(focus){const field=[...root.querySelectorAll('[data-search-widget]')].find(n=>n.dataset.searchWidget===focus);field?.focus();field?.setSelectionRange(...selection);}
    if(edit)drawLinks();
  }
  function widgetMarkup(w){
    const target=panel.widgets.find(t=>t.id===w.target&&t.kind==='context');
    return `<article class="panel-widget" data-widget="${esc(w.id)}"><header class="panel-widget-head"><span ${edit?'data-drag-widget="'+esc(w.id)+'" tabindex="0" role="button" title="Drag to move; arrow keys move one grid cell"':''}><small>${esc(labels[w.kind])}</small><strong>${esc(w.title)}</strong></span>${edit?`<button data-config-widget="${esc(w.id)}" aria-label="Configure ${esc(w.title)}">Configure</button>`:''}</header>${edit?`<div class="panel-binding">${w.kind==='context'?'Receives linked selections':w.target?'↗ '+esc(target?.title||'Missing context area'):'No linked context area'}</div>`:''}<div class="panel-widget-body">${body(w)}</div>${edit?`<button class="panel-resize" data-resize-widget="${esc(w.id)}" aria-label="Resize ${esc(w.title)}" title="Drag to resize; arrow keys change size">◢</button>`:''}</article>`;
  }
  function search(w){return `<input class="panel-search" data-search-widget="${esc(w.id)}" aria-label="Search ${esc(w.title)}" placeholder="Filter ${esc(w.title.toLowerCase())}…" value="${esc(queries.get(w.id)||'')}">`;}
  function browseButton(w,type,id,label,count,extra=''){
    return `<button class="panel-browse ${selected.get(w.id)===type+':'+id?'selected':''}" data-browse-widget="${esc(w.id)}" data-context-type="${type}" data-context-id="${esc(id)}" aria-pressed="${selected.get(w.id)===type+':'+id}" ${extra}><span>${esc(label)}</span><small>${count}</small></button>`;
  }
  function body(w){
    const {groups,tags}=data(),query=(queries.get(w.id)||'').toLowerCase(),inScope=groups.filter(g=>w.scope==='both'||supportsSide(g,w.scope));
    if(w.kind==='tags'){
      const counts=new Map();for(const g of inScope)for(const t of tags(g))counts.set(t,(counts.get(t)||0)+1);
      const list=[...counts].sort(([a],[b])=>a.localeCompare(b)).filter(([t])=>t.toLowerCase().includes(query));
      return search(w)+`<div class="panel-browse-list">${browseButton(w,'all','','All groups',inScope.length)}${list.map(([t,n])=>browseButton(w,'tag',t,t,n)).join('')}</div>`;
    }
    if(w.kind==='devices'){
      const list=deviceCatalog(inScope,data().state?.devices||[]).filter(d=>(d.name+' '+d.id).toLowerCase().includes(query));
      return search(w)+`<div class="panel-browse-list">${list.map(d=>browseButton(w,'device',d.id,d.name,d.groupIds.length)).join('')||'<p class="panel-empty">No device mappings for these groups.</p>'}</div>`;
    }
    if(w.kind==='tree'){
      function folders(parent,depth=0){return panel.folders.filter(f=>f.parentId===parent).map(f=>{
        const children=panel.folders.some(t=>t.parentId===f.id),closed=collapsed.has(w.id+':'+f.id);
        return `<div class="panel-tree-row" data-folder-depth="${depth}">${children?`<button class="panel-tree-toggle" data-toggle-folder="${esc(f.id)}" data-tree-widget="${esc(w.id)}" aria-label="${closed?'Expand':'Collapse'} ${esc(f.name)}" aria-expanded="${!closed}">${closed?'▸':'▾'}</button>`:'<span class="panel-tree-leaf">·</span>'}${browseButton(w,'folder',f.id,f.name,f.groupIds.length)}</div>`+(closed?'':folders(f.id,depth+1));
      }).join('');}
      return `<div class="panel-tree">${folders(null)||'<p class="panel-empty">Add a root folder to begin.</p>'}</div>${edit?`<button class="panel-folder-edit" data-folders-widget="${esc(w.id)}">Edit folders & membership</button>`:''}`;
    }
    const scope=w.kind==='sources'?'source':w.kind==='destinations'?'destination':w.scope;
    const context=w.kind==='context'?(contexts.get(w.id)||(w.initialAll?{type:'all'}:null)):{type:'all'};
    let items=contextGroups(groups,context,scope,panel.folders,tags);
    const total=items.length;
    items=items.filter(g=>groupSearchFields(g,tags(g)).join(' ').toLowerCase().includes(query));
    const caption=context?context.type==='all'?'All groups':context.type==='folder'?panel.folders.find(f=>f.id===context.id)?.name||'Missing folder':context.type==='device'?deviceCatalog(groups,data().state?.devices||[]).find(d=>d.id===context.id)?.name||context.id:context.type==='group'?endpoint(context.id)?.name||'Missing group':context.id:'Select a tag, device or folder in a linked widget';
    return `<div class="panel-context-caption"><span>${esc(caption)}</span><small>${items.length} / ${total}</small>${contexts.has(w.id)?`<button data-reset-context="${esc(w.id)}" aria-label="Reset ${esc(w.title)}">×</button>`:''}</div>${search(w)}${context?['source','destination'].filter(s=>scope==='both'||scope===s).map(s=>{
      const list=items.filter(g=>supportsSide(g,s));
      return `<h3 class="panel-group-heading">${s==='source'?'Sources':'Destinations'} <span>${list.length}</span></h3><div class="panel-endpoints">${list.map(g=>endpointButton(w,g,s)).join('')||'<p class="panel-empty">No matching '+s+' groups.</p>'}</div>`;
    }).join(''):'<p class="panel-empty">Choose an item in a linked widget to show its groups here.</p>'}`;
  }
  function endpointButton(w,g,side){
    const {state}=data(),chosen=(side==='source'?sourceId:destinationId)===g.id;
    const locked=side==='destination'&&g.levels.some(l=>(routeMap.get(l.id)||[]).some(r=>r.locked));
    let summary='';
    if(side==='destination'){
      const info=destinationRouteSummary(g,routeMap,owner);summary=(info.mixed?'◐ Breakaway · ':'')+info.current;
    }else summary=g.levels.length+' levels';
    return `<button class="panel-endpoint ${side} ${chosen?'selected':''}" data-endpoint-widget="${esc(w.id)}" data-group-id="${esc(g.id)}" data-side="${side}" aria-pressed="${chosen}" title="${esc(g.name+'\n'+summary+(locked?'\nLocked in VIP':''))}"><strong>${esc(g.name)}</strong><small>${locked?'🔒 ':''}${esc(summary)}</small></button>`;
  }
  function drawLinks(){
    const svg=root.querySelector('.panel-links'),canvas=root.querySelector('.panel-canvas');if(!svg||!canvas)return;
    svg.setAttribute('viewBox',`0 0 ${canvas.clientWidth} ${canvas.clientHeight}`);
    svg.innerHTML=panel.widgets.filter(w=>w.target).map(w=>{const t=panel.widgets.find(t=>t.id===w.target&&t.kind==='context');if(!t)return '';const x=(w.x+w.w/2)/12*canvas.clientWidth,y=(w.y+.5)*48,tx=(t.x+t.w/2)/12*canvas.clientWidth,ty=(t.y+.5)*48;return `<path d="M${x},${y} C${x},${y-35} ${tx},${ty-35} ${tx},${ty}"/><circle cx="${tx}" cy="${ty}" r="4"/>`;}).join('');
  }
  function modal(content){dialog.innerHTML=`<button class="panel-modal-close" aria-label="Close">×</button>${content}`;dialog.querySelector('.panel-modal-close').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();}
  function configure(w){
    modal(`<h2>Configure widget</h2><form class="panel-config"><label>Title<input name="title" value="${esc(w.title)}" maxlength="80" required></label><label>Contents<select name="kind" aria-label="Contents">${widgetKinds.map(k=>option(k,labels[k],w.kind)).join('')}</select></label><label>Endpoint scope<select name="scope" aria-label="Endpoint scope">${['source','destination','both'].map(s=>option(s,s==='both'?'Sources and destinations':s==='source'?'Sources':'Destinations',w.scope)).join('')}</select></label><label>Update context area<select name="target" aria-label="Update context area">${option('','None',w.target||'')}${panel.widgets.filter(t=>t.kind==='context'&&t.id!==w.id).map(t=>option(t.id,t.title,w.target)).join('')}</select></label><p>Tags, devices and folders filter the linked area. Source and destination buttons select an endpoint and can also update a linked area.</p><label class="panel-check"><input type="checkbox" name="initialAll" ${w.initialAll?'checked':''}> Show all groups before a context is selected (context areas)</label><div class="panel-geometry">${['x','y','w','h'].map((k,i)=>`<label>${['Column (0–11)','Row','Width (columns)','Height (rows)'][i]}<input name="${k}" type="number" step="1" min="${k==='w'?2:k==='h'?3:0}" max="${k==='y'?200:k==='h'?30:12}" value="${w[k]}" required></label>`).join('')}</div><div class="panel-modal-actions"><button type="button" data-folder-settings>Folders…</button><button type="button" data-remove-widget>Remove widget</button><button type="submit">Save widget</button></div><p class="panel-form-error" role="alert"></p></form>`);
    const form=dialog.querySelector('form');
    form.onsubmit=e=>{e.preventDefault();const v=new FormData(form),next={...w,title:v.get('title').trim(),kind:v.get('kind'),scope:v.get('scope'),target:v.get('target')||undefined,initialAll:v.has('initialAll')};for(const k of ['x','y','w','h'])next[k]=Number(v.get(k));if(next.kind==='context')delete next.target;
      const candidate={...panel,widgets:panel.widgets.map(t=>t===w?next:t)};
      if(!next.title||!validPanel(candidate)){form.querySelector('.panel-form-error').textContent='Use whole grid dimensions. The widget must fit within 12 columns.';return;}
      Object.assign(w,next);if(next.kind==='context')delete w.target;save();dialog.close();render();};
    form.querySelector('[data-remove-widget]').onclick=()=>{panel.widgets=panel.widgets.filter(t=>t!==w);for(const t of panel.widgets)if(t.target===w.id)delete t.target;contexts.delete(w.id);save();dialog.close();render();};
    form.querySelector('[data-folder-settings]').onclick=()=>folderEditor();
  }
  function folderEditor(currentId){
    let f=panel.folders.find(f=>f.id===currentId)||panel.folders[0];
    modal(`<h2>Custom routing tree</h2><p>Folders contain references to groups. A group can belong to several folders. Select a folder to edit its direct members.</p><div class="panel-folder-tools"><select data-folder-choice aria-label="Choose folder">${panel.folders.map(t=>option(t.id,folderPath(t),f?.id)).join('')}</select><button data-add-root>+ Root</button><button data-add-child ${f?'':'disabled'}>+ Subfolder</button></div>${f?`<form class="panel-folder-form"><label>Folder name<input name="name" value="${esc(f.name)}" required maxlength="80"></label><input class="panel-search" data-member-search aria-label="Search folder members" placeholder="Find source or destination groups…"><span data-member-count></span><div class="panel-members"></div><div class="panel-modal-actions"><button type="button" data-delete-folder>Delete folder</button><button type="submit">Save folder</button></div></form>`:'<p>Add a root folder to begin.</p>'}`);
    function add(parentId){if(panel.folders.length>=500){notify('Maximum 500 folders per panel',true);return;}const next={id:uid(),name:parentId?'New subfolder':'New root folder',parentId,groupIds:[]};panel.folders.push(next);save();folderEditor(next.id);}
    dialog.querySelector('[data-add-root]').onclick=()=>add(null);
    dialog.querySelector('[data-add-child]').onclick=()=>{if(f)add(f.id);};
    dialog.querySelector('[data-folder-choice]').onchange=e=>folderEditor(e.target.value);
    if(!f)return;
    const membership=new Set(f.groupIds),list=dialog.querySelector('.panel-members');
    function members(q=''){
      const groups=data().groups.filter(g=>groupSearchFields(g,data().tags(g)).join(' ').toLowerCase().includes(q.toLowerCase()));
      list.innerHTML=groups.map(g=>`<label><input type="checkbox" data-member-id="${esc(g.id)}" ${membership.has(g.id)?'checked':''}><span>${esc(g.name)}<small>${esc(g.side)}</small></span></label>`).join('');
      dialog.querySelector('[data-member-count]').textContent=membership.size+' assigned · '+groups.length+' matching groups';
    }
    members();list.onchange=e=>{const id=e.target.dataset.memberId;if(id){e.target.checked?membership.add(id):membership.delete(id);dialog.querySelector('[data-member-count]').textContent=membership.size+' assigned';}};
    dialog.querySelector('[data-member-search]').oninput=e=>members(e.target.value);
    dialog.querySelector('form').onsubmit=e=>{e.preventDefault();f.name=new FormData(e.target).get('name').trim()||f.name;f.groupIds=[...membership];save();dialog.close();render();};
    dialog.querySelector('[data-delete-folder]').onclick=()=>{
      if(!confirm('Delete this folder and its subfolders? Routing groups will remain in the router.'))return;
      const remove=new Set([f.id]);let changed=true;while(changed){changed=false;for(const t of panel.folders)if(remove.has(t.parentId)&&!remove.has(t.id)){remove.add(t.id);changed=true;}}
      panel.folders=panel.folders.filter(t=>!remove.has(t.id));save();folderEditor();render();};
  }
  function folderPath(f){const parts=[f.name];let p=f.parentId;while(p){const parent=panel.folders.find(t=>t.id===p);if(!parent)break;parts.unshift(parent.name);p=parent.parentId;}return parts.join(' / ');}
  async function take(){
    if(edit||busy||lastTake?.status==='pending')return;
    let p=plan();if(p.reason){notify(p.reason,true);return;}
    const s=endpoint(sourceId),d=endpoint(destinationId);
    if(!confirm(`Take ${s.name} → ${d.name}?${p.warning?'\n'+p.warning:''}`))return;
    p=plan();if(p.reason){notify(p.reason,true);return;}
    busy=true;message='';render();
    try{const result=await onTake(s,d,p);lastTake=result?.operation||null;message=result?.message||'';}
    catch(error){message='Route failed: '+error.message;notify(message,true);}
    finally{busy=false;render();}
  }
  root.addEventListener('click',e=>{
    const action=e.target.closest('[data-panel-action]')?.dataset.panelAction;
    if(action==='edit'){edit=!edit;render();return;}
    if(action==='new'){if(panels.length>=30){notify('Maximum 30 panels',true);return;}panel=starterPanel();panel.name='Panel '+(panels.length+1);panels.push(panel);sourceId=null;destinationId=null;message='';contexts.clear();queries.clear();selected.clear();edit=true;save();render();return;}
    if(action==='rename'){modal(`<h2>Rename panel</h2><form class="panel-config"><label>Panel name<input name="name" value="${esc(panel.name)}" required maxlength="80"></label><button>Save name</button></form>`);dialog.querySelector('form').onsubmit=e=>{e.preventDefault();panel.name=new FormData(e.target).get('name').trim()||panel.name;save();dialog.close();render();};return;}
    if(action==='delete-panel'){if(!confirm('Delete this saved panel layout and its custom folders?'))return;panels=panels.filter(p=>p!==panel);if(!panels.length)panels=[starterPanel()];panel=panels[0];sourceId=null;destinationId=null;message='';contexts.clear();selected.clear();queries.clear();save();render();return;}
    if(action==='add'){if(panel.widgets.length>=40){notify('Maximum 40 widgets per panel',true);return;}const w={id:uid(),title:'New widget',kind:'sources',scope:'source',x:0,y:Math.max(0,...panel.widgets.map(t=>t.y+t.h)),w:4,h:6};if(w.y>200){notify('Panel height limit reached',true);return;}panel.widgets.push(w);save();render();configure(w);return;}
    if(action==='clear'&&!busy){sourceId=null;destinationId=null;message='';render();return;}
    if(action==='take'){void take();return;}
    const config=e.target.closest('[data-config-widget]');if(config){configure(panel.widgets.find(w=>w.id===config.dataset.configWidget));return;}
    if(e.target.closest('[data-folders-widget]')){folderEditor();return;}
    const toggle=e.target.closest('[data-toggle-folder]');if(toggle){const key=toggle.dataset.treeWidget+':'+toggle.dataset.toggleFolder;collapsed.has(key)?collapsed.delete(key):collapsed.add(key);render();return;}
    const reset=e.target.closest('[data-reset-context]');if(reset){contexts.delete(reset.dataset.resetContext);render();return;}
    const browse=e.target.closest('[data-browse-widget]');
    if(browse){const w=panel.widgets.find(w=>w.id===browse.dataset.browseWidget),c={type:browse.dataset.contextType,id:browse.dataset.contextId};selected.set(w.id,c.type+':'+c.id);if(w.target&&panel.widgets.some(t=>t.id===w.target&&t.kind==='context'))contexts.set(w.target,c);else notify('Link this widget to a context area in Edit layout');render();return;}
    const button=e.target.closest('[data-endpoint-widget]');
    if(button&&!edit&&!busy){const w=panel.widgets.find(w=>w.id===button.dataset.endpointWidget);if(button.dataset.side==='source')sourceId=button.dataset.groupId;else destinationId=button.dataset.groupId;message='';if(lastTake?.status!=='pending')lastTake=null;if(w.target&&panel.widgets.some(t=>t.id===w.target&&t.kind==='context'))contexts.set(w.target,{type:'group',id:button.dataset.groupId});render();}
  });
  root.addEventListener('input',e=>{if(e.target.dataset.searchWidget){queries.set(e.target.dataset.searchWidget,e.target.value);render();}});
  root.addEventListener('change',e=>{if(e.target.matches('[data-panel-choice]')){panel=panels.find(p=>p.id===e.target.value);contexts.clear();queries.clear();selected.clear();sourceId=null;destinationId=null;message='';save();render();}});
  function transform(w,resize,dx,dy){if(resize){w.w=Math.max(2,Math.min(12-w.x,w.w+dx));w.h=Math.max(3,Math.min(30,w.h+dy));}else{w.x=Math.max(0,Math.min(12-w.w,w.x+dx));w.y=Math.max(0,Math.min(200,w.y+dy));}}
  root.addEventListener('keydown',e=>{
    const handle=e.target.closest('[data-drag-widget],[data-resize-widget]');if(!edit||!handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();const w=panel.widgets.find(w=>w.id===(handle.dataset.dragWidget||handle.dataset.resizeWidget)),resize=!!handle.dataset.resizeWidget;transform(w,resize,e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0,e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0);save();render();root.querySelector(`[${resize?'data-resize-widget':'data-drag-widget'}="${w.id}"]`)?.focus();
  });
  root.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('[data-drag-widget],[data-resize-widget]');if(!edit||!handle||e.button!==0)return;
    e.preventDefault();const w=panel.widgets.find(w=>w.id===(handle.dataset.dragWidget||handle.dataset.resizeWidget));drag={w,initial:{...w},x:e.clientX,y:e.clientY,resize:!!handle.dataset.resizeWidget,cell:root.querySelector('.panel-canvas').clientWidth/12,handle};handle.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove',e=>{if(!drag)return;const {w,initial,resize,cell}=drag;Object.assign(w,initial);transform(w,resize,Math.round((e.clientX-drag.x)/cell),Math.round((e.clientY-drag.y)/48));const el=drag.handle.closest('[data-widget]');el.style.left=`calc(${w.x/12*100}% + 5px)`;el.style.top=w.y*48+5+'px';el.style.width=`calc(${w.w/12*100}% - 10px)`;el.style.height=w.h*48-10+'px';drawLinks();});
  function endDrag(cancel){if(!drag)return;if(cancel)Object.assign(drag.w,drag.initial);drag=null;save();render();}
  root.addEventListener('pointerup',()=>endDrag(false));root.addEventListener('pointercancel',()=>endDrag(true));
  new ResizeObserver(()=>{if(visible&&edit)drawLinks();}).observe(root);
  return {setVisible(value){visible=value;if(!value){dialog.close();endDrag(false);}else render();},update(){render();},status(){if(!visible||drag)return;const bar=root.querySelector('.panels-routebar');if(bar){const next=document.createElement('div');next.innerHTML=routebar();if(bar.outerHTML!==next.innerHTML)bar.replaceWith(next.firstElementChild);}const state=data().state;root.classList.toggle('panels-stale',!!state&&(!!state.error||!Number.isFinite(Date.parse(state.lastSync))||Date.now()-Date.parse(state.lastSync)>(state.syncSeconds||5)*3000));}};
}
