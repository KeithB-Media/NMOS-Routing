// Audio monitor: listen to an audio sender in the browser. The server joins
// the multicast (or asks a probe to), transcodes to Opus and streams it over
// WebRTC. Signalling: server offer → browser answer, trickled ICE both ways.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function post(url,data){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||'Request failed');return body;}
export function createAudioMonitor({toast=()=>{}}={}) {
  let current=null; // {senderId, listenerId, pc, audio, overlay, pairs, pair}
  const overlay=document.createElement('div');overlay.className='audio-monitor';overlay.hidden=true;document.body.appendChild(overlay);
  function position(anchor){
    if(!anchor||!anchor.isConnected){overlay.hidden=true;return;}
    const r=anchor.getBoundingClientRect(),h=overlay.offsetHeight||120,half=h/2+8;
    overlay.style.top=Math.max(half,Math.min(window.innerHeight-half,r.top+r.height/2))+'px';
    overlay.style.right=Math.max(8,window.innerWidth-r.left+8)+'px';
  }
  function render(status,message=''){
    if(!current)return;
    overlay.innerHTML=`<div class="am-status">${status==='playing'?'🎧 Listening':status==='connecting'?'Connecting…':status==='error'?'Error':'Stopped'}${message?` · ${esc(message)}`:''}</div><div class="am-name">${esc(current.label)}</div>
      <div class="am-controls"><label>Pair <select id="am-pair">${current.pairs.map((p,i)=>`<option value="${i}" ${p.ch[0]===current.pair[0]?'selected':''}>${esc(p.label)}</option>`).join('')}</select></label><label>Vol <input id="am-volume" type="range" min="0" max="1" step="0.05" value="${current.audio.volume}"></label><button type="button" id="am-mute">${current.audio.muted?'Unmute':'Mute'}</button><button type="button" id="am-stop">Stop</button></div>`;
    overlay.querySelector('#am-pair').onchange=async e=>{const p=current.pairs[Number(e.target.value)];if(!p)return;current.pair=p.ch;try{await post('/api/audio/channels',{listenerId:current.listenerId,channels:p.ch});}catch(err){toast(err.message,true);}};
    overlay.querySelector('#am-volume').oninput=e=>{current.audio.volume=Number(e.target.value);};
    overlay.querySelector('#am-mute').onclick=()=>{current.audio.muted=!current.audio.muted;render(status,message);};
    overlay.querySelector('#am-stop').onclick=()=>stop();
    overlay.hidden=false;position(current.anchor);
  }
  async function stop(){
    const c=current;if(!c)return;current=null;overlay.hidden=true;
    try{c.pc.close();}catch{}
    try{c.audio.pause();c.audio.srcObject=null;c.audio.remove();}catch{}
    c.anchor?.classList.remove('listening');
    post('/api/audio/unsubscribe',{listenerId:c.listenerId}).catch(()=>{});
  }
  async function start(group,level,anchor){
    const listenerId='lst_'+Math.random().toString(36).slice(2,10);
    const audio=document.createElement('audio');audio.autoplay=true;audio.hidden=true;document.body.appendChild(audio);
    const pc=new RTCPeerConnection({iceServers:[]});
    current={senderId:level.id,listenerId,pc,audio,anchor,label:`${group.name} · ${level.flowName||level.name}`,pairs:[{label:'1+2',ch:[0,1]}],pair:[0,1]};
    anchor.classList.add('listening');render('connecting');
    pc.addTransceiver('audio',{direction:'recvonly'});
    pc.ontrack=ev=>{if(ev.streams?.[0]){audio.srcObject=ev.streams[0];audio.play().catch(()=>{});render('playing');}};
    pc.onicecandidate=ev=>{if(ev.candidate&&current?.listenerId===listenerId)post('/api/audio/ice',{listenerId,candidate:ev.candidate.toJSON()}).catch(()=>{});};
    pc.onconnectionstatechange=()=>{if(current?.listenerId===listenerId&&['failed','closed'].includes(pc.connectionState))render('error','WebRTC '+pc.connectionState);};
    try{
      const sub=await post('/api/audio/subscribe',{senderId:level.id,listenerId,channels:[0,1]});
      if(current?.listenerId!==listenerId)return;
      const n=Number(sub.sourceChannels)||2,pairs=[];for(let i=0;i+1<n;i+=2)pairs.push({label:(i+1)+'+'+(i+2),ch:[i,i+1]});
      current.pairs=pairs.length?pairs:[{label:'1+2',ch:[0,1]}];
      await pc.setRemoteDescription(sub.offer);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
      await post('/api/audio/answer',{listenerId,answer:{type:answer.type,sdp:answer.sdp}});render('connecting');
    }catch(e){if(current?.listenerId===listenerId){render('error',e.message);toast(e.message,true);}}
  }
  window.addEventListener('scroll',()=>{if(current)position(current.anchor);},true);
  window.addEventListener('resize',()=>{if(current)position(current.anchor);});
  window.addEventListener('pagehide',()=>{if(current)navigator.sendBeacon?.('/api/audio/unsubscribe',new Blob([JSON.stringify({listenerId:current.listenerId})],{type:'application/json'}));});
  return {
    async toggle(group,level,anchor){if(current?.senderId===level.id){await stop();return;}await stop();await start(group,level,anchor);},
    stop,
    get active(){return current?.senderId||null;},
  };
}
