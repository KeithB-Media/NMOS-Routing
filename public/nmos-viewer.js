import {naturalGroups,naturalHint} from './nmos-groups.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types=['self','devices','senders','receivers','sources','flows'];
const title=type=>type==='self'?'Nodes':type==='groups'?'Natural groups':type[0].toUpperCase()+type.slice(1);
export function createNmosViewer(root,{onGroupCreated=()=>{},onOpenGroup=()=>{}}={}) {
  const $=selector=>root.querySelector(selector);
  let source=localStorage.getItem('vip-nmos-source')||'vip',address=localStorage.getItem('vip-nmos-address')||'';
  if(!['vip','registry','node'].includes(source))source='vip';
  let data=null,selectedNode='',type='senders',query='',page=0,items=[],selected='',visible=false,timer,busy=false,generation=0,detailToken=0;
  root.innerHTML=`<div class="nmos-heading"><div><div class="eyebrow">DISCOVERY & INSPECTION</div><h2>NMOS viewer</h2><p>IS-04 resources · IS-05 active state · SDP · BCP-002-01 natural groups</p></div><button class="quiet-button" id="nmos-refresh">Refresh</button></div>
    <form id="nmos-connect" class="nmos-connect"><label>Browse<select id="nmos-source"><option value="vip">videoIPath discovery</option><option value="registry">Registry Query API</option><option value="node">Direct node API</option></select></label><label id="nmos-address-label">API URL<input id="nmos-address" type="url" autocomplete="off" spellcheck="false"></label><button class="quiet-button" type="submit">Connect</button></form>
    <p id="nmos-status" role="status" aria-live="polite"></p><div class="nmos-filters"><label>Node<select id="nmos-node"><option value="">All nodes</option></select></label><label>Resources<select id="nmos-type">${[...types,'groups'].map(t=>`<option value="${t}">${title(t)}</option>`).join('')}</select></label><label class="nmos-search">Search<input id="nmos-search" type="search" placeholder="Label, ID, format, group hint, address…"></label></div>
    <div class="nmos-workspace"><div class="nmos-browser"><div id="nmos-list" aria-label="NMOS resources"></div><div class="nmos-pagination"><span id="nmos-count"></span><button id="nmos-prev" class="quiet-button" aria-label="Previous resources">‹</button><button id="nmos-next" class="quiet-button" aria-label="Next resources">›</button></div></div><section id="nmos-detail" aria-label="Resource details"><div class="empty-state">Select a resource to inspect its details.</div></section></div>`;
  $('#nmos-source').value=source;$('#nmos-address').value=address;$('#nmos-type').value=type;
  function addressState(){const kind=$('#nmos-source').value;$('#nmos-address-label').hidden=kind==='vip';$('#nmos-address').disabled=kind==='vip';$('#nmos-address').required=kind!=='vip';$('#nmos-address').placeholder=kind==='registry'?'http://registry:8010 or full Query API URL':'http://node:80 or full Node API URL';}
  addressState();$('#nmos-source').onchange=addressState;
  const params=()=>new URLSearchParams(source==='registry'?{registry:address}:source==='node'?{nodeUrl:address}:{});
  async function json(url){const response=await fetch(url,{signal:AbortSignal.timeout(35000)}),result=await response.json();if(!response.ok)throw new Error(result.error||'NMOS request failed');return result;}
  async function post(url,body){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)}),result=await response.json();if(!response.ok)throw new Error(result.error||'Group request failed');return result;}
  function renderList() {
    const matches=type==='groups'?naturalGroups(data?.nodes||[]).filter(group=>!selectedNode||group.nodeKey===selectedNode).map(group=>({group,node:data.nodes.find(n=>n.id===group.nodeKey),resource:{id:group.id,label:group.name,...group}})):data?.nodes.flatMap(node=>(!selectedNode||node.id===selectedNode)?(node.resources[type]||[]).map(resource=>({node,resource})):[])||[];
    const needle=query.trim().toLowerCase();items=matches.filter(item=>!needle||JSON.stringify(item.resource).toLowerCase().includes(needle)||item.node.label.toLowerCase().includes(needle));
    items.sort((a,b)=>String(a.resource.label||a.resource.id).localeCompare(String(b.resource.label||b.resource.id),undefined,{numeric:true,sensitivity:'base'}));
    page=Math.max(0,Math.min(page,Math.ceil(items.length/50)-1));
    $('#nmos-list').innerHTML=items.length?items.slice(page*50,(page+1)*50).map((item,i)=>{
      const r=item.resource,key=item.node.id+'|'+r.id,h=naturalHint(r),hint=h?`${h.name} · ${h.role} · ${h.scope}`:'',state=r.subscription?.active;
      return `<button class="nmos-resource ${key===selected?'selected':''}" aria-pressed="${key===selected}" data-resource="${page*50+i}"><strong>${esc(r.label||r.id)}</strong><span>${esc(item.node.label)}${item.group?` · ${item.group.side==='source'?'Senders':'Receivers'} · ${item.group.members.length} essences`:''}${r.media_type||r.format?' · '+esc(r.media_type||r.format?.split(':').pop()):''}${state!==undefined?' · '+(state?'Active':'Inactive'):''}${item.node.stale?' · Stale':''}</span>${hint?`<span>${esc(hint)}</span>`:''}<small>${esc(item.group?item.group.scope+' scope · '+item.group.scopeId:r.id)}</small></button>`;
    }).join(''):`<div class="empty-state"><strong>No matching ${title(type).toLowerCase()}</strong><span>${data?.mode==='demo'&&source==='vip'?'Connect to a registry or node, or connect Route Desk to a live videoIPath controller.':'Check the connection, node selection, and search.'}</span></div>`;
    $('#nmos-count').textContent=`${items.length?page*50+1:0}–${Math.min((page+1)*50,items.length)} of ${items.length}`;$('#nmos-prev').disabled=page===0;$('#nmos-next').disabled=(page+1)*50>=items.length;
  }
  async function load() {
    if(busy)return;busy=true;const token=generation;$('#nmos-refresh').disabled=true;$('#nmos-status').textContent='Reading NMOS inventory…';
    try {
      const next=await json('/api/nmos?'+params());if(token!==generation)return;data=next;
      if(!data.nodes.some(n=>n.id===selectedNode))selectedNode='';
      $('#nmos-node').innerHTML='<option value="">All nodes</option>'+data.nodes.map(n=>`<option value="${esc(n.id)}">${esc(n.label)}${n.stale?' · Stale':''}</option>`).join('');$('#nmos-node').value=selectedNode;
      const warnings=data.nodes.filter(n=>n.stale).map(n=>n.label+': '+Object.entries(n.errors).map(([t,e])=>t+' '+e).join('; '));
      $('#nmos-status').textContent=data.error?'Inventory unavailable · '+data.error:data.nodes.length?`${data.nodes.length} nodes · Last inventory read ${new Date(data.updatedAt).toLocaleString()} · Refreshes every 30s while open${warnings.length?' · Stale data: '+warnings.join(' | '):''}`:source==='vip'?(data.mode==='demo'?'Demo inventory has no live NMOS nodes. Choose a registry or direct node above.':'No NMOS node URLs reported by videoIPath.'):'The API returned no nodes.';
      renderList();
    }catch(e){if(token===generation){$('#nmos-status').textContent='Connection failed · '+e.message+(data?' · Previous inventory retained.':'');}}
    finally{busy=false;$('#nmos-refresh').disabled=false;}
  }
  async function inspect(item) {
    selected=item.node.id+'|'+item.resource.id;const token=++detailToken;renderList();
    if(item.group){showNaturalGroup(item.group);return;}
    $('#nmos-detail').innerHTML='<p>Reading resource details…</p>';
    const p=params();p.set('node',item.node.id);p.set('type',type);p.set('id',item.resource.id);
    try {
      const d=await json('/api/nmos/detail?'+p);if(token!==detailToken)return;
      const r=d.resource,fields=['id','description','device_id','node_id','flow_id','source_id','format','media_type','transport','interface_bindings'];
      $('#nmos-detail').innerHTML=`<div class="eyebrow">${esc(title(type))} · ${esc(item.node.label)}</div><h3>${esc(r.label||r.id)}</h3>${d.stale?'<p class="nmos-warning">Inventory is stale. Resource information may have changed.</p>':''}<dl>${fields.filter(k=>r[k]!==undefined).map(k=>`<dt>${esc(k.replaceAll('_',' '))}</dt><dd>${esc(Array.isArray(r[k])?r[k].join(', '):r[k])}</dd>`).join('')}</dl>${d.errors.map(e=>`<p class="nmos-warning">${esc(e)}</p>`).join('')}${d.active?`<h4>IS-05 active state · ${d.active.master_enable===true?'Enabled':d.active.master_enable===false?'Disabled':'Unknown'}</h4><pre>${esc(JSON.stringify(d.active,null,2))}</pre>`:''}${['senders','receivers'].includes(type)?`<h4>SDP</h4>${d.legs.length?`<p>${d.legs.map(l=>esc(`${l.mid||'Leg'}: ${l.source||'Any source'} → ${l.multicast}:${l.port}`)).join('<br>')}</p>`:''}${d.sdp?`<pre>${esc(d.sdp)}</pre>`:'<p>No SDP returned by the device.</p>'}`:''}<details open><summary>IS-04 raw JSON</summary><pre>${esc(JSON.stringify(r,null,2))}</pre></details><small>Details read ${esc(new Date(d.readAt).toLocaleString())} · <button class="quiet-button" id="nmos-detail-refresh">Refresh details</button></small>`;
      $('#nmos-detail-refresh').onclick=()=>void inspect(item);
      const group=naturalGroups(data?.nodes||[]).find(g=>g.nodeKey===item.node.id&&g.side===(type==='senders'?'source':'destination')&&g.members.some(m=>m.id===r.id));
      if(['senders','receivers'].includes(type)){
        const section=document.createElement('section');section.className='nmos-natural-summary';
        section.innerHTML=group?`<h4>Natural group · ${esc(group.name)}</h4><p>${group.members.length} linked essences · ${esc(group.scope)} scope · ${group.side==='source'?'Source group':'Destination group'}</p><button class="quiet-button" id="nmos-build-group">Build videoIPath group</button>`:'<p>No valid BCP-002-01 natural group is advertised for this resource. Related essences are not inferred from names or active routes.</p>';
        $('#nmos-detail').prepend(section);if(group)$('#nmos-build-group').onclick=()=>void openBuilder(group);
      }
    }catch(e){if(token===detailToken)$('#nmos-detail').innerHTML=`<p class="nmos-warning">${esc(e.message)}</p>`;}
  }
  function showNaturalGroup(group) {
    $('#nmos-detail').innerHTML=`<div class="eyebrow">BCP-002-01 · ${esc(group.scope)} scope</div><h3>${esc(group.name)}</h3><p>${esc(group.nodeLabel)} · ${group.side==='source'?'Senders → videoIPath source group':'Receivers → videoIPath destination group'}</p><p>Members share the first advertised group hint. Roles identify the individual essences.</p><ul>${group.members.map(m=>`<li><strong>${esc(m.role)}</strong> · ${esc(m.kind)}<br>${esc(m.label)}</li>`).join('')}</ul>${group.errors.map(e=>`<p class="nmos-warning">${esc(e)}</p>`).join('')}<button class="quiet-button" id="nmos-build-group">Build videoIPath group</button>`;
    $('#nmos-build-group').onclick=()=>void openBuilder(group);
  }
  async function openBuilder(group,input={}) {
    const token=++detailToken,sourceParams=Object.fromEntries(params());
    $('#nmos-detail').innerHTML='<p>Reading current videoIPath endpoints and schemas…</p>';
    try {
      const plan=await post('/api/nmos/groups/preview',{...sourceParams,groupKey:group.id,...input});if(token!==detailToken)return;
      renderBuilder(group,plan,sourceParams);
    }catch(e){if(token===detailToken){$('#nmos-detail').innerHTML=`<h3>Build videoIPath group</h3><p class="nmos-warning" role="alert">${esc(e.message)}</p><button class="quiet-button" id="nmos-back-group">Back to natural group</button>`;$('#nmos-back-group').onclick=()=>showNaturalGroup(group);}}
  }
  function renderBuilder(group,plan,sourceParams) {
    const schema=plan.schemas.find(s=>s.id===plan.schemaId);
    $('#nmos-detail').innerHTML=`<div class="eyebrow">BUILD VIDEOIPATH GROUP · ${plan.group.side==='source'?'SOURCE':'DESTINATION'}</div><h3>${esc(plan.group.name)}</h3><p>Review every essence and schema level. Creating the group adds an endpoint group in videoIPath. Current routes and device configuration stay unchanged.</p><form id="nmos-group-form"><label>Group name<input id="nmos-group-name" value="${esc(plan.name)}" required maxlength="200"></label><label>videoIPath schema<select id="nmos-group-schema">${plan.schemas.map(s=>`<option value="${esc(s.id)}" ${s.id===plan.schemaId?'selected':''}>${esc(s.label)}</option>`).join('')}</select></label><p class="muted">Level suggestions use format and role order. Review the content IDs before creating the group.</p><div class="nmos-mappings">${plan.members.map((m,i)=>`<fieldset data-member="${i}"><legend>${esc(m.role)} · ${esc(m.kind)}</legend><p>${esc(m.label)}<br><small>${esc(m.id)}</small></p><label>videoIPath endpoint<select data-binding="${i}"><option value="">${m.candidates.length?'Select endpoint…':'No matching enabled endpoint'}</option>${m.candidates.map(c=>`<option value="${esc(c.id)}" ${c.id===m.endpointId?'selected':''}>${esc(c.label+' · '+c.deviceId)}</option>`).join('')}</select></label>${m.candidates.some(c=>c.groups.length)?`<p class="muted">Existing membership: ${esc([...new Set(m.candidates.flatMap(c=>c.groups))].join(', '))}</p>`:''}<label>Schema level<select data-content="${i}"><option value="">Select content ID…</option>${(schema?.entries||[]).map(e=>`<option value="${esc(e.contentId)}" ${e.contentId===m.contentId?'selected':''}>${esc(e.label+' · '+e.contentId)}</option>`).join('')}</select></label><small>Profile: ${esc(m.profileId||'Not assigned')}</small></fieldset>`).join('')}</div><div id="nmos-group-feedback" role="status" aria-live="polite">${plan.readOnly?'<p class="nmos-warning">This videoIPath connection is read-only. Enable changes in Connection settings or on the server to create groups.</p>':''}${plan.errors.map(e=>`<p class="nmos-warning">${esc(e)}</p>`).join('')}${plan.warnings.map(e=>`<p class="nmos-warning">${esc(e)}</p>`).join('')}${plan.alreadyExists?'<p>This natural group is already imported and confirmed in videoIPath.</p>':''}</div><div class="nmos-group-actions"><button class="quiet-button" type="submit">Review group</button><button class="quiet-button" type="button" id="nmos-group-create" ${plan.canCreate?'':'disabled'}>Create in videoIPath</button></div></form>`;
    const form=$('#nmos-group-form'),button=$('#nmos-group-create');
    form.oninput=()=>{button.disabled=true;$('#nmos-group-feedback').textContent='Mappings changed. Select Review group to validate the current configuration.';};
    const current=()=>({name:$('#nmos-group-name').value,schemaId:$('#nmos-group-schema').value,...($('#nmos-group-schema').value===plan.schemaId?{mappings:plan.members.map((m,i)=>({resourceId:m.id,endpointId:$(`[data-binding="${i}"]`).value,contentId:$(`[data-content="${i}"]`).value}))}:{})});
    form.onsubmit=e=>{e.preventDefault();void openBuilder(group,current());};
    button.onclick=async()=>{
      const request={...sourceParams,groupKey:group.id,...current(),previewToken:plan.previewToken},token=detailToken;
      form.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);$('#nmos-group-feedback').textContent='Creating group and confirming the controller inventory…';
      try {
        const result=await post('/api/nmos/groups/create',request);onGroupCreated(result);if(token!==detailToken)return;
        $('#nmos-detail').innerHTML=`<h3>${esc(result.name)}</h3><p role="status">${result.alreadyExists?'Group already exists and is confirmed':'Group created and confirmed'} in videoIPath.</p><p>${esc(result.groupId)}</p><button class="quiet-button" id="nmos-open-created">Show in routing</button>`;
        $('#nmos-open-created').onclick=()=>onOpenGroup(result);
      }catch(e){if(token===detailToken){$('#nmos-group-feedback').textContent=e.message+' Review the group again before retrying.';form.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);button.disabled=true;}}
    };
  }
  $('#nmos-connect').onsubmit=e=>{
    e.preventDefault();if(busy)return;
    source=$('#nmos-source').value;address=$('#nmos-address').value.trim();generation++;detailToken++;data=null;selected='';selectedNode='';page=0;
    localStorage.setItem('vip-nmos-source',source);localStorage.setItem('vip-nmos-address',address);
    $('#nmos-detail').innerHTML='<p>Select a resource to inspect its details.</p>';renderList();void load();
  };
  $('#nmos-node').onchange=e=>{selectedNode=e.target.value;page=0;renderList();};
  $('#nmos-type').onchange=e=>{type=e.target.value;page=0;detailToken++;selected='';$('#nmos-detail').innerHTML='<p>Select a resource to inspect its details.</p>';renderList();};
  $('#nmos-search').oninput=e=>{query=e.target.value;page=0;renderList();};
  $('#nmos-prev').onclick=()=>{page--;renderList();};$('#nmos-next').onclick=()=>{page++;renderList();};
  $('#nmos-refresh').onclick=()=>void load();
  $('#nmos-list').onclick=e=>{const button=e.target.closest('[data-resource]');if(button)void inspect(items[Number(button.dataset.resource)]);};
  return {setVisible(value){visible=value;clearInterval(timer);if(visible){void load();timer=setInterval(()=>{if(!document.hidden)void load();},30000);}}};
}
