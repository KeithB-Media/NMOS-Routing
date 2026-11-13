import {matrixColumns,matrixCrosspoint} from './matrix.js';
import {createNmosViewer} from './nmos-viewer.js';
import {nameSeries} from './name-series.js?v=0.1.0';
import {compileSearch} from './search.js?v=0.1.0';
import {RouteFeedback} from './route-feedback.js?v=0.1.0';
import {supportsSide,groupSearchFields,routeCompatibility,destinationRouteSummary} from './route-options.js?v=0.1.0';
import {LiveUpdates} from './live-updates.js?v=0.1.0';
import {workspaceColumns,columnLayout,aliasText,namedGroup,networkValues} from './workspace.js?v=0.1.0';
import {attachColumnSorter} from './column-sorter.js?v=0.1.0';
import {attachColumnResize} from './column-resize.js?v=0.1.0';
import {createPanels} from './panels.js?v=0.1.0';
import {createSetup} from './setup.js?v=0.1.0';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = n => n.toLocaleString();
const collator = new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
// getRandomValues also works on the IP-only HTTP deployment.
const localId=()=>[...crypto.getRandomValues(new Uint32Array(4))].map(n=>n.toString(16).padStart(8,'0')).join('-');
const paths = {
  source:'<path d="M12 20V4m-5 5 5-5 5 5M5 17v4h14v-4"/>',
  destination:'<path d="M12 3v14m-5-5 5 5 5-5M5 18v3h14v-3"/>',
  route:'<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v7a2 2 0 0 0 2 2h7m-4-4 4 4-4 4M9 6h7a2 2 0 0 1 2 2v3"/>',
  grid:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12m6-12v12M3 15h18"/>',
  matrix:'<path d="M7 3v18M12 3v18M17 3v18M3 7h18M3 12h18M3 17h18"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="7" r="2"/>',
  activity:'<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  settings:'<path d="m9 3-.7 3-2.8 1-2.6-.8-1.4 2.5 2 2.2v3l-2 2.2 1.4 2.5 2.6-.8 2.8 1 .7 3h3l.7-3 2.8-1 2.6.8 1.4-2.5-2-2.2v-3l2-2.2-1.4-2.5-2.6.8-2.8-1L12 3z"/><circle cx="10.5" cy="12.5" r="3"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  down:'<path d="m7 10 5 5 5-5"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 8a7 7 0 0 1 11.6-3L20 8M4 16l2.9 3A7 7 0 0 0 18.5 16"/>',
  density:'<path d="M4 5h16M4 10h16M4 15h16M4 20h16"/>',
  keyboard:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.1M10 9h.1M14 9h.1M18 9h.1M6 13h.1M10 13h.1M14 13h.1M18 13h.1M8 16h8"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  tag:'<path d="m3 3 8 .1 10 10-8 8-10-10z"/><circle cx="7" cy="7" r="1"/>',
  link:'<path d="m10 13 4-4m-6 7-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
};
const icon = (name, cls='') => `<svg viewBox="0 0 24 24" aria-hidden="true" class="${cls}">${paths[name] || paths.route}</svg>`;
for(const name of ['search','favorite','keyboard']) $(`#${name}-icon`).innerHTML = icon(name==='favorite'?'star':name);
for(const name of ['source','destination']) $(`#${name}-tab-icon`).innerHTML = icon(name);
$('.rail-button[data-view="routing"]').innerHTML=icon('grid');
$('.rail-button[data-view="matrix"]').innerHTML=icon('matrix');
$('.rail-button[data-view="activity"]').innerHTML=icon('activity');
$('.rail-button[data-view="nmos"]').innerHTML=icon('route');
$('.rail-button[data-view="panels"]').innerHTML=icon('grid');
$('.rail-button[data-view="setup"]').innerHTML=icon('settings');
$('#settings').innerHTML=icon('settings');$('#density').innerHTML=icon('density');$('#refresh').innerHTML=icon('refresh');
$('#columns').innerHTML=icon('settings');$('#columns').className='icon-button';
$('#columns').setAttribute('aria-label','Columns');$('#columns').title='Choose and reorder columns';
$('#columns').setAttribute('aria-expanded','false');$('#columns').setAttribute('aria-controls','popover');$('#columns').setAttribute('aria-haspopup','dialog');

let state = null, groups = [], routes = [], byId = new Map(), endpointOwner = new Map(), destinationRoutes = new Map(), sourceTargets = new Map();
let groupInfo = new Map(), pickerSearchFields = new Map(), records = [], side = 'destination', filters = {}, query='', onlyFavorites=false, page=0, pageSize=50, sortKey='name', sortDir=1;
let expanded = new Set(), favorites = new Set(), etag = '', polling = false, pop = null, toastTimer, filtered=[];
const rowMarkup = new WeakMap();let previousRowsMarkup='';
const feedback = new RouteFeedback();let feedbackTimer;
let missingLevelPolicy = localStorage.getItem('nmos-missing-level-policy') === 'keep' ? 'keep' : 'disconnect';
const disconnectChoice = {action:'disconnect'};
let compact = localStorage.getItem('nmos-density-v2') === 'compact';document.body.classList.toggle('compact',compact);
let browserLive=false;
let nameSet=localStorage.getItem('nmos-name-set')||'';
let savedLayout;try{savedLayout=JSON.parse(localStorage.getItem('nmos-columns')||'{}')||{};}catch{savedLayout={};}
let columns=workspaceColumns([],savedLayout.spacers||[]),layout=columnLayout(savedLayout,columns),headerSchema='';
let disposeColumnSorter=null;
let nameEdit=null;
let routingLayout=localStorage.getItem('nmos-routing-layout')==='matrix'?'matrix':'table';
let matrixMode=localStorage.getItem('nmos-matrix-mode')==='endpoints'?'endpoints':'groups',matrixPage=0,matrixQuery='',matrixVisible=[];
let selectedNameCell=null;
let nameSelection=null,fillingNames=false;
let updatingNameCell=false;
const suggestionId=id=>'suggest-'+encodeURIComponent(id);
function refreshColumnDefinitions() {
  const next=workspaceColumns(state?.aliasSets||[],layout.spacers);
  if(JSON.stringify(next)!==JSON.stringify(columns)||savedLayout){
    if(pop?.kind==='columns')closePopover();
    columns=next;layout=columnLayout(savedLayout||layout,columns);savedLayout=null;
    for(const key of Object.keys(filters))if(!columns.some(c=>c.id===key))delete filters[key];
    if(!columns.some(c=>c.id===sortKey))sortKey='name';
    applyColumns();
  }
}

function applyColumns() {
  const visible=layout.order.filter(id=>!layout.hidden.includes(id));
  $('.data-table').style.setProperty('--columns',visible.map(id=>`${layout.widths[id]}px`).join(' '));
  $('.data-table').style.minWidth=(28+visible.reduce((n,id)=>n+layout.widths[id],0))+'px';
  const schema=JSON.stringify(columns.map(c=>[c.id,c.label]));
  if(schema!==headerSchema){
    headerSchema=schema;
    $('.column-row').innerHTML=columns.map(c=>`<${c.sort===false?'div':'button'} data-column="${esc(c.id)}" ${c.sort===false?'':`data-sort="${esc(c.id)}"`} role="columnheader" title="${esc(c.label)}"><span class="${['expand','favorite'].includes(c.id)||c.spacer?'sr-only':''}">${esc(c.id==='current'?'Current '+(side==='destination'?'source':'destinations'):c.label)}</span>${c.id==='name'?'<kbd class="column-shortcut" title="F or Ctrl+Shift+F">F</kbd>':''}<span class="column-resizer" data-resize-column="${esc(c.id)}" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize ${esc(c.label)}" title="Drag to resize; double-click to reset"></span></${c.sort===false?'div':'button'}>`).join('');
    $('.filter-row').innerHTML=columns.map(c=>`<div data-column="${esc(c.id)}">${c.filter===false?'':`<input data-filter="${esc(c.id)}" ${c.id==='name'?'aria-keyshortcuts="F Control+Shift+F"':''} aria-label="Filter ${esc(c.id==='name'?'display name':c.id==='current'?'current source':c.label.toLowerCase())}" placeholder="${c.id==='type'?'All types':'Filter…'}" autocomplete="off" list="${suggestionId(c.id)}" value="${esc(filters[c.id]||'')}"><datalist id="${suggestionId(c.id)}"></datalist>`}</div>`).join('');
  }
  for(const row of $$('.column-row,.filter-row')) {
    const cells=new Map([...row.children].filter(n=>n.dataset.column).map(n=>[n.dataset.column,n]));
    layout.order.forEach((id,index)=>{const cell=cells.get(id);cell.hidden=layout.hidden.includes(id);if(row.children[index]!==cell)row.insertBefore(cell,row.children[index]||null);});
  }
  for(const handle of $$('[data-resize-column]')){const c=columns.find(c=>c.id===handle.dataset.resizeColumn);handle.setAttribute('aria-valuenow',layout.widths[c.id]);handle.setAttribute('aria-valuemin',c.min);handle.setAttribute('aria-valuemax','700');handle.setAttribute('aria-valuetext',layout.widths[c.id]+' pixels');}
}
attachColumnResize($('.column-row'),{definition:id=>columns.find(c=>c.id===id),width:id=>layout.widths[id],onWidth:(id,value,commit)=>{layout.widths[id]=value;applyColumns();if(commit){savedLayout=null;localStorage.setItem('nmos-columns',JSON.stringify(layout));}}});
function refreshNames() {
  closePopover();endNameEdit(false,false);selectNameCell(null);rebuildIndexes();page=0;renderRows();updateSuggestions();
  panelsView.update();
}
function renderNameSets() {
  refreshColumnDefinitions();
  const sets=state.aliasSets||[],control=$('#name-set');
  const markup='<option value="">Default name</option>'+sets.map(s=>`<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');
  if(control.innerHTML!==markup)control.innerHTML=markup;
  control.value=sets.some(s=>s.id===nameSet)?nameSet:'';
  control.title=sets.length?'Choose an alias set':'The engine keeps one operator alias per device';
}
$('#name-set').onchange=e=>{nameSet=e.target.value;localStorage.setItem('nmos-name-set',nameSet);refreshNames();};
applyColumns();

function getTags(g) { return state.metadata.tags[g.id] ?? g.tags; }
function levelRoutes(g,l) { return g.side === 'destination' ? (destinationRoutes.get(l.id) || []) : (sourceTargets.get(l.id) || []); }
function namesForRoutes(list, opposite) {return [...new Set(list.map(r=>endpointOwner.get(opposite==='source'?r.from:r.to)?.name || (opposite==='source'?r.from:r.to)))];}
function rebuildIndexes() {
  groups=state.groups.map(g=>namedGroup(g.side==='bidirectional'?{...g,side}:g,nameSet));routes=state.routes;favorites=new Set(state.metadata.favorites);
  byId=new Map(groups.map(g=>[g.id,g]));endpointOwner=new Map();destinationRoutes=new Map();sourceTargets=new Map();groupInfo=new Map();
  pickerSearchFields=new Map(groups.map(g=>[g.id,groupSearchFields(g,getTags(g))]));
  for(const g of groups) for(const l of g.levels) endpointOwner.set(l.id,g);
  for(const r of routes) {
    if(!destinationRoutes.has(r.to)) destinationRoutes.set(r.to,[]);
    if(!sourceTargets.has(r.from)) sourceTargets.set(r.from,[]);
    destinationRoutes.get(r.to).push(r);sourceTargets.get(r.from).push(r);
  }
  for(const g of groups) {
    const opposite=g.side==='destination'?'source':'destination';
    const list=g.levels.flatMap(l=>levelRoutes(g,l));
    const names=namesForRoutes(list,opposite);
    const routedLevels=g.levels.filter(l=>levelRoutes(g,l).length).length;
    const summary=g.side==='destination'?destinationRouteSummary(g,destinationRoutes,endpointOwner):{mixed:false,current:!names.length?'Unrouted':names.length>1?`${names.length} destinations`:names[0],detail:names.join(', ')};
    groupInfo.set(g.id,{names,...summary,routed:!!routedLevels,locked:list.some(r=>r.locked),routedLevels});
  }
  rebuildRecords();
}
function rebuildRecords() {
  records=groups.filter(g=>supportsSide(g,side)).map(g=>{
    const info=groupInfo.get(g.id),tags=getTags(g);
    const fields={name:[g.name,g.defaultName],system:[g.system,g.description],alias:Object.values(g.aliases||{}),type:[g.type],current:[...info.names,info.current,...(info.mixed?['Breakaway','Mixed sources']:[])],tags,multicast:networkValues(g,null,'multicast'),sourceAddress:networkValues(g,null,'sourceAddress')};
    for(const c of columns)if(c.aliasId)fields[c.id]=[g.aliases?.[c.aliasId]||'',...g.levels.map(l=>l.aliases?.[c.aliasId]||'')];
    const lower=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.map(t=>String(t).toLocaleLowerCase())]));
    return {g,info,tags,fields,lower,all:Object.values(lower).flat()};
  });
}
function accept(data) {
  if(state && data.revision < state.revision){reconcileFeedback();return;}
  state=data;renderNameSets();rebuildIndexes();
  if(pop?.g && !byId.has(pop.g.id)) closePopover();
  const sources=groups.filter(g=>supportsSide(g,'source')).length,destinations=groups.filter(g=>supportsSide(g,'destination')).length;
  $('#destination-tab-count').textContent=number(destinations);$('#source-tab-count').textContent=number(sources);
  $('.workspace-label').innerHTML=`<i class="small-dot"></i>${data.mode==='live'?(data.engine?.registry?'Registry '+data.engine.registry.ip:'Live NMOS'):'Demo facility'}`;
  $('#footer-mode').textContent=data.mode==='live'?'LIVE NMOS':'DEMO MODE';
  $('#footer-message').textContent=data.mode==='live'?(data.canWrite?'IS-05 routing enabled · local tags':'Read-only · local tags'):'No devices are changed';
  reconcileFeedback();
  renderStatus();renderRows();renderActivity();updateSuggestions();
  panelsView.update();
}
function renderStatus() {
  if(!state) return;
  panelsView.status();
  $('.workspace-label').title=state.controllerUrl||'';
  const stale = !!state.error || !state.lastSync || Date.now()-Date.parse(state.lastSync)>state.syncSeconds*3000;
  const pill=$('#connection-pill');pill.classList.toggle('stale',stale);
  pill.querySelector('.small-dot').style.background=stale?'var(--amber)':'var(--green)';
  pill.querySelector('span').textContent=stale?'Cache is stale':state.mode==='demo'?'Demo mode':state.engine?.connected?'Registry connected':'Registry disconnected';
  $('#sync-label').textContent=browserLive?(state.stream?.controller==='live'?'Live · WebSocket':`Engine · ${state.syncSeconds}s`):'HTTP fallback';
  const banner=$('#status-banner');banner.hidden=!stale;
  if(stale) banner.textContent=`${state.error || 'Synchronization is delayed.'} · Showing the last good cache${state.lastSync?' from '+new Date(state.lastSync).toLocaleTimeString():''}. Live routing is unavailable until synchronization recovers.`;
}
function tagMarkup(tag) {
  const hue=tag.toLowerCase().includes('audio')?'purple':/studio|pcr|production/i.test(tag)?'warm':'blue';
  return `<span class="tag ${hue}" title="${esc(tag)}">${esc(tag)}</span>`;
}
function tagCell(g) {
  const tags=getTags(g);
  return `<button class="tags-cell" data-action="tags" data-id="${esc(g.id)}" aria-label="Edit tags for ${esc(g.name)}">${tags.length?tags.slice(0,3).map(tagMarkup).join('')+(tags.length>3?`<span class="muted">+${tags.length-3}</span>`:''):`<span class="add-tag-label">${icon('plus')} Add tags</span>`}</button>`;
}
function routeCell(g, level) {
  const info=groupInfo.get(g.id),names=level?namesForRoutes(levelRoutes(g,level),g.side==='destination'?'source':'destination'):info.names;
  const value=level?(names.length>1?`${names.length} destinations`:names[0]||'Unrouted'):info.current;
  const empty=!names.length,mixed=!level&&info.mixed;
  const locked=level?levelRoutes(g,level).some(r=>r.locked):false;
  return `<button class="route-button${empty?' empty':''}${mixed?' mixed':''}" data-action="route" data-unavailable="${!state.canWrite||locked}" data-id="${esc(g.id)}" ${level?`data-level="${esc(level.key)}"`:''} aria-label="Route ${esc(g.name)}${level?' '+esc(level.name):''}" title="${locked?'Locked':!state.canWrite?'Live routing is read-only':names.length?esc(level?names.join(', '):(mixed?'Breakaway · levels differ\n':'')+info.detail):'Click to assign a '+(g.side==='destination'?'source':'destination')}" ${!state.canWrite||locked?'disabled':''}><span class="route-value">${empty?'＋ Assign '+(g.side==='destination'?'source':'destination'):esc(value)}</span>${mixed?'<span class="breakaway-badge">⚠ Breakaway</span>':''}<span class="route-feedback-label" hidden></span>${icon(locked?'lock':'down')}</button>`;
}
function groupRow(r) {
  const {g,info}=r,open=expanded.has(g.id);
  const label=esc(g.name);
  const cells=(level)=>{
    const alias=level?'':aliasText(g,nameSet);
    const content={
      expand:level?'':`<button class="row-expander${open?' open':''}" data-action="expand" data-id="${esc(g.id)}" aria-label="${open?'Collapse':'Expand'} ${label}" aria-expanded="${open}">${icon('chevron')}</button>`,
      favorite:level?'':`<button class="row-star${favorites.has(g.id)?' on':''}" data-action="favorite" data-id="${esc(g.id)}" aria-label="${favorites.has(g.id)?'Unfavorite':'Favorite'} ${label}" aria-pressed="${favorites.has(g.id)}">${icon('star')}</button>`,
      name:`<span class="signal-name" ${!level&&state.canWrite?'tabindex="0" role="button" data-edit-name aria-label="Edit name for '+label+'" title="Click to select, click again to edit · Enter to edit"':''}>${level?`<i class="level-icon ${level.kind}"></i>${esc(level.name)}`:`<i class="small-dot${info.routed?' routed':''}"></i>${label}`}</span>`,
      system:esc(level?(level.flowName||level.key):g.system),alias:esc(alias)||'<span class="muted">—</span>',
      type:level?`<span class="muted">${level.kind==='video'?'Video':level.kind==='audio'?'Audio':'Ancillary'}</span>`:`<span class="type-badge${g.type==='Audio'?' audio':''}">${esc(g.type)}</span>`,
      current:routeCell(g,level),tags:level?'':tagCell(g),
    };
    for(const c of columns){
      if(c.aliasId)content[c.id]=esc((level?level.aliases:g.aliases)?.[c.aliasId])||'<span class="muted">—</span>';
      if(c.spacer)content[c.id]='';
      if(c.id==='health')content[c.id]=healthCell(g,level);
      if(['multicast','sourceAddress'].includes(c.id)){
        const representative=level||g.levels.find(l=>l.kind==='video')||g.levels[0];
        const values=representative?networkValues(g,representative,c.id):[];
        content[c.id]=values.length?values.map(value=>`<span class="network-address">${esc(value)}</span>`).join(''):'<span class="muted">—</span>';
      }
      if(c.id==='sdp')content[c.id]=`<button class="sdp-menu-button" data-action="sdp-menu" data-id="${esc(g.id)}" ${level?`data-level="${esc(level.key)}"`:''} aria-label="SDP options for ${label}${level?' '+esc(level.name):''}" aria-haspopup="menu" aria-expanded="false" title="SDP options"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></button>`;
    }
    return layout.order.map(id=>{const c=columns.find(c=>c.id===id);return `<div role="cell" data-column="${esc(id)}" ${layout.hidden.includes(id)?'hidden':''} class="${id==='system'?'system-name':id==='alias'||c.aliasId?'alias-name':c.spacer?'spacer-cell':''}" title="${esc(id==='name'?g.description||g.defaultName:id==='system'?level?.id||g.id:id==='alias'?alias:c.aliasId?g.aliases?.[c.aliasId]:['multicast','sourceAddress'].includes(id)?g.levels.filter(l=>!level||l.key===level.key).map(l=>l.name+': '+(networkValues(g,l,id).join(', ')||'Not reported')+(l.network?.stale?' (stale)':'')).join('\n'):'')}">${content[id]||''}</div>`;}).join('');
  };
  let html=`<div class="data-row${open?' expanded':''}" data-group-id="${esc(g.id)}" role="row">${cells()}</div>`;
  if(open) html+=g.levels.map(l=>`<div class="data-row level-row" data-group-id="${esc(g.id)}" data-level-key="${esc(l.key)}" role="row">${cells(l)}</div>`).join('');
  return html;
}
function updateGridRows(markup) {
  if(markup===previousRowsMarkup)return;
  const edit=nameEdit,focused=edit&&document.activeElement===edit.input;
  const selection=focused?[edit.input.selectionStart,edit.input.selectionEnd,edit.input.selectionDirection]:null;
  updatingNameCell=true;
  try {reconcileGridRows(markup);}
  finally {
    updatingNameCell=false;
    if(focused&&nameEdit===edit&&edit.input.isConnected&&!edit.cell.hidden){
      if(document.activeElement!==edit.input)edit.input.focus({preventScroll:true});
      edit.input.setSelectionRange(...selection);
    }
  }
}
function reconcileGridRows(markup) {
  previousRowsMarkup=markup;
  const container=$('#rows'),template=document.createElement('template');template.innerHTML=markup;
  const key=row=>JSON.stringify([row.dataset.groupId,row.dataset.levelKey||'']);
  const existing=new Map([...container.children].filter(row=>row.dataset.groupId).map(row=>[key(row),row]));
  const wanted=[];
  for(const next of [...template.content.children]) {
    const row=next.dataset.groupId?existing.get(key(next)):null,signature=next.outerHTML;
    if(row) {
      // Keep the hovered row itself attached. Only changed cell content is replaced.
      if(rowMarkup.get(row)!==signature) {
        row.className=next.className;
        const cells=new Map([...row.children].map(cell=>[cell.dataset.column,cell]));
        const nextCells=[...next.children],keepCells=new Set();
        nextCells.forEach((nextCell,index)=>{
          const cell=cells.get(nextCell.dataset.column)||nextCell;keepCells.add(cell);
          for(const attr of [...cell.attributes])if(!nextCell.hasAttribute(attr.name))cell.removeAttribute(attr.name);
          for(const attr of nextCell.attributes)if(cell.getAttribute(attr.name)!==attr.value)cell.setAttribute(attr.name,attr.value);
          if(nameEdit?.cell===cell)cell.classList.add('editing-name');
          else if(cell.innerHTML!==nextCell.innerHTML)cell.innerHTML=nextCell.innerHTML;
          if(nameSelection?.column===cell.dataset.column&&nameSelection.ids.includes(row.dataset.groupId))cell.classList.add('name-cell-selected');
          if(row.children[index]!==cell)row.insertBefore(cell,row.children[index]||null);
        });
        for(const cell of [...row.children])if(!keepCells.has(cell))cell.remove();
        rowMarkup.set(row,signature);
      }
      wanted.push(row);
    } else {rowMarkup.set(next,signature);wanted.push(next);}
  }
  const keep=new Set(wanted);
  for(const row of [...container.children])if(!keep.has(row))row.remove();
  wanted.forEach((row,index)=>{if(container.children[index]!==row)container.insertBefore(row,container.children[index]||null);});
  if(nameEdit&&!nameEdit.busy&&(!nameEdit.cell.isConnected||nameEdit.cell.hidden))endNameEdit(false,false);
}
function renderRows() {
  if(!state) return;
  const global=compileSearch(query,{caseFolded:true}), tests=Object.entries(filters).filter(([,v])=>v.trim()).map(([k,v])=>[k,compileSearch(v,{caseFolded:true})]);
  filtered=records.filter(r=>(!onlyFavorites||favorites.has(r.g.id))&&global(r.all)&&tests.every(([k,test])=>test(r.lower[k])));
  filtered.sort((a,b)=>{
    const value=r=>sortKey==='current'?r.info.current:sortKey==='name'?r.g.name:(r.fields[sortKey]||[]).join(',');
    const av=value(a),bv=value(b);
    return collator.compare(String(av),String(bv))*sortDir;
  });
  if(nameSelection){const rank=new Map(nameSelection.order.map((id,i)=>[id,i]));filtered.sort((a,b)=>(rank.get(a.g.id)??Infinity)-(rank.get(b.g.id)??Infinity));}
  page=Math.max(0,Math.min(page,Math.ceil(filtered.length/pageSize)-1));
  const visible=filtered.slice(page*pageSize,(page+1)*pageSize);
  renderMatrixHeader();
  updateGridRows(visible.length?visible.map(r=>routingLayout==='matrix'?matrixRow(r):groupRow(r)).join(''):`<div class="empty-state"><strong>${onlyFavorites?'No matching favorites':'No matching signals'}</strong><span>${query||Object.values(filters).some(Boolean)?'Try a different search or clear your filters.':'Your groups will appear here when inventory is available.'}</span></div>`);
  $('#result-count').textContent=`${number(filtered.length)} group${filtered.length===1?'':'s'}`;
  $('#level-count').textContent=` / ${number(filtered.reduce((n,r)=>n+r.g.levels.length,0))} levels`;
  $('#page-info').textContent=`${filtered.length?page*pageSize+1:0}–${Math.min((page+1)*pageSize,filtered.length)} of ${number(filtered.length)}`;
  $('#prev-page').disabled=page===0;$('#next-page').disabled=(page+1)*pageSize>=filtered.length;
  $('#clear-filters').hidden=!query&&!onlyFavorites&&!Object.values(filters).some(Boolean);
  $('#clear-global').hidden=!query;$('.global-search kbd').hidden=!!query;
  $('#favorites').classList.toggle('on',onlyFavorites);
  $('#expand-all').textContent=visible.length&&visible.every(r=>expanded.has(r.g.id))?'Collapse groups':'Expand groups';
  $$('.sort-arrow').forEach(n=>n.remove());
  $$('[data-sort]').find(n=>n.dataset.sort===sortKey)?.insertAdjacentHTML('beforeend',`<span class="sort-arrow">${sortDir===1?'↓':'↑'}</span>`);
  paintNameSelection();paintFeedback();
}
function renderMatrixHeader() {
  const matrix=routingLayout==='matrix';
  $('.data-table').classList.toggle('matrix-table',matrix);
  $('.table-head').hidden=matrix;$('#matrix-head').hidden=!matrix;
  $('#matrix-toolbar').hidden=!matrix;$('#matrix-mode-label').hidden=!matrix;
  $('#columns').hidden=matrix;$('#expand-all').hidden=matrix;
  $('#matrix-row-search').value=filters.name||'';
  $('#routing-layout').value=routingLayout;$('#matrix-mode').value=matrixMode;
  if(!matrix){applyColumns();return;}
  const all=matrixColumns(groups,side,matrixMode,compileSearch(matrixQuery));
  matrixPage=Math.max(0,Math.min(matrixPage,Math.ceil(all.length/24)-1));
  matrixVisible=all.slice(matrixPage*24,(matrixPage+1)*24);
  $('.data-table').style.setProperty('--matrix-columns',`250px repeat(${matrixVisible.length}, 48px)`);
  $('.data-table').style.minWidth=(250+matrixVisible.length*48)+'px';
  $('#matrix-axis-label').textContent=side==='destination'?'Destinations ↓ · Sources →':'Sources ↓ · Destinations →';
  $('#matrix-page-info').textContent=`${all.length?matrixPage*24+1:0}–${Math.min((matrixPage+1)*24,all.length)} of ${all.length}`;
  $('#matrix-prev').disabled=matrixPage===0;$('#matrix-next').disabled=(matrixPage+1)*24>=all.length;
  const markup=`<div class="matrix-header-row" role="row"><div class="matrix-corner" role="columnheader">${side==='destination'?'Destination':'Source'} / ${matrixMode}<small>Click name twice to edit · Shift-click to fill</small></div>${matrixVisible.map(c=>`<div class="matrix-column-heading" role="columnheader" title="${esc(c.label)}"><span>${esc(c.label)}</span></div>`).join('')}</div>`;
  if($('#matrix-head').innerHTML!==markup)$('#matrix-head').innerHTML=markup;
}
function matrixRow(r) {
  const {g}=r,locked=new Set(routes.filter(route=>route.locked).map(route=>route.to));
  const cells=level=>matrixVisible.map((column,index)=>{
    const plan=matrixCrosspoint({g,level},column,side,destinationRoutes,locked,missingLevelPolicy);
    const operation=plan.destination&&feedback.forRow(plan.destination.id,plan.levelKey);
    const disabled=!state.canWrite||plan.status==='unavailable'||feedback.destinationPending(plan.destination?.id);
    const status=operation?.status||'';
    const label=`${side==='destination'?column.label:g.name} → ${side==='destination'?g.name:column.label}${level?' · '+level.name:''}`;
    return `<div data-column="matrix:${index}" role="cell"><button class="crosspoint ${plan.active?'connected':''} ${plan.partial?'breakaway':''} ${status}" data-matrix-column="${index}" ${level?`data-matrix-level="${esc(level.key)}"`:''} ${disabled?'disabled':''} aria-label="${esc(label)}" aria-pressed="${!!plan.active}" title="${esc(label+' · '+(status==='error'?operation.message:plan.reason||(plan.active?'Routed':'Connect')))}">${status==='pending'?'…':status==='error'?'!':plan.active?'●':plan.partial?'◐':'+'}</button></div>`;
  }).join('');
  const name=`<div data-column="name" role="cell"><span class="signal-name" ${state.canWrite?'tabindex="0" role="button" data-edit-name':''} aria-label="Edit name for ${esc(g.name)}" title="${esc(g.system)}">${esc(g.name)}</span></div>`;
  let html=`<div class="data-row matrix-row" role="row" data-group-id="${esc(g.id)}">${name}${matrixMode==='groups'?cells():`<div data-column="summary" class="matrix-group-summary" role="cell">${g.levels.length} endpoints</div>`}</div>`;
  if(matrixMode==='endpoints')html+=g.levels.map(level=>`<div class="data-row matrix-row level-row" role="row" data-group-id="${esc(g.id)}" data-level-key="${esc(level.key)}"><div data-column="endpoint" role="cell" title="${esc(level.id)}"><i class="level-icon ${esc(level.kind)}"></i>${esc(level.name)}</div>${cells(level)}</div>`).join('');
  return html;
}
function changeMatrixView(){
  endNameEdit(false,false);selectNameCell(null);closePopover();previousRowsMarkup='';renderRows();
}
$('#routing-layout').onchange=e=>$('.rail-button[data-view="'+(e.target.value==='matrix'?'matrix':'routing')+'"]').click();
$('#matrix-mode').onchange=e=>{matrixMode=e.target.value;matrixPage=0;localStorage.setItem('nmos-matrix-mode',matrixMode);changeMatrixView();};
$('#matrix-row-search').oninput=e=>{filters.name=e.target.value;$('[data-filter="name"]').value=e.target.value;resetPage();renderRows();};
$('#matrix-search').oninput=e=>{matrixQuery=e.target.value;matrixPage=0;renderRows();};
$('#matrix-prev').onclick=()=>{matrixPage--;renderRows();};
$('#matrix-next').onclick=()=>{matrixPage++;renderRows();};
function updateSuggestions(key) {
  const keys=key?[key]:columns.filter(c=>c.filter!==false).map(c=>c.id);
  for(const k of keys) {
    const test=compileSearch(filters[k]||'');
    const values=[...new Set(records.flatMap(r=>r.fields[k]))].filter(v=>test(v)).slice(0,18);
    document.getElementById(suggestionId(k)).innerHTML=values.map(v=>`<option value="${esc(v)}"></option>`).join('');
  }
}
function resetPage(){selectNameCell(null);page=0;$('.table-scroll').scrollTop=0;closePopover();}
$('#global-search').addEventListener('input',e=>{query=e.target.value;resetPage();renderRows();});
$('.filter-row').addEventListener('input',e=>{if(!e.target.matches('[data-filter]'))return;filters[e.target.dataset.filter]=e.target.value;resetPage();renderRows();updateSuggestions(e.target.dataset.filter);});
$('#clear-global').onclick=()=>{query='';$('#global-search').value='';resetPage();renderRows();$('#global-search').focus();};
$('#clear-filters').onclick=()=>{query='';filters={};onlyFavorites=false;$('#global-search').value='';$$('[data-filter]').forEach(i=>i.value='');resetPage();renderRows();updateSuggestions();};
$('#favorites').onclick=()=>{onlyFavorites=!onlyFavorites;resetPage();renderRows();};
$$('[data-tab]').forEach(button=>button.onclick=()=>{
  endNameEdit(false,false);selectNameCell(null);
  side=button.dataset.tab;$$('[data-tab]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-selected',b===button);});
  const current=$$('[data-sort]').find(n=>n.dataset.sort==='current');current.querySelector('span:not(.column-resizer)').textContent=`Current ${side==='destination'?'source':'destinations'}`;
  const input=$('[data-filter="current"]');input.placeholder=side==='destination'?'Filter source…':'Filter destinations…';input.setAttribute('aria-label',`Filter current ${side==='destination'?'source':'destinations'}`);
  filters.current='';input.value='';expanded.clear();rebuildIndexes();resetPage();renderRows();updateSuggestions();
});
$('.column-row').onclick=e=>{if(e.target.closest('[data-resize-column]'))return;const b=e.target.closest('[data-sort]');if(!b)return;selectNameCell(null);sortDir=sortKey===b.dataset.sort?-sortDir:1;sortKey=b.dataset.sort;renderRows();};
$('#page-size').onchange=e=>{pageSize=Number(e.target.value);resetPage();renderRows();};
$('#prev-page').onclick=()=>{page--;closePopover();renderRows();$('.table-scroll').scrollTop=0;};
$('#next-page').onclick=()=>{page++;closePopover();renderRows();$('.table-scroll').scrollTop=0;};
$('#density').onclick=()=>{compact=!compact;document.body.classList.toggle('compact',compact);localStorage.setItem('nmos-density-v2',compact?'compact':'comfortable');};
$('#expand-all').onclick=()=>{
  const visible=filtered.slice(page*pageSize,(page+1)*pageSize),collapse=visible.every(r=>expanded.has(r.g.id));
  for(const r of visible) collapse?expanded.delete(r.g.id):expanded.add(r.g.id);closePopover();renderRows();
};
$('#rows').onclick=async e=>{
  if(e.target.closest('.inline-name-editor'))return;
  const crosspoint=e.target.closest('[data-matrix-column]');
  if(crosspoint){
    const g=byId.get(crosspoint.closest('[data-group-id]').dataset.groupId),column=matrixVisible[Number(crosspoint.dataset.matrixColumn)];
    if(!g||!column||crosspoint.disabled)return;
    const level=g.levels.find(l=>l.key===crosspoint.dataset.matrixLevel),plan=matrixCrosspoint({g,level},column,side,destinationRoutes,new Set(routes.filter(r=>r.locked).map(r=>r.to)),missingLevelPolicy);
    if(!state.canWrite||plan.status==='unavailable'||feedback.destinationPending(plan.destination?.id))return;
    await applyRoute(plan.source,plan.destination,{levelKey:plan.levelKey},plan);return;
  }
  const cell=e.target.closest('[data-column="name"],[data-column^="alias:"]'),row=cell?.closest('[data-group-id]');
  if(cell&&row&&!row.dataset.levelKey&&state.canWrite){
    const g=byId.get(row.dataset.groupId);if(!g)return;
    if((e.shiftKey||e.ctrlKey||e.metaKey)&&nameSelection?.column===cell.dataset.column){
      e.preventDefault();const order=nameSelection.order,anchor=order.indexOf(nameSelection.anchor),target=order.indexOf(g.id);
      if(e.shiftKey&&anchor!==-1&&target!==-1)nameSelection.ids=order.slice(Math.min(anchor,target),Math.max(anchor,target)+1);
      else{const ids=new Set(nameSelection.ids);ids.has(g.id)?ids.delete(g.id):ids.add(g.id);nameSelection.ids=order.filter(id=>ids.has(id));}
      selectedNameCell=cell;paintNameSelection();
    }else if(selectedNameCell===cell&&nameSelection?.ids.length===1)editName(g,cell.dataset.column.startsWith('alias:')?cell.dataset.column.slice(6):nameSet,cell);
    else selectNameCell(cell);
    return;
  }
  const button=e.target.closest('[data-action]');if(!button)return;
  const g=byId.get(button.dataset.id);if(!g)return;
  if(button.dataset.action==='expand'){expanded.has(g.id)?expanded.delete(g.id):expanded.add(g.id);closePopover();renderRows();}
  if(button.dataset.action==='favorite') await mutate('/api/favorite',{id:g.id});
  if(button.dataset.action==='route') openRoute(g,button.dataset.level,button);
  if(button.dataset.action==='tags') openTags(g,button);
  if(button.dataset.action==='sdp-menu')openSdpMenu(g,button.dataset.level,button);
  if(button.dataset.action==='health')openHealth(g,button.dataset.level);
};

function selectNameCell(cell){
  const previous=nameSelection;selectedNameCell=cell;
  nameSelection=cell?{column:cell.dataset.column,aliasSet:cell.dataset.column.startsWith('alias:')?cell.dataset.column.slice(6):nameSet,anchor:cell.closest('[data-group-id]').dataset.groupId,ids:[cell.closest('[data-group-id]').dataset.groupId],order:previous?.column===cell.dataset.column?[...new Set([...previous.order,...filtered.map(r=>r.g.id)])]:filtered.map(r=>r.g.id)}:null;
  paintNameSelection();
}
function paintNameSelection(){
  const ids=new Set(nameSelection?.ids||[]);
  for(const row of $$('#rows .data-row:not([data-level-key])'))for(const cell of row.children)cell.classList.toggle('name-cell-selected',nameSelection?.column===cell.dataset.column&&ids.has(row.dataset.groupId));
  updateFillTools();
}
function fillPlan(){
  if(!nameSelection||nameSelection.ids.length<2)throw new Error('Shift-click the last row to select a range.');
  const {ids,aliasSet}=nameSelection;if(ids.some(id=>!byId.has(id)))throw new Error('A selected row disappeared. Reselect the range.');
  const seed=byId.get(ids[0]),names=nameSeries(aliasSet?seed.aliases?.[aliasSet]||seed.defaultName||seed.name:seed.defaultName||seed.name,ids.length);
  return {seed:names[0],last:names.at(-1),changes:ids.slice(1).map((groupId,i)=>({groupId,aliasSet,name:names[i+1],previous:aliasSet?byId.get(groupId).aliases?.[aliasSet]||'':byId.get(groupId).defaultName||byId.get(groupId).name}))};
}
function updateFillTools(){
  $('#name-fill-tools').hidden=!nameSelection;
  let plan,error;try{plan=fillPlan();}catch(e){error=e.message;}
  const preview=fillingNames?'Saving names…':plan?`${plan.changes.length} names · ${plan.seed} → ${plan.last}`:error||'';
  $('#fill-preview').textContent=preview;$('#fill-preview').title=preview;
  $('#fill-names').disabled=!plan||!!nameEdit||fillingNames||!state?.canWrite;
  $('#fill-names').title=plan?`Keep ${plan.seed}; fill ${plan.changes.length} following selected rows through ${plan.last}`:error||'';
}
$('#fill-names').onclick=async()=>{
  if(fillingNames||nameEdit)return;
  let plan;try{plan=fillPlan();}catch(e){toast(e.message,true);return;}
  fillingNames=true;updateFillTools();
  try{
    const response=await fetch('/api/names',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({changes:plan.changes}),signal:AbortSignal.timeout(45000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Fill failed');
    etag='';accept(result);toast(`Filled ${plan.changes.length} names: ${plan.seed} → ${plan.last}`);
  }catch(e){toast(e.message,true);}finally{fillingNames=false;updateFillTools();}
};
function nextNameEditor(edit,direction){
  if(side!==edit.side||(routingLayout!=='matrix'&&layout.hidden.includes(edit.column))||$('#routing-view').hidden)return;
  const visibleIds=new Set(filtered.map(r=>r.g.id)),start=edit.order.indexOf(edit.groupId);
  for(let i=start+direction;i>=0&&i<edit.order.length;i+=direction){
    const id=edit.order[i];if(!visibleIds.has(id))continue;
    page=Math.floor(filtered.findIndex(r=>r.g.id===id)/pageSize);renderRows();
    const row=$$('#rows .data-row:not([data-level-key])').find(r=>r.dataset.groupId===id),cell=row&&[...row.children].find(c=>c.dataset.column===edit.column);
    if(cell)editName(byId.get(id),edit.aliasSet,cell,edit.order);return;
  }
  if(edit.cell.isConnected)edit.cell.querySelector('[data-edit-name]')?.focus();
}
$('#rows').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&e.target.matches('[data-edit-name]')){e.preventDefault();const row=e.target.closest('[data-group-id]'),g=byId.get(row.dataset.groupId);if(g)editName(g,nameSet,e.target.closest('[data-column]'));}
});
function endNameEdit(restoreFocus=false,render=true) {
  if(!nameEdit)return;
  const {cell}=nameEdit,row=cell.closest('[data-group-id]');nameEdit=null;
  rowMarkup.delete(row);previousRowsMarkup='';
  if(render)renderRows();else updateFillTools();
  if(restoreFocus&&cell.isConnected){const target=cell.querySelector('[data-edit-name]');if(target)target.focus();else{cell.tabIndex=-1;cell.focus();}}
}
function editName(g,aliasSet,cell,order) {
  if(fillingNames)return;
  if(nameEdit){if(nameEdit.cell===cell)nameEdit.input.focus();else toast('Finish editing the current name first.');return;}
  const set=state.aliasSets?.find(s=>s.id===aliasSet);if(aliasSet&&!set){toast('This name set no longer exists.',true);return;}
  closePopover();
  selectNameCell(cell);
  const previous=aliasSet?g.aliases?.[aliasSet]||'':g.defaultName||g.name,errorId='name-error-'+localId();
  cell.classList.add('editing-name');
  cell.innerHTML=`<form class="inline-name-editor" novalidate><input class="inline-name-input" aria-label="New name" aria-describedby="${errorId}" maxlength="200" value="${esc(previous)}" placeholder="${esc(aliasSet?g.defaultName||g.name:'Name')}" title="${esc(set?.label||'Default name')} · Enter saves and edits next row · Shift+Enter edits previous row · Escape cancels" autocomplete="off"><span class="inline-name-error" id="${errorId}" role="alert" hidden></span></form>`;
  const form=cell.querySelector('form'),input=form.querySelector('input'),error=form.querySelector('.inline-name-error');
  const edit=nameEdit={cell,input,busy:false,groupId:g.id,aliasSet,column:cell.dataset.column,side,order:order||nameSelection.order};
  if(order)nameSelection.order=order;updateFillTools();
  const showError=message=>{error.textContent=message;error.title=message;error.hidden=false;input.setAttribute('aria-invalid','true');input.title=message;};
  const save=async (restoreFocus,direction=0)=>{
    if(edit.busy||nameEdit!==edit)return;
    const name=input.value.trim();if(name===previous){endNameEdit(restoreFocus&&!direction);if(direction)nextNameEditor(edit,direction);return;}
    if((!aliasSet&&!name)||name.length>200||/[\u0000-\u001f\u007f]/.test(name)){showError('Use up to 200 characters. The default name cannot be empty.');return;}
    edit.busy=true;input.readOnly=true;form.setAttribute('aria-busy','true');error.hidden=true;input.removeAttribute('aria-invalid');
    try {
      const response=await fetch('/api/name',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groupId:g.id,aliasSet,name,previous}),signal:AbortSignal.timeout(45000)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Name update failed');
      const ownsEditor=nameEdit===edit;if(ownsEditor)endNameEdit(false,false);
      etag='';accept(result);
      if(ownsEditor&&direction)nextNameEditor(edit,direction);
      else if(ownsEditor&&restoreFocus&&cell.isConnected)cell.querySelector('[data-edit-name]')?.focus();
      toast('Name saved');
    }catch(err){
      if(nameEdit===edit&&cell.isConnected){showError(err.message);if(restoreFocus)input.focus();}
      else{if(nameEdit===edit)endNameEdit(false,false);toast(err.message,true);}
    }finally{edit.busy=false;input.readOnly=false;form.removeAttribute('aria-busy');updateFillTools();}
  };
  form.onsubmit=e=>{e.preventDefault();void save(true,1);};
  input.onkeydown=e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!edit.busy)endNameEdit(true);}
    if(e.key==='Enter'&&!e.isComposing){e.preventDefault();e.stopPropagation();void save(true,e.shiftKey?-1:1);}
  };
  input.onblur=()=>{if(!updatingNameCell)void save(false);};
  input.focus();input.select();
}

function openSdpMenu(g,levelKey,anchor) {
  if(pop?.kind==='sdp'&&pop.anchor===anchor){closePopover(true);return;}
  closePopover();pop={kind:'sdp',g,levelKey,anchor};anchor.setAttribute('aria-expanded','true');
  const menu=$('#popover');menu.classList.add('sdp-menu');menu.setAttribute('role','menu');menu.setAttribute('aria-label','SDP options');
  menu.innerHTML=[['source','Source SDP'],['destination','Destination SDP'],['route','Current route SDP']].map(([view,label])=>`<button class="option" role="menuitem" data-sdp-view="${view}">${label}</button>`).join('');
  const items=[...menu.querySelectorAll('[role="menuitem"]')];
  for(const item of items){
    item.onclick=()=>void openSdp(g,item.dataset.sdpView,levelKey);
    item.onkeydown=e=>{
      const index=items.indexOf(item);
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
        e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:items.length-1))%items.length].focus();
      }
      if(e.key==='Tab')closePopover(true);
    };
  }
  positionPopover(anchor,210);items[0].focus();
}

async function openSdp(g,view,levelKey) {
  const token=localId();$('#info-dialog').dataset.sdpToken=token;
  showDialog(`<h2>${view==='source'?'Source':view==='destination'?'Destination':'Current route'} SDP</h2><p>Loading cached stream details for ${esc(g.name)}…</p>`);
  $('#info-dialog').classList.add('sdp-dialog');
  try {
    const params=new URLSearchParams({groupId:g.id,view,side:g.side,...(levelKey?{levelKey}:{})});
    const response=await fetch('/api/sdp?'+params,{signal:AbortSignal.timeout(10000)}),data=await response.json();if(!response.ok)throw new Error(data.error||'Could not read SDP');
    if($('#info-dialog').dataset.sdpToken!==token||!$('#info-dialog').open)return;
    $('#dialog-content').innerHTML=`<div class="eyebrow">${esc(g.name)}</div><h2>${view==='source'?'Source':view==='destination'?'Destination':'Current route'} SDP</h2><p>${esc(data.note)}</p>${data.blocks.length?data.blocks.map(b=>`<section class="sdp-block"><h3>${esc(b.level)} · ${esc(b.role)} · ${esc(b.group)}</h3>${b.route?`<p>${esc(b.route)}</p>`:''}${b.error?`<p class="sdp-warning">${esc(b.error)}</p>`:''}${b.sdp?`<pre>${esc(b.sdp)}</pre>`:''}${b.updatedAt?`<small>Read ${esc(new Date(b.updatedAt).toLocaleString())}</small>`:''}</section>`).join(''):'<p>No current routes for this selection.</p>'}`;
  }catch(e){if($('#info-dialog').dataset.sdpToken===token)$('#dialog-content').innerHTML=`<h2>SDP unavailable</h2><p>${esc(e.message)}</p>`;}
}

function toast(text,error=false) {clearTimeout(toastTimer);const el=$('#toast');el.textContent=text;el.classList.toggle('error',error);el.hidden=false;toastTimer=setTimeout(()=>el.hidden=true,error?8500:4000);}
async function mutate(url,data) {
  try {
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(45000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Request failed');etag='';accept(result);return true;
  } catch(e){toast(e.message,true);return false;}
}
function closePopover(restore=false){disposeColumnSorter?.();disposeColumnSorter=null;const anchor=pop?.anchor;pop=null;$('#popover').hidden=true;$('#popover').innerHTML='';$('#popover').classList.remove('column-menu','sdp-menu');$('#popover').removeAttribute('role');$('#popover').removeAttribute('aria-label');if(anchor){anchor.setAttribute('aria-expanded','false');if(restore&&anchor.isConnected)anchor.focus();}}
function positionPopover(anchor,width=355) {
  const el=$('#popover');el.style.width=Math.min(width,window.innerWidth-24)+'px';el.hidden=false;
  const r=anchor.getBoundingClientRect(),h=el.offsetHeight;
  el.style.left=Math.max(12,Math.min(r.left,window.innerWidth-el.offsetWidth-12))+'px';
  el.style.top=(r.bottom+h+12>window.innerHeight?Math.max(12,r.top-h-5):r.bottom+5)+'px';
}
function choicePlan(g,choice,levelKey,lockedEndpoints=new Set(routes.filter(r=>r.locked).map(r=>r.to))){return routeCompatibility(g.side==='source'?g:choice,g.side==='destination'?g:choice,levelKey,lockedEndpoints,missingLevelPolicy);}
function openRoute(g,levelKey,anchor) {
  closePopover();pop={kind:'route',g,levelKey,anchor,active:0,options:[],busy:false};anchor.setAttribute('aria-expanded','true');
  const direction=g.side==='destination'?'source':'destination';
  $('#popover').innerHTML=`<div class="popover-title">Choose a ${direction}</div><div class="popover-subtitle">${esc(g.name)} · ${levelKey?esc(g.levels.find(l=>l.key===levelKey)?.name):g.levels.length+' levels · content ID matching'}</div><div class="popover-search">${icon('search')}<input id="picker-search" role="combobox" aria-label="Search compatible ${direction}s" aria-autocomplete="list" aria-controls="picker-options" aria-expanded="true" placeholder="Search ${direction}s…" autocomplete="off"></div><div class="popover-options" id="picker-options" role="listbox"></div><div class="popover-foot"><span id="picker-count"></span><span><kbd>↑</kbd> <kbd>↓</kbd> navigate &nbsp; <kbd>↵</kbd> route</span></div>`;
  renderRouteOptions('');positionPopover(anchor);$('#picker-search').focus();
  $('#picker-search').oninput=e=>{pop.active=0;renderRouteOptions(e.target.value);};
  $('#picker-search').onkeydown=e=>{
    if(!pop||pop.busy)return;
    if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();pop.active=Math.max(0,Math.min(pop.options.length-1,pop.active+(e.key==='ArrowDown'?1:-1)));highlightOption();}
    if(e.key==='Enter'){e.preventDefault();const choice=pop.options[pop.active];if(choice)void chooseRoute(choice);}
  };
}
function renderRouteOptions(q) {
  if(!pop||pop.kind!=='route')return;
  const {g,levelKey}=pop,test=compileSearch(q),targetSide=g.side==='destination'?'source':'destination';
  const lockedEndpoints=new Set(routes.filter(r=>r.locked).map(r=>r.to));
  const choices=groups.filter(c=>supportsSide(c,targetSide)&&c.id!==g.id&&test(pickerSearchFields.get(c.id))).map(c=>({group:c,plan:choicePlan(g,c,levelKey,lockedEndpoints)}));
  const rank={full:0,partial:1,unavailable:2};choices.sort((a,b)=>rank[a.plan.status]-rank[b.plan.status]||collator.compare(a.group.name,b.group.name));
  const showDisconnect=!q.length,offset=Number(showDisconnect);
  pop.options=[...(showDisconnect?[disconnectChoice]:[]),...choices.slice(0,80).map(c=>c.group)];
  const current=g.levels.filter(l=>!levelKey||l.key===levelKey).flatMap(l=>levelRoutes(g,l));
  const disconnectDisabled=!current.length||current.some(r=>r.locked);
  const disconnectMarkup=showDisconnect?`<button id="choice-0" class="option disconnect-option" role="option" data-disconnect aria-disabled="${disconnectDisabled}" ${disconnectDisabled?'disabled':''}><span class="disconnect-symbol">⊘</span><span class="option-text">Disconnect<small>${!current.length?'Already disconnected':current.some(r=>r.locked)?'Locked':levelKey?'Disconnect this level'+(g.side==='source'?' from all destinations':''):g.side==='source'?'Disconnect all destinations · all levels':'Disconnect all routed levels'}</small></span></button>`:'';
  $('#picker-options').innerHTML=disconnectMarkup+(choices.length?choices.slice(0,80).map(({group:c,plan},index)=>{const i=index+offset;return `<button id="choice-${i}" class="option ${plan.status}${i===pop.active?' keyboard-active':''}" role="option" aria-selected="${i===pop.active}" aria-disabled="${plan.status==='unavailable'}" ${plan.status==='unavailable'?'disabled':''} data-choice="${esc(c.id)}" title="${esc(c.description)} · ${esc(plan.reason)}"><i class="small-dot"></i><span class="option-text">${esc(c.name)}<small>${esc(c.description.split('\n')[0]||c.system)}</small>${plan.status!=='full'?`<span class="option-warning">${esc(plan.reason)}</span>`:''}</span><span class="option-meta">${plan.matches.length}/${plan.required.length} levels</span></button>`;}).join(''):'<div class="option-empty">No matching '+targetSide+'s found.</div>');
  $('#picker-count').textContent=`${number(choices.length)} ${targetSide}${choices.length===1?'':'s'}${choices.length>80?' · first 80 shown':''}`;
  $$('#picker-options [data-choice]').forEach(b=>b.onclick=()=>void chooseRoute(byId.get(b.dataset.choice)));
  $('#picker-options [data-disconnect]')?.addEventListener('click',()=>void chooseRoute(disconnectChoice));
  highlightOption();
}
function highlightOption() {
  $$('#picker-options .option').forEach((b,i)=>{b.classList.toggle('keyboard-active',i===pop.active);b.setAttribute('aria-selected',i===pop.active);});
  $('#picker-search')?.setAttribute('aria-activedescendant','choice-'+pop.active);
  $(`#choice-${pop.active}`)?.scrollIntoView({block:'nearest'});
}
async function chooseRoute(choice) {
  if(!pop||pop.busy)return;
  if(choice.action==='disconnect') {
    const {g,levelKey}=pop,selected=g.levels.filter(l=>!levelKey||l.key===levelKey).flatMap(l=>levelRoutes(g,l));
    if(!selected.length||selected.some(r=>r.locked))return;
    pop.busy=true;await applyDisconnect(g,levelKey,selected);return;
  }
  const {g,levelKey}=pop,source=g.side==='source'?g:choice,destination=g.side==='destination'?g:choice;
  const plan=choicePlan(g,choice,levelKey);if(plan.status==='unavailable'){announceRoute(plan.reason);return;}
  pop.busy=true;await applyRoute(source,destination,{levelKey},plan);
}
async function applyRoute(source,destination,{levelKey}={},plan=routeCompatibility(source,destination,levelKey)) {
  const expected=plan.matches.map(l=>({to:l.id,from:source.levels.find(s=>s.key===l.key).id}));
  const selection=levelKey?{levelKey}:{};
  const missing=missingLevelPolicy==='disconnect'&&!levelKey?plan.unchanged.map(x=>x.level):[];
  const removed=missing.flatMap(l=>levelRoutes(destination,l)).map(({from,to})=>({from,to}));
  const operation=feedback.begin({sourceId:source.id,destinationId:destination.id,...selection,levelKeys:[...plan.matches,...missing].map(l=>l.key),clearedLevelKeys:missing.map(l=>l.key),expected,removed,description:`${source.name} → ${destination.name}${levelKey?' · '+levelKey:' · '+plan.matches.length+' of '+plan.required.length+' levels'}${missing.length?' · missing levels disconnected':''}`});
  closePopover();updateFeedback();announceRoute('Applying '+operation.description);
  try {
    const response=await fetch('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceId:source.id,destinationId:destination.id,...selection,missingLevelPolicy}),signal:AbortSignal.timeout(45000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Route request failed');
    operation.removed=result.disconnectedRoutes||removed;
    feedback.accepted(operation,response.status===202||result.routePending===true);
    etag='';accept(result);updateFeedback();
    if(operation.status==='success'){announceRoute('Route confirmed: '+operation.description);toast('Route confirmed: '+operation.description);}
    else announceRoute('Waiting for the engine to confirm: '+operation.description);
    return {operation};
  } catch(e){feedback.finish(operation,'error',e.message);updateFeedback();announceRoute('Route error: '+e.message);toast(e.message,true);return {operation};}
}

async function applyDisconnect(g,levelKey,selected) {
  const affected=new Map();
  for(const route of selected) for(const endpoint of [route.from,route.to]) {
    const owner=endpointOwner.get(endpoint);if(!owner)continue;
    if(!affected.has(owner.id))affected.set(owner.id,new Set());
    for(const level of owner.levels)if(level.id===endpoint)affected.get(owner.id).add(level.key);
  }
  const operation=feedback.begin({action:'disconnect',groupId:g.id,levelKey,expected:[],removed:selected.map(({from,to})=>({from,to})),affectedRows:[...affected].map(([id,keys])=>({id,levelKeys:[...keys]})),description:`Disconnect ${g.name}${levelKey?' · '+g.levels.find(l=>l.key===levelKey)?.name:' · all levels'}`});
  closePopover();updateFeedback();announceRoute('Applying '+operation.description);
  try {
    const response=await fetch('/api/disconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groupId:g.id,side:g.side,...(levelKey?{levelKey}:{})}),signal:AbortSignal.timeout(45000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Disconnect request failed');
    operation.removed=result.disconnectedRoutes||operation.removed;
    feedback.accepted(operation,response.status===202||result.routePending===true);
    etag='';accept(result);updateFeedback();
    if(operation.status==='success'){announceRoute('Confirmed: '+operation.description);toast('Confirmed: '+operation.description);}
    else announceRoute('Waiting for the engine to confirm: '+operation.description);
  } catch(e){feedback.finish(operation,'error',e.message);updateFeedback();announceRoute('Disconnect error: '+e.message);toast(e.message,true);}
}

function announceRoute(message){$('#route-announcement').textContent=message;}
function paintFeedback() {
  for(const row of $$('#rows .data-row')) {
    const operation=feedback.forRow(row.dataset.groupId,row.dataset.levelKey);
    for(const status of ['pending','success','error']) row.classList.toggle('route-'+status,operation?.status===status);
    row.setAttribute('aria-busy',String(operation?.status==='pending'));
    const feedbackKey=operation?`${operation.id}:${operation.status}:${operation.changedAt}`:'';
    if(row.dataset.feedbackKey!==feedbackKey){row.dataset.feedbackKey=feedbackKey;row.style.setProperty('--feedback-elapsed',`${operation?Math.min(0,operation.changedAt-Date.now()):0}ms`);}
    const button=row.querySelector('.route-button');if(!button)continue;
    button.dataset.originalTitle ??= button.title;
    const label=button.querySelector('.route-feedback-label');
    label.hidden=!operation;
    label.textContent=operation?(operation.status==='pending'?(operation.phase==='syncing'?'Syncing…':'Pending…'):operation.status==='success'?(operation.action==='disconnect'||operation.clearedLevelKeys?.includes(row.dataset.levelKey)?'✓ Disconnected':'✓ Routed'):'✕ Error'):'';
    button.title=operation?.status==='error'?operation.message:button.dataset.originalTitle;
    button.disabled=button.dataset.unavailable==='true'||feedback.destinationPending(row.dataset.groupId);
  }
}
function updateFeedback() {
  clearTimeout(feedbackTimer);if(routingLayout==='matrix')renderRows();else paintFeedback();
  panelsView.status();
  const expiry=feedback.nextExpiry();
  if(Number.isFinite(expiry))feedbackTimer=setTimeout(()=>{feedback.sweep();updateFeedback();},Math.max(1,expiry-Date.now()+5));
}
function reconcileFeedback() {
  for(const operation of feedback.synchronize(state)) {
    announceRoute('Route confirmed: '+operation.description);toast('Route confirmed: '+operation.description);
  }
  feedback.sweep();updateFeedback();
}
function openTags(g,anchor) {
  closePopover();pop={kind:'tags',g,anchor,busy:false};anchor.setAttribute('aria-expanded','true');
  $('#popover').innerHTML=`<div class="popover-title">Edit tags</div><div class="popover-subtitle">${esc(g.name)} · shared Route Desk tags</div><div class="popover-search">${icon('search')}<input id="tag-search" aria-label="Find or create a tag" placeholder="Find or create a tag…" maxlength="48" autocomplete="off"></div><div class="popover-options" id="tag-options"></div><div class="popover-foot"><span>${state?.ephemeralState?'Memory only · resets on restart':'Saved to the Route Desk data volume'}</span><span><kbd>Esc</kbd> close</span></div>`;
  renderTagOptions('');positionPopover(anchor,310);$('#tag-search').focus();
  $('#tag-search').oninput=e=>renderTagOptions(e.target.value);
  $('#tag-search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const value=e.target.value.trim();if(value)void toggleTag(value);}};
}
function renderTagOptions(q) {
  if(!pop||pop.kind!=='tags')return;
  const selected=new Set(getTags(byId.get(pop.g.id))),library=[...new Set([...state.metadata.tagLibrary,...groups.flatMap(g=>getTags(g))])].sort();
  const test=compileSearch(q),choices=library.filter(t=>test(t)).sort((a,b)=>Number(selected.has(b))-Number(selected.has(a))).slice(0,50);
  const exact=library.find(t=>t.toLowerCase()===q.trim().toLowerCase());
  $('#tag-options').innerHTML=(q.trim()&&!exact?`<button class="option" data-tag="${esc(q.trim())}">${icon('plus')}<span class="option-text">Create “${esc(q.trim())}”</span></button>`:'')+choices.map(t=>`<button class="option" data-tag="${esc(t)}" aria-pressed="${selected.has(t)}">${tagMarkup(t)}<span class="option-meta">${selected.has(t)?'<span class="check">✓</span>':'Add'}</span></button>`).join('')+(!choices.length&&!q.trim()?'<div class="option-empty">Type to create your first tag.</div>':'');
  $$('#tag-options [data-tag]').forEach(b=>b.onclick=()=>void toggleTag(b.dataset.tag));
}
async function toggleTag(value) {
  if(!pop||pop.busy)return;pop.busy=true;
  const id=pop.g.id,search=$('#tag-search').value,tags=new Set(getTags(byId.get(id)));
  // Reuse spelling of an existing tag instead of creating case variants.
  const canonical=[...state.metadata.tagLibrary,...groups.flatMap(g=>getTags(g))].find(t=>t.toLowerCase()===value.toLowerCase())||value;
  tags.has(canonical)?tags.delete(canonical):tags.add(canonical);
  $$('#tag-options button').forEach(b=>b.disabled=true);
  await mutate('/api/tags',{id,tags:[...tags]});
  if(pop?.kind==='tags'){pop.busy=false;renderTagOptions(search);$('#tag-search').focus();}
}
document.addEventListener('pointerdown',e=>{if((e.shiftKey||e.ctrlKey||e.metaKey)&&e.target.closest('#rows [data-column="name"],#rows [data-column^="alias:"]')&&!e.target.closest('.inline-name-editor'))e.preventDefault();if(pop&&!$('#popover').contains(e.target)&&!pop.anchor.contains(e.target))closePopover();if(nameSelection&&!e.target.closest('#name-fill-tools,#rows [data-column="name"],#rows [data-column^="alias:"],#prev-page,#next-page,#page-size'))selectNameCell(null);});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closePopover(true);
  const editing=document.activeElement.matches('input,textarea,select,[contenteditable="true"]');
  const nameShortcut=(e.ctrlKey&&e.shiftKey&&!e.altKey&&!e.metaKey&&e.key.toLowerCase()==='f')||(!editing&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&e.key.toLowerCase()==='f');
  if(nameShortcut&&!$('#info-dialog').open){e.preventDefault();closePopover();if(layout.hidden.includes('name')){layout.hidden=layout.hidden.filter(id=>id!=='name');saveColumns();}if($('#routing-view').hidden)$('[data-view="'+(routingLayout==='matrix'?'matrix':'routing')+'"]').click();const input=routingLayout==='matrix'?$('#matrix-row-search'):$('[data-filter="name"]');input.focus();input.select();return;}
  if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('#info-dialog').open){e.preventDefault();$('#global-search').focus();}
});
$('.table-scroll').addEventListener('scroll',()=>closePopover(),{passive:true});
window.addEventListener('resize',()=>closePopover());

function renderActivity() {
  if(!state)return;
  $('#activity-list').innerHTML=state.metadata.activity.length?state.metadata.activity.map(a=>`<div class="activity-item">${icon(a.type==='route'?'route':'tag')}<div><strong>${esc(a.text)}</strong><small>${a.type==='route'?'Route change':a.type==='setup'?'Settings':a.type==='group'?'Manual group':a.type==='name'?'Name change':'Tag update'} · ${state.mode==='demo'?'demo facility':'live NMOS facility'}</small></div><time>${esc(new Date(a.time).toLocaleString())}</time></div>`).join(''):'<div class="empty-state"><strong>No activity yet</strong><span>Your route changes and tag edits will appear here.</span></div>';
}
const nmosView=createNmosViewer($('#nmos-view'),{
  onGroupCreated:result=>{accept(result.inventory);toast('Group confirmed');},
  onOpenGroup:result=>{const group=byId.get(result.groupId);if(!group)return;$('[data-view="routing"]').click();$('#tab-'+group.side).click();$('#clear-filters').click();query=group.name;$('#global-search').value=query;resetPage();renderRows();},
});
const setupView=createSetup($('#setup-view'),{toast,canWrite:()=>!!state?.canWrite,onSaved:()=>poll(true)});
const panelsView=createPanels($('#panels-view'),{
  getData:()=>({state,groups,tags:g=>getTags(g)||[],policy:missingLevelPolicy}),
  onTake:(source,destination,plan)=>applyRoute(source,destination,{},plan),
  notify:toast,
});
$$('button[data-view]').forEach(b=>b.onclick=()=>{
  const routing=['routing','matrix'].includes(b.dataset.view);
  $('#routing-view').hidden=!routing;$('#activity-view').hidden=b.dataset.view!=='activity';$('#nmos-view').hidden=b.dataset.view!=='nmos';
  $('#setup-view').hidden=b.dataset.view!=='setup';setupView.setVisible(b.dataset.view==='setup');
  watchEngineLog(b.dataset.view==='activity');
  $('#panels-view').hidden=b.dataset.view!=='panels';panelsView.setVisible(b.dataset.view==='panels');
  if(b.dataset.view==='panels')history.replaceState(null,'',location.pathname+location.search+'#panels');
  else if(location.hash==='#panels')history.replaceState(null,'',location.pathname+location.search);
  if(routing){routingLayout=b.dataset.view==='matrix'?'matrix':'table';localStorage.setItem('nmos-routing-layout',routingLayout);changeMatrixView();}
  nmosView.setVisible(b.dataset.view==='nmos');
  $$('button[data-view]').forEach(el=>el.classList.toggle('active',el===b));closePopover();
});
$('.rail-button[data-view="'+(routingLayout==='matrix'?'matrix':'routing')+'"]').classList.add('active');
if(routingLayout==='matrix')$('.rail-button[data-view="routing"]').classList.remove('active');
if(location.hash==='#panels')$('.rail-button[data-view="panels"]').click();
function showDialog(content){closePopover();$('#info-dialog').classList.remove('sdp-dialog','group-dialog');$('#dialog-content').innerHTML=content;if(!$('#info-dialog').open)$('#info-dialog').showModal();}
function showColumns() {
  closePopover();const anchor=$('#columns');pop={kind:'columns',anchor};anchor.setAttribute('aria-expanded','true');
  renderColumnMenu();positionPopover(anchor,265);
  const r=anchor.getBoundingClientRect();$('#popover').style.left=Math.max(12,Math.min(r.right-$('#popover').offsetWidth,window.innerWidth-$('#popover').offsetWidth-12))+'px';
  $('#reset-columns').focus();
}
function saveColumns() {savedLayout=null;layout=columnLayout(layout,columns);localStorage.setItem('nmos-columns',JSON.stringify(layout));applyColumns();rebuildRecords();renderRows();updateSuggestions();}
function renderColumnMenu() {
  disposeColumnSorter?.();
  const menu=$('#popover');menu.classList.add('column-menu');menu.setAttribute('role','dialog');menu.setAttribute('aria-label','Choose and reorder columns');
  menu.innerHTML=`<button class="restore-columns" id="reset-columns">Restore defaults</button><button class="restore-columns" id="add-spacer" ${layout.spacers.length>=20?'disabled':''}>＋ Add spacer</button><div class="column-menu-scroll"><div class="column-list" role="list" aria-label="Column order">${layout.order.map(id=>{const c=columns.find(c=>c.id===id);return `<div class="column-choice" role="listitem" data-column-id="${esc(id)}"><label><input type="checkbox" data-visible="${esc(id)}" aria-label="Show ${esc(c.label)}" ${layout.hidden.includes(id)?'':'checked'}><span>${esc(c.label)}</span></label>${c.spacer?`<button class="remove-spacer" data-remove-spacer="${esc(id)}" aria-label="Remove ${esc(c.label)}">×</button>`:''}<button class="column-grip" data-drag-column="${esc(id)}" data-label="${esc(c.label)}" aria-label="Reorder ${esc(c.label)}" aria-pressed="false" title="Drag to reorder. Keyboard: Space, arrow keys, Space to drop; Escape to cancel."><svg viewBox="0 0 24 18" aria-hidden="true"><path d="M3 6h18M3 11h18"/></svg></button></div>`;}).join('')}</div><details class="column-widths"><summary>Column widths</summary>${layout.order.map(id=>{const c=columns.find(c=>c.id===id);return `<label>${esc(c.label)}<span><input type="number" min="${c.min}" max="700" step="1" value="${layout.widths[id]}" data-width="${esc(id)}" aria-label="${esc(c.label)} width"> px</span></label>`;}).join('')}</details></div><div class="column-menu-hint">Drag lines to reorder · drag header edges to resize</div><span class="sr-only" id="column-announcement" role="status" aria-live="polite"></span>`;
  const updateChecks=()=>{const visible=columns.filter(c=>!c.spacer&&!layout.hidden.includes(c.id));$$('[data-visible]').forEach(input=>input.disabled=visible.length===1&&input.checked&&input.dataset.visible===visible[0].id);};
  updateChecks();
  disposeColumnSorter=attachColumnSorter($('.column-list'),{onChange:order=>{layout.order=order;saveColumns();},announce:text=>$('#column-announcement').textContent=text});
  $$('[data-width]').forEach(input=>{
    input.oninput=()=>{if(input.checkValidity()&&input.value){layout.widths[input.dataset.width]=input.value;saveColumns();}};
    input.onchange=()=>{layout.widths[input.dataset.width]=input.value;saveColumns();input.value=layout.widths[input.dataset.width];};
  });
  $$('[data-visible]').forEach(input=>input.onchange=()=>{layout.hidden=layout.hidden.filter(id=>id!==input.dataset.visible);if(!input.checked)layout.hidden.push(input.dataset.visible);saveColumns();updateChecks();});
  const rebuild=()=>{columns=workspaceColumns(state?.aliasSets||[],layout.spacers);saveColumns();renderColumnMenu();};
  $('#add-spacer').onclick=()=>{layout.spacers.push({id:'spacer:'+localId()});rebuild();};
  $$('[data-remove-spacer]').forEach(button=>button.onclick=()=>{layout.spacers=layout.spacers.filter(s=>s.id!==button.dataset.removeSpacer);rebuild();});
  $('#reset-columns').onclick=()=>{columns=workspaceColumns(state?.aliasSets||[]);layout=columnLayout({},columns);saveColumns();renderColumnMenu();$('#reset-columns').focus();};
}
$('#columns').onclick=()=>{if(pop?.kind==='columns')closePopover(true);else showColumns();};
function help(){showDialog(`<div class="eyebrow">A FASTER WAY TO ROUTE</div><h2>Find it. Route it.</h2><p>Search any column as you type. Filters work together, and every search runs against the local cache.</p><dl><dt>Contains, by default</dt><dd><code>REPLAY</code> finds any field containing REPLAY</dd><dt>Either term</dt><dd><code>PCR1 | PCR2</code></dd><dt>Exact field match</dt><dd><code>"REPLAY 56"</code></dd><dt>Both terms</dt><dd><code>REPLAY 56</code></dd><dt>Wildcards</dt><dd><code>PCR?*PGM</code> · <code>*</code> any characters, <code>?</code> one</dd><dt>Display name search</dt><dd>Press <code>F</code> outside a text field, or <code>Ctrl+Shift+F</code> from another input</dd><dt>Global search</dt><dd>Press <code>/</code> outside a text field</dd></dl><p>Click a current route to assign a compatible source. Expand the group for individual video, audio, and ANC levels. The Sources tab lets you assign destinations in the same way.</p><p class="dialog-note">Group routing matches schema content IDs. Missing levels disconnect by default; change this to Keep existing in Settings. Individual routing creates a breakaway. Tags are shared Route Desk metadata, stored locally on the server.</p>`);}
$('#help').onclick=help;$('#search-help').onclick=help;$('#close-dialog').onclick=()=>$('#info-dialog').close();
$('#info-dialog').addEventListener('click',e=>{if(e.target===$('#info-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#settings').onclick=()=>{
  const theme=document.documentElement.dataset.theme||'current';
  const appearance=`<label class="setting-label" for="appearance-theme">Appearance</label><select id="appearance-theme" data-theme-picker><option value="current" ${theme==='current'?'selected':''}>Medium</option><option value="sapphire" ${theme==='sapphire'?'selected':''}>Light</option><option value="graphite" ${theme==='graphite'?'selected':''}>Dark</option></select><p class="setting-help">Saved in this browser across refreshes and reloads.</p>`;
  showDialog(`<div class="eyebrow">SETTINGS</div><h2>Your routing workspace</h2>${appearance}<label class="setting-label" for="missing-level-policy">Missing levels when routing a group</label><select id="missing-level-policy"><option value="disconnect" ${missingLevelPolicy==='disconnect'?'selected':''}>Disconnect missing levels (default)</option><option value="keep" ${missingLevelPolicy==='keep'?'selected':''}>Keep existing routes</option></select><p class="setting-help">Applies when a source lacks a destination content ID. Saved in this browser across refreshes and reloads.</p><dl><dt>Service address</dt><dd><code>${esc(location.origin)}</code></dd><dt>Panel URL</dt><dd><code>${esc(location.origin)}/embed</code></dd><dt>Browser updates</dt><dd>${browserLive?'WebSocket':'HTTP fallback · every 1s'}</dd><dt>Engine updates</dt><dd>${state?.stream?.controller==='live'?'Registry WebSocket push':'Polling every '+(state?.syncSeconds||5)+'s'}</dd><dt>Safety refresh</dt><dd>Every ${state?.stream?.reconciliationSeconds||state?.syncSeconds||5}s</dd><dt>Last synchronization</dt><dd>${state?.lastSync?esc(new Date(state.lastSync).toLocaleString()):'Not yet synchronized'}</dd><dt>Routing</dt><dd>${state?.canWrite?'Enabled':'Read-only'}</dd><dt>Search</dt><dd>Local browser cache · no API calls while typing</dd><dt>Tags</dt><dd>${state?.ephemeralState?'Memory only · resets on restart':'Persistent shared metadata'}</dd></dl><p class="dialog-note">Registry discovery and engine settings are configured on the server. Changes to sources, destinations, and routes are picked up automatically.</p>`);
  $('#missing-level-policy').onchange=e=>{missingLevelPolicy=e.target.value;localStorage.setItem('nmos-missing-level-policy',missingLevelPolicy);toast('Missing levels: '+(missingLevelPolicy==='keep'?'keep existing routes':'disconnect'));};
};
// ---- BCP-008 health (IS-12 status monitors) ----
const HEALTH_LABEL={0:'Inactive',1:'Healthy',2:'Partially healthy',3:'Unhealthy'};
function healthCell(g,level){
  const m=level?level.monitor:g.monitor;
  if(!m)return '<span class="muted">—</span>';
  const status=level?m.status:m.worst,text=level?HEALTH_LABEL[status]||'Unknown':(m.count?m.count+' affected':HEALTH_LABEL[status]||'Healthy');
  const title=level?(m.message||HEALTH_LABEL[status]||'')+(m.detail?'\n'+m.detail:''):'Worst flow status: '+(HEALTH_LABEL[status]||status);
  return '<button class="health-button" data-action="health" data-id="'+esc(g.id)+'"'+(level?' data-level="'+esc(level.key)+'"':'')+' title="'+esc(title)+'" aria-label="BCP-008 status for '+esc(g.name)+(level?' '+esc(level.name):'')+'"><span class="health-dot s'+esc(status)+'"></span><span>'+esc(text)+'</span></button>';
}
async function openHealth(g,levelKey){
  const level=levelKey?g.levels.find(l=>l.key===levelKey):null;
  const targets=level?[level]:g.levels.filter(l=>l.monitor);
  if(!targets.length){toast('No BCP-008 monitor reported for this group',true);return;}
  const block=l=>{const m=l.monitor||{};return '<section class="setup-section"><h3>'+esc(l.name)+' · '+esc(l.flowName||'')+'</h3><p><span class="health-dot s'+esc(m.status)+'"></span> '+esc(HEALTH_LABEL[m.status]||'Unknown')+(m.message?' · '+esc(m.message):'')+(m.counter?' · '+esc(m.counter)+' transitions since reset':'')+'</p>'
    +(m.domains?.length?'<div class="health-domains">'+m.domains.map(d=>'<span class="d">'+esc(d.label)+'</span><span><span class="health-dot s'+esc(d.status)+'"></span> '+esc(HEALTH_LABEL[d.status]||'')+(d.message?' · '+esc(d.message):'')+'</span><span class="d">'+esc(d.counter||0)+' transitions</span>').join('')+'</div>':'<p class="muted">The device does not publish per-domain status.</p>')
    +'<div class="health-counters" data-counters="'+esc(l.id)+'"><span class="muted">Reading packet counters…</span></div>'
    +(state?.canWrite?'<button type="button" class="quiet-button" data-reset="'+esc(l.id)+'">Reset counters</button>':'')+'</section>';};
  showDialog('<div class="eyebrow">BCP-008 STATUS</div><h2>'+esc(g.name)+'</h2><p>Live health from the device\'s NcSender/NcReceiverMonitor over IS-12. Counters are read from the device now; status follows registry pushes.</p>'+targets.map(block).join(''));
  for(const box of $$('#dialog-content [data-counters]')){
    try{const r=await fetch('/api/bcp008/counters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:box.dataset.counters}),signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Counters unavailable');
      box.innerHTML=data.groups.map(gr=>'<table><thead><tr><th colspan="2">'+esc(gr.label)+'</th></tr></thead><tbody>'+gr.counters.map(c=>'<tr><td>'+esc(c.name)+'</td><td>'+esc(c.value)+'</td></tr>').join('')+'</tbody></table>').join('');
    }catch(e){box.innerHTML='<span class="muted">'+esc(e.message)+'</span>';}
  }
  for(const b of $$('#dialog-content [data-reset]'))b.onclick=async()=>{b.disabled=true;try{const r=await fetch('/api/bcp008/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:b.dataset.reset})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Reset failed');toast('Counters reset');}catch(e){toast(e.message,true);}finally{b.disabled=false;}};
}
// ---- Engine log (Activity view) ----
let engineLogLast=0,engineLogTimer=null,engineLogLines=[];
async function loadEngineLog(){
  try{const r=await fetch('/api/engine?after='+engineLogLast,{signal:AbortSignal.timeout(8000)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Engine log unavailable');
    if(data.log.length){engineLogLines=[...engineLogLines,...data.log].slice(-400);engineLogLast=data.log[data.log.length-1].id;}
    $('#engine-log-status').textContent=data.mode==='demo'?'Demo mode · the engine is not running':(data.connected?'Registry '+data.registry.ip+':'+data.registry.port+' connected':'No registry connected')+' · '+engineLogLines.length+' recent entries';
    const box=$('#engine-log'),atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<40;
    box.innerHTML=engineLogLines.length?engineLogLines.map(l=>'<div class="log-line"><time>'+esc(new Date(l.time).toLocaleTimeString())+'</time><span class="sev-'+esc(l.severity)+'">'+esc(l.severity)+'</span><span>'+esc(l.topic)+'</span><span>'+esc(l.text)+'</span></div>').join(''):'<div class="log-line"><span class="muted">No engine log entries yet.</span></div>';
    if(atBottom)box.scrollTop=box.scrollHeight;
  }catch(e){$('#engine-log-status').textContent=e.message;}
}
function watchEngineLog(on){clearInterval(engineLogTimer);engineLogTimer=null;if(on){loadEngineLog();engineLogTimer=setInterval(loadEngineLog,4000);}}
// ---- Manual routing groups ----
const groupBuilder={groups:[],catalog:[],unresolved:[],draft:null,filter:''};
function groupDraft(group){return group?{id:group.id,side:group.side,name:group.name,levels:group.levels.map(l=>l.flowId)}:{id:null,side:'destination',name:'',levels:[]};}
function renderGroupBuilder(){
  const b=groupBuilder,d=b.draft,byId=new Map(b.catalog.map(f=>[f.id,f]));
  const claimed=new Map(b.groups.filter(g=>g.id!==d.id).flatMap(g=>g.levels.map(l=>[l.flowId,g.name])));
  const counters={};const chosen=d.levels.map(id=>{const f=byId.get(id);const type=f?.type||'unknown';counters[type]=(counters[type]||0)+1;return {f,id,key:type+'-'+counters[type]};});
  const query=b.filter.trim().toLowerCase();
  const available=b.catalog.filter(f=>f.side===d.side&&!d.levels.includes(f.id)&&(!query||(f.name+' '+f.deviceName+' '+f.flowName).toLowerCase().includes(query))).slice(0,300);
  const list=b.groups.length?b.groups.map(g=>'<button type="button" data-group="'+esc(g.id)+'" class="'+(g.id===d.id?'selected':'')+'"><strong>'+esc(g.name)+'</strong><small>'+(g.side==='source'?'Source':'Destination')+' · '+g.levels.length+' flow'+(g.levels.length===1?'':'s')+(b.unresolved.some(u=>u.id===g.id)?' · flows missing':'')+'</small></button>').join(''):'<div class="group-empty">No manual groups yet. Automatic groups follow NMOS devices and BCP-002-01 grouphints.</div>';
  const chosenMarkup=chosen.map((c,i)=>'<li><span class="flow-key">'+esc(c.key)+'</span><span class="flow-meta"><span>'+esc(c.f?.name||c.id)+'</span><span>'+esc(c.f?.deviceName||'missing flow')+'</span></span><button type="button" data-move="'+i+'" data-dir="-1" aria-label="Move up"'+(i?'':' disabled')+'>↑</button><button type="button" data-move="'+i+'" data-dir="1" aria-label="Move down"'+(i<chosen.length-1?'':' disabled')+'>↓</button><button type="button" data-remove="'+i+'" aria-label="Remove">×</button></li>').join('')||'<li class="group-empty">Add flows from the right.</li>';
  const availableMarkup=available.map(f=>'<li><span class="flow-meta"><span>'+esc(f.name)+'</span><span>'+esc(f.deviceName)+' · '+esc(f.kind)+(claimed.has(f.id)?' · in '+esc(claimed.get(f.id)):'')+'</span></span><button type="button" data-add="'+esc(f.id)+'"'+(claimed.has(f.id)?' disabled title="Already in another manual group"':'')+'>Add</button></li>').join('')||'<li class="group-empty">No matching flows.</li>';
  $('#dialog-content').innerHTML='<div class="eyebrow">ROUTING GROUPS</div><h2>Manual groups</h2><p>Combine any flows into a routable group. A flow you claim here leaves its automatic group; deleting the manual group returns it. Nothing is written to devices.</p>'
    +'<div class="group-builder"><div><div class="group-actions group-actions-top"><button type="button" class="quiet-button" id="group-new">+ New group</button></div><div class="group-list">'+list+'</div></div>'
    +'<form class="group-form" id="group-form"><label>Name<input name="name" maxlength="120" required value="'+esc(d.name)+'" placeholder="e.g. Studio A wall"></label>'
    +'<label>Side<select name="side"'+(d.levels.length?' disabled':'')+'><option value="destination"'+(d.side==='destination'?' selected':'')+'>Destination (receivers)</option><option value="source"'+(d.side==='source'?' selected':'')+'>Source (senders)</option></select>'+(d.levels.length?'<small>Remove all flows to change the side.</small>':'')+'</label>'
    +'<div class="group-pick"><div><h4>Levels · '+chosen.length+'</h4><ol id="group-chosen">'+chosenMarkup+'</ol></div>'
    +'<div><h4>Available '+(d.side==='source'?'senders':'receivers')+'</h4><input id="group-filter" placeholder="Filter by flow or device…" value="'+esc(b.filter)+'" autocomplete="off" class="group-filter"><ul>'+availableMarkup+'</ul></div></div>'
    +'<div class="group-actions"><button type="submit" class="primary">'+(d.id?'Save group':'Create group')+'</button><span id="group-status" role="status"></span>'+(d.id?'<button type="button" class="danger" id="group-delete">Delete group</button>':'')+'</div></form></div>';
  $('#group-new').onclick=()=>{b.draft=groupDraft(null);b.filter='';renderGroupBuilder();};
  for(const el of $$('#dialog-content [data-group]'))el.onclick=()=>{b.draft=groupDraft(b.groups.find(g=>g.id===el.dataset.group));b.filter='';renderGroupBuilder();};
  for(const el of $$('#dialog-content [data-add]'))el.onclick=()=>{d.levels.push(el.dataset.add);renderGroupBuilder();$('#group-filter').focus();};
  for(const el of $$('#dialog-content [data-remove]'))el.onclick=()=>{d.levels.splice(Number(el.dataset.remove),1);renderGroupBuilder();};
  for(const el of $$('#dialog-content [data-move]'))el.onclick=()=>{const i=Number(el.dataset.move),j=i+Number(el.dataset.dir);[d.levels[i],d.levels[j]]=[d.levels[j],d.levels[i]];renderGroupBuilder();};
  const filter=$('#group-filter');filter.oninput=()=>{b.filter=filter.value;const pos=filter.selectionStart;renderGroupBuilder();const next=$('#group-filter');next.focus();next.setSelectionRange(pos,pos);};
  const form=$('#group-form');form.elements.name.oninput=()=>{d.name=form.elements.name.value;};form.elements.side.onchange=()=>{d.side=form.elements.side.value;renderGroupBuilder();};
  form.onsubmit=async e=>{e.preventDefault();d.name=form.elements.name.value;$('#group-status').textContent='Saving…';
    const ok=await mutate('/api/groups',{group:{id:d.id||undefined,side:d.side,name:d.name,levels:d.levels}});
    if(ok){toast(d.id?'Group saved':'Group created');await loadGroupBuilder(state?.manualGroups?.find(g=>g.name===d.name&&g.side===d.side)?.id||null);}else $('#group-status').textContent='';};
  if($('#group-delete'))$('#group-delete').onclick=async()=>{if(!confirm('Delete manual group "'+d.name+'"? Its flows return to their automatic groups.'))return;if(await mutate('/api/groups/delete',{id:d.id})){toast('Group deleted');await loadGroupBuilder(null);}};
}
async function loadGroupBuilder(selectId){
  try{const response=await fetch('/api/groups',{signal:AbortSignal.timeout(10000)}),data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load groups');
    Object.assign(groupBuilder,{groups:data.groups,catalog:data.catalog,unresolved:data.unresolved});
    groupBuilder.draft=groupDraft(selectId?data.groups.find(g=>g.id===selectId):null);renderGroupBuilder();
  }catch(e){toast(e.message,true);}
}
$('#manual-groups').onclick=()=>{groupBuilder.filter='';showDialog('<div class="eyebrow">ROUTING GROUPS</div><h2>Manual groups</h2><p>Loading…</p>');$('#info-dialog').classList.add('group-dialog');loadGroupBuilder(null);};
$('#refresh').onclick=async()=>{if(polling)return;polling=true;$('#refresh').classList.add('spin');await mutate('/api/sync',{});$('#refresh').classList.remove('spin');polling=false;if(!state?.error)toast('Inventory synchronized');};
async function poll(force=false) {
  if(force)etag='';
  if(polling)return;polling=true;
  try {
    const response=await fetch('/api/inventory',{headers:etag?{'If-None-Match':etag}:{},signal:AbortSignal.timeout(15000)});
    if(response.status===304){if(state){state.lastSync=response.headers.get('X-Last-Sync')||state.lastSync;state.error=decodeURIComponent(response.headers.get('X-Sync-Error')||'')||null;renderStatus();if(feedback.operations.size)reconcileFeedback();}return;}
    if(!response.ok)throw new Error(`Route Desk returned HTTP ${response.status}`);
    etag=response.headers.get('ETag')||'';accept(await response.json());
  } catch(e){if(state){state.error='Route Desk is unreachable';renderStatus();}else $('#rows').innerHTML='<div class="empty-state"><strong>Cannot load inventory</strong><span>Check the Route Desk connection. Retrying automatically.</span></div>';}
  finally {polling=false;}
}
await poll();
const liveUrl=new URL('/api/live',location.href);liveUrl.protocol=location.protocol==='https:'?'wss:':'ws:';
const liveUpdates=new LiveUpdates({url:liveUrl.href,getState:()=>state,onSnapshot:accept,onStatus:data=>{
  if(!state||data.revision<state.revision)return;state=data;renderStatus();if(feedback.operations.size)reconcileFeedback();
},onConnection:connected=>{browserLive=connected;renderStatus();},refresh:poll});
liveUpdates.start();setInterval(renderStatus,1000);
window.addEventListener('pagehide',()=>liveUpdates.stop());
window.addEventListener('pageshow',event=>{if(event.persisted)liveUpdates.start();});
function clock(){ $('#clock').textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false}); }
clock();setInterval(clock,30000);
