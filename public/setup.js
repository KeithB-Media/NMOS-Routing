// Setup view: engine configuration (registry, PTP, multicast DHCP + leases,
// vendor web-UI links, virtual senders, DDNS, monitoring toggles).
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ALGORITHMS=['hmac-sha256','hmac-sha512','hmac-sha1','hmac-md5','none'];
async function json(url,data){
  const response=await fetch(url,data===undefined?{signal:AbortSignal.timeout(15000)}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(30000)});
  const body=await response.json();if(!response.ok)throw new Error(body.error||'Request failed');return body;
}
export function createSetup(root,{toast=()=>{},canWrite=()=>true,onSaved=()=>{}}={}) {
  const $=s=>root.querySelector(s),$$=s=>[...root.querySelectorAll(s)];
  let data=null,visible=false,busy=false,vendorProfiles=[],virtualSenders=[],timer;
  root.innerHTML=`<div class="nmos-heading"><div><div class="eyebrow">ENGINE CONFIGURATION</div><h2>Setup</h2><p>Registry discovery · PTP · multicast leases · device links · virtual senders · DNS · monitoring</p></div><button class="quiet-button" id="setup-reload">Reload</button></div>
  <p id="setup-status" role="status" aria-live="polite"></p><div id="setup-body" class="setup-body"><p class="muted">Loading…</p></div>`;
  function field(label,name,value,{type='text',placeholder='',help='',attrs=''}={}){return `<label class="setup-field">${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs}>${help?`<small>${esc(help)}</small>`:''}</label>`;}
  function check(label,name,checked,help=''){return `<label class="setup-check"><input type="checkbox" name="${esc(name)}" ${checked?'checked':''}><span>${esc(label)}${help?`<small>${esc(help)}</small>`:''}</span></label>`;}
  function render(){
    if(!data){$('#setup-body').innerHTML='<p class="muted">Loading…</p>';return;}
    const c=data.config,leases=Object.entries(data.leases?.leases||{}),stats=data.leases?.stats||c.multicastStats,ro=!canWrite();
    const registryRows=(data.registries||[]).map(r=>`<tr><td>${esc(r.ip)}:${esc(r.port)}</td><td>${esc(r.source)}</td><td>${esc(r.priority)}</td><td>${r.connected?`<span class="setup-ok">${r.connected} subscriptions</span>`:'<span class="setup-warn">not connected</span>'}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No registry known yet.</td></tr>';
    $('#setup-body').innerHTML=`<form id="setup-form" class="setup-form" ${ro?'data-readonly':''}>
    ${ro?'<p class="nmos-warning">Settings are read-only on this server (WRITE_ENABLED is off).</p>':''}
    <section class="setup-section"><h3>NMOS registry</h3><p>A static registry always wins. Otherwise the engine discovers one with unicast DNS-SD, then mDNS. Changes apply live.</p>
      <div class="setup-grid">${field('Static registry IP','registry.ip',c.registry.ip,{placeholder:'leave empty for discovery'})}${field('Port','registry.port',c.registry.port,{type:'number',attrs:'min="1" max="65535"'})}${field('DNS-SD domain override','registryDiscovery.domain',c.registryDiscovery.domain,{placeholder:'e.g. media.example.net',help:data.dnssd?.domains?.length?'Detected: '+data.dnssd.domains.join(', '):'No search domain detected'})}</div>
      ${check('Unicast DNS-SD discovery','registryDiscovery.unicastDnssd',c.registryDiscovery.unicastDnssd)}
      <table class="setup-table"><thead><tr><th>Registry</th><th>Source</th><th>Priority</th><th>State</th></tr></thead><tbody>${registryRows}</tbody></table></section>
    <section class="setup-section"><h3>PTP and routing behaviour</h3><div class="setup-grid">${field('Acceptable grandmaster ID','acceptableGmid',c.acceptableGmid,{placeholder:'00-1D-C1-FF-FE-00-00-01',help:'Devices locked to it are marked green, others yellow.'})}</div>
      ${check('Auto-activate an inactive sender when it is routed','autoActivateInactiveSender',c.autoActivateInactiveSender,'Refused when its multicast is already in use.')}
      ${check('Re-execute receivers when a sender\'s SDP changes','autoMulticast.reconnectReceiversOnSenderChange',c.autoMulticast.reconnectReceiversOnSenderChange,'Off by default; many devices renegotiate on their own.')}</section>
    <section class="setup-section"><h3>Multicast DHCP</h3><p>Every active sender gets a reserved odd/odd+1 pair (ST 2022-7 legs) from one CIDR pool. ${stats?`Pool: ${esc(stats.pool?.used??0)} of ${esc(stats.pool?.total??0)} pairs used.`:''}</p>
      <div class="setup-grid">${field('Multicast range (CIDR)','multicastRange',c.multicastRange,{placeholder:'239.30.0.0/16'})}</div>
      ${check('Multicast DHCP enabled','autoMulticast.enabled',c.autoMulticast.enabled)}
      <div class="setup-adopt" id="setup-adopt" hidden><span>When enabling (or changing the range):</span><label><input type="radio" name="adopt" value="keep" checked> Keep current IPs (no streams touched)</label><label><input type="radio" name="adopt" value="renew"> Renew from pool (re-patches every sender)</label></div>
      <div class="setup-lease-head"><h4>Lease inventory · ${leases.length}</h4><span><button type="button" class="quiet-button" id="lease-export">Export JSON</button><label class="quiet-button setup-file">Import JSON<input type="file" id="lease-import" accept="application/json" hidden></label><button type="button" class="quiet-button danger-text" id="lease-release-all" ${ro||!leases.length?'disabled':''}>Release all</button></span></div>
      <table class="setup-table"><thead><tr><th>Sender</th><th>Category</th><th>Primary</th><th>Secondary</th><th>Status</th><th>Bitrate</th><th></th></tr></thead><tbody>${leases.map(([id,l])=>`<tr><td title="${esc(id)}">${esc(l.deviceLabel||l.label||id)}</td><td>${esc(l.category||'')}</td><td><code>${esc(l.primaryIp||'')}${l.manualPrimaryIp?' *':''}</code></td><td><code>${esc(l.secondaryIp||'')}</code></td><td class="${l.liveStatus==='active'?'setup-ok':l.liveStatus==='missing'?'setup-warn':''}">${esc(l.liveStatus||'')}</td><td>${l.bitrate?.v?esc(Math.round(l.bitrate.v))+' Mbit/s':'—'}</td><td><button type="button" class="quiet-button" data-release="${esc(id)}" ${ro?'disabled':''}>Release</button></td></tr>`).join('')||'<tr><td colspan="7" class="muted">No leases.</td></tr>'}</tbody></table></section>
    <section class="setup-section"><h3>Device web UI links</h3><p>Profiles match by substring against the NMOS node label; first match wins. The resulting link opens from the group's description.</p>
      <table class="setup-table" id="vendor-table"><thead><tr><th>Name</th><th>Label contains</th><th>Protocol</th><th>Port</th><th>Path</th><th></th></tr></thead><tbody>${vendorProfiles.map((v,i)=>`<tr><td><input data-vendor="${i}" data-key="name" value="${esc(v.name)}"></td><td><input data-vendor="${i}" data-key="labels" value="${esc(v.labels)}"></td><td><select data-vendor="${i}" data-key="protocol"><option ${v.protocol==='http'?'selected':''}>http</option><option ${v.protocol==='https'?'selected':''}>https</option></select></td><td><input data-vendor="${i}" data-key="port" type="number" value="${esc(v.port)}"></td><td><input data-vendor="${i}" data-key="path" value="${esc(v.path)}"></td><td><button type="button" class="quiet-button" data-vendor-remove="${i}">×</button></td></tr>`).join('')}</tbody></table>
      <button type="button" class="quiet-button" id="vendor-add">+ Add profile</button>
      ${data.detectedDevices?.length?`<details class="setup-details"><summary>Detected devices · ${data.detectedDevices.length}</summary><table class="setup-table"><tbody>${data.detectedDevices.map(d=>`<tr><td>${esc(d.label)}</td><td>${esc(d.match||'no profile')}</td><td>${d.url?`<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.url)}</a>`:'—'}</td></tr>`).join('')}</tbody></table></details>`:''}</section>
    <section class="setup-section"><h3>Virtual senders</h3><p>Route non-NMOS sources by pasting their SDP. A sender ID is generated and kept across edits.</p>
      <div id="virtual-list">${virtualSenders.map((v,i)=>`<div class="setup-virtual"><div class="setup-grid">${field('Name',`virtual.${i}.name`,v.name)}<label class="setup-field">Sender ID<input value="${esc(v.senderId||'(generated on save)')}" readonly></label></div><label class="setup-field">SDP<textarea data-virtual="${i}" data-key="sdp" rows="5" spellcheck="false">${esc(v.sdp)}</textarea></label><button type="button" class="quiet-button" data-virtual-remove="${i}">Remove sender</button></div>`).join('')}</div>
      <button type="button" class="quiet-button" id="virtual-add">+ Add virtual sender</button>
      ${check('Publish virtual senders as an NMOS node in the registry','virtualNode.enabled',c.virtualNode.enabled,c.virtualNode.nodeId?'Node '+c.virtualNode.nodeId:'Requires the virtual node service (roadmap).')}</section>
    <section class="setup-section"><h3>Push names to DNS (RFC 2136)</h3><p>Every device name becomes an A record via TSIG-signed dynamic updates. Only records this engine created are ever touched.</p>
      ${check('DDNS enabled','ddns.enabled',c.ddns.enabled)}
      <div class="setup-grid">${field('DNS server','ddns.server',c.ddns.server)}${field('Port','ddns.port',c.ddns.port,{type:'number'})}${field('Zone','ddns.zone',c.ddns.zone,{placeholder:'media.example.net'})}${field('TTL (s)','ddns.ttl',c.ddns.ttl,{type:'number'})}${field('TSIG key name','ddns.keyName',c.ddns.keyName)}<label class="setup-field">Algorithm<select name="ddns.keyAlgorithm">${ALGORITHMS.map(a=>`<option ${a===c.ddns.keyAlgorithm?'selected':''}>${a}</option>`).join('')}</select></label>${field('TSIG secret','ddns.keySecret','',{type:'password',placeholder:c.ddns.keySecretSet?'configured · leave empty to keep':'base64 secret',help:'Never shown again after saving.'})}</div>
      ${data.dnsPushed?.length?`<details class="setup-details"><summary>Published records · ${data.dnsPushed.length}</summary><table class="setup-table"><tbody>${data.dnsPushed.map(e=>`<tr><td>${esc(e.name||e.fqdn||'')}</td><td><code>${esc(e.ip||'')}</code></td></tr>`).join('')}</tbody></table></details>`:''}</section>
    <section class="setup-section"><h3>Monitoring</h3>
      ${check('BCP-008 status monitoring (IS-12, read-only)','bcp008.enabled',c.bcp008.enabled,'Health per flow from NcSender/NcReceiverMonitors.')}
      ${check('Audio monitor (WebRTC listen-in)','audioMonitor.enabled',c.audioMonitor.enabled,'Needs the audio-monitor build of the image and media-network access, or a multicast probe.')}
      ${c.probeToken?`<p class="muted">Probe token: <code>${esc(c.probeToken)}</code></p>`:''}</section>
    <div class="setup-actions"><button type="submit" class="primary" ${ro?'disabled':''}>Save settings</button><span class="muted">${c.settingsFile?'Writes '+esc(c.settingsFile):'Demo mode · settings stay in memory'}</span></div></form>`;
    const form=$('#setup-form');
    const autoBox=form.elements['autoMulticast.enabled'],rangeBox=form.elements['multicastRange'];
    const adoptVisible=()=>{$('#setup-adopt').hidden=!((autoBox.checked&&!c.autoMulticast.enabled)||(autoBox.checked&&rangeBox.value.trim()!==c.multicastRange));};
    autoBox.onchange=adoptVisible;rangeBox.oninput=adoptVisible;
    $('#vendor-add').onclick=()=>{captureEditable();vendorProfiles.push({id:'',name:'',labels:'',protocol:'http',port:80,path:'/'});render();};
    $$('[data-vendor-remove]').forEach(b=>b.onclick=()=>{captureEditable();vendorProfiles.splice(Number(b.dataset.vendorRemove),1);render();});
    $('#virtual-add').onclick=()=>{captureEditable();virtualSenders.push({id:'',name:'',sdp:'',senderId:''});render();};
    $$('[data-virtual-remove]').forEach(b=>b.onclick=()=>{captureEditable();virtualSenders.splice(Number(b.dataset.virtualRemove),1);render();});
    $$('[data-release]').forEach(b=>b.onclick=async()=>{if(!confirm('Release this lease? The sender gets a fresh pair on its next reconcile.'))return;await action('/api/leases/release',{senderId:b.dataset.release},'Lease released');});
    $('#lease-release-all').onclick=async()=>{if(!confirm('Release ALL multicast leases?'))return;await action('/api/leases/release',{all:true},'All leases released');};
    $('#lease-export').onclick=async()=>{try{const blob=new Blob([JSON.stringify(await json('/api/leases/export'),null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='multicast-leases.json';a.click();URL.revokeObjectURL(a.href);}catch(e){toast(e.message,true);}};
    $('#lease-import').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{await action('/api/leases/import',JSON.parse(await file.text()),'Leases imported');}catch(err){toast(err.message,true);}};
    form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;$('#setup-status').textContent='Saving…';
      try{captureEditable();const post=collect(form);const result=await json('/api/setup',post);data={...data,config:result.config,leases:result.leases};syncEditable();render();toast('Settings saved'+(result.changed.length?' · '+result.changed.join(', '):''));$('#setup-status').textContent='';onSaved(result);await load();}
      catch(err){toast(err.message,true);$('#setup-status').textContent=err.message;}
      finally{busy=false;}};
  }
  function captureEditable(){
    const form=$('#setup-form');if(!form)return;
    $$('[data-vendor]').forEach(el=>{const v=vendorProfiles[Number(el.dataset.vendor)];if(v)v[el.dataset.key]=el.dataset.key==='port'?Number(el.value):el.value;});
    virtualSenders.forEach((v,i)=>{const name=form.elements[`virtual.${i}.name`];if(name)v.name=name.value;});
    $$('[data-virtual]').forEach(el=>{const v=virtualSenders[Number(el.dataset.virtual)];if(v)v[el.dataset.key]=el.value;});
  }
  function collect(form){
    const v=name=>form.elements[name]?.value??'',b=name=>!!form.elements[name]?.checked;
    return {registry:{ip:v('registry.ip'),port:Number(v('registry.port'))},registryDiscovery:{unicastDnssd:b('registryDiscovery.unicastDnssd'),domain:v('registryDiscovery.domain')},acceptableGmid:v('acceptableGmid'),
      autoActivateInactiveSender:b('autoActivateInactiveSender'),multicastRange:v('multicastRange'),autoMulticast:{enabled:b('autoMulticast.enabled'),reconnectReceiversOnSenderChange:b('autoMulticast.reconnectReceiversOnSenderChange'),adoptOnEnable:(form.elements.adopt?.value||'keep')==='keep'},
      vendorProfiles:vendorProfiles.map(p=>({...p})),virtualSenders:virtualSenders.map(s=>({...s})),virtualNode:{enabled:b('virtualNode.enabled')},
      ddns:{enabled:b('ddns.enabled'),server:v('ddns.server'),port:Number(v('ddns.port')),zone:v('ddns.zone'),ttl:Number(v('ddns.ttl')),keyName:v('ddns.keyName'),keyAlgorithm:v('ddns.keyAlgorithm'),keySecret:v('ddns.keySecret')},
      bcp008:{enabled:b('bcp008.enabled')},audioMonitor:{enabled:b('audioMonitor.enabled')}};
  }
  function syncEditable(){vendorProfiles=(data.config.vendorProfiles||[]).map(p=>({...p}));virtualSenders=(data.config.virtualSenders||[]).map(s=>({...s}));}
  async function action(url,body,message){try{const result=await json(url,body);if(result.leases)data={...data,leases:result.leases};render();toast(message);}catch(e){toast(e.message,true);}}
  async function load(){
    try{data=await json('/api/setup');syncEditable();render();$('#setup-status').textContent='';}
    catch(e){$('#setup-status').textContent='Could not load settings · '+e.message;}
  }
  $('#setup-reload').onclick=load;
  return {
    setVisible(value){visible=value;clearInterval(timer);if(visible){load();timer=setInterval(()=>{if(!busy&&document.activeElement?.closest?.('#setup-form')==null)load();},15000);}},
    reload:load,
  };
}
