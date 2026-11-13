// Deterministic demo CrosspointState: a small ST 2110 facility with natural
// groups, device-only groups, a virtual sender and an MXL media function.
// Used when ROUTING_MODE=demo (no engine, no network). Demo routing only
// changes this in-memory state.
const empty = () => ({audio: [], audiochannel: [], video: [], data: [], websocket: [], mqtt: [], unknown: []});
let serial = 0;
function flow(type, name, {node, host, active = true, mxl = false} = {}) {
  const num = ++serial, octet = 1 + (num % 250);
  const legs = mxl ? [] : [{index: 0, dstIp: `239.30.${1 + (num >> 8)}.${octet}`, dstPort: 5004, srcIp: `10.1.${node}.${host}`}, {index: 1, dstIp: `239.31.${1 + (num >> 8)}.${octet}`, dstPort: 5004, srcIp: `10.2.${node}.${host}`}];
  const media = type === 'video' ? 'video/raw' : type === 'audio' ? 'audio/L24' : 'video/smpte291';
  return {id: `nmos_demo-${num.toString(16).padStart(4, '0')}`, order: num, available: true, active, num, dynamic: false, name, alias: name, hidden: false, connectedFlow: '',
    type, format: type === 'video' ? '1080i50 YCbCr-4:2:2 10 bit' : type === 'audio' ? '48 kHz · 2 ch · 1 ms' : 'ST 2110-40', manifestOk: !mxl,
    capabilities: {mediaTypes: [media], transport: mxl ? 'mxl' : 'rtp', dash7: !mxl}, capLimits: '', channelNumber: 0, sourceNumber: 0,
    bitrate: {v: type === 'video' ? 2652 : type === 'audio' ? 4.6 : 0.3, hint: ''}, legs, codec: type === 'video' ? 'RAW' : type === 'audio' ? '24 Bit LPCM' : 'ANC',
    ...(mxl ? {} : {sdp: undefined})};
}
function device(id, name, node, host, extra = {}) {
  return {id, order: 0, available: true, num: 1, dynamic: false, name, ip: `10.1.${node}.${host}`, alias: name, hidden: false, senderIds: [], receiverIds: [], connectedFlows: [], senders: empty(), receivers: empty(), nodeLabel: `Node ${node}`, nodeId: `node-${node}`, displayLabel: name, displayTooltip: name, gmid: '00-1D-C1-FF-FE-00-00-01', gmidLocked: true, ...extra};
}
export function demoState() {
  serial = 0;
  const devices = [];
  // Natural groups (BCP-002-01 grouphints): cameras with 1 video, 4 audio, 1 ANC.
  for (let n = 1; n <= 12; n++) {
    const cam = device(`nmosgrp_cam${n}`, `CAM ${n}`, 10, n);
    cam.senders.video.push(flow('video', `CAM ${n} Video`, {node: 10, host: n}));
    for (let a = 1; a <= 4; a++) cam.senders.audio.push(flow('audio', `CAM ${n} Audio ${a}`, {node: 10, host: n}));
    cam.senders.data.push(flow('data', `CAM ${n} ANC`, {node: 10, host: n}));
    devices.push(cam);
  }
  // Replay and graphics: senders with fewer audio levels (exercise missing-level policy).
  for (const [id, name] of [['rply1', 'RPLY 1'], ['rply2', 'RPLY 2'], ['gfx1', 'GFX 1']]) {
    const d = device(`nmosgrp_${id}`, name, 11, devices.length);
    d.senders.video.push(flow('video', `${name} Video`, {node: 11, host: devices.length}));
    for (let a = 1; a <= 2; a++) d.senders.audio.push(flow('audio', `${name} Audio ${a}`, {node: 11, host: devices.length}));
    devices.push(d);
  }
  // Multiviewer inputs and monitors: receivers.
  for (let n = 1; n <= 8; n++) {
    const mon = device(`nmosgrp_mon${n}`, `MON ${n}`, 20, n);
    mon.receivers.video.push(flow('video', `MON ${n} Video`, {node: 20, host: n}));
    for (let a = 1; a <= 4; a++) mon.receivers.audio.push(flow('audio', `MON ${n} Audio ${a}`, {node: 20, host: n}));
    devices.push(mon);
  }
  for (let n = 1; n <= 16; n++) {
    const mv = device(`nmosgrp_mv${n}`, `MV In ${n}`, 21, n);
    mv.receivers.video.push(flow('video', `MV In ${n} Video`, {node: 21, host: n}));
    mv.receivers.audio.push(flow('audio', `MV In ${n} Audio`, {node: 21, host: n}));
    devices.push(mv);
  }
  // Gateways: a device-only group with senders AND receivers.
  for (let n = 1; n <= 2; n++) {
    const gw = device(`nmos_gw${n}`, `Gateway ${n}`, 30, n);
    for (let p = 1; p <= 4; p++) { gw.senders.video.push(flow('video', `GW${n} Out ${p}`, {node: 30, host: n})); gw.receivers.video.push(flow('video', `GW${n} In ${p}`, {node: 30, host: n})); }
    devices.push(gw);
  }
  // Audio console: many audio receivers, one offline.
  const desk = device('nmos_desk', 'Audio Desk', 40, 1);
  for (let a = 1; a <= 16; a++) desk.receivers.audio.push(flow('audio', `Desk In ${a}`, {node: 40, host: 1, active: a !== 4}));
  desk.receivers.audio[3].available = false;
  devices.push(desk);
  // Virtual sender (operator-pasted SDP) and an MXL media function (BCP-007-03).
  const virtual = device('nmos_virtual', 'Virtual Senders', 50, 1, {isVirtual: true});
  const tone = flow('audio', 'Tone 1 kHz', {node: 50, host: 1}); tone.isVirtual = true; tone.sdp = 'v=0\r\no=- 1 1 IN IP4 10.1.50.1\r\ns=Tone 1 kHz\r\nc=IN IP4 239.30.9.1/32\r\nt=0 0\r\nm=audio 5004 RTP/AVP 97\r\na=rtpmap:97 L24/48000/2\r\n';
  virtual.senders.audio.push(tone); devices.push(virtual);
  const mxl = device('nmos_mxl1', 'MXL Function 1', 60, 1);
  mxl.senders.video.push(flow('video', 'MXL Out', {node: 60, host: 1, mxl: true}));
  mxl.receivers.video.push(flow('video', 'MXL In', {node: 60, host: 1, mxl: true}));
  devices.push(mxl);
  // Starting routes: CAM n → MON n (full), RPLY 1 → MV In 1 (video only).
  const cams = devices.filter(d => d.id.startsWith('nmosgrp_cam')), mons = devices.filter(d => d.id.startsWith('nmosgrp_mon'));
  mons.forEach((mon, i) => connect(cams[i], mon));
  connect(devices.find(d => d.id === 'nmosgrp_rply1'), devices.find(d => d.id === 'nmosgrp_mv1'), ['video']);
  // A degraded receiver for the BCP-008 column.
  mons[2].receivers.audio[3].monitor = {status: 3, message: 'Stream lost', detail: 'Stream: No packets received', counter: 4, domains: [{label: 'Link', status: 1, counter: 0, message: ''}, {label: 'Connection', status: 1, counter: 0, message: ''}, {label: 'Sync', status: 1, counter: 0, message: ''}, {label: 'Stream', status: 3, counter: 4, message: 'No packets received'}]};
  mons[0].receivers.video[0].monitor = {status: 1, message: 'Healthy', counter: 0, domains: []};
  const count = dir => devices.reduce((n, d) => n + Object.values(d[dir]).reduce((m, l) => m + l.length, 0), 0);
  return {devices, totals: {devices: {avail: devices.length, total: devices.length}, senders: {avail: count('senders'), total: count('senders')}, receivers: {avail: count('receivers') - 1, total: count('receivers')}}};
}
function connect(src, dst, types = ['video', 'audio', 'data']) {
  for (const type of types) dst.receivers[type].forEach((r, i) => { const s = src.senders[type][i]; if (s) { r.connectedFlow = s.id; r.connectedSenderLabel = `${src.displayLabel} / ${s.name}`; } });
}
