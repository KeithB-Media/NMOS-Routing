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
  // MXL media functions with an IS-04 mirror (flows, sources, receiver caps) so
  // BCP-004-01 constraint sets can be evaluated. MXL Function 2 produces UHD
  // video and 96 kHz audio, which MXL Function 1's receivers do not accept.
  const mirror = {senders: {}, receivers: {}, flows: {}, sources: {}, senderActiveData: {}};
  const mxlSender = (dev, type, name, flowAttrs, sourceAttrs = {}) => {
    const f = flow(type, name, {node: 60, host: 1, mxl: true}), uuid = f.id.slice(5), flowId = 'flow-' + uuid, sourceId = 'source-' + uuid;
    f.format = describe(flowAttrs, sourceAttrs);
    mirror.sources[sourceId] = {id: sourceId, format: 'urn:x-nmos:format:' + type, ...sourceAttrs};
    mirror.flows[flowId] = {id: flowId, source_id: sourceId, format: 'urn:x-nmos:format:' + type, ...flowAttrs};
    mirror.senders[uuid] = {id: uuid, label: name, flow_id: flowId, transport: 'urn:x-nmos:transport:mxl', manifest_href: null, interface_bindings: [], subscription: {active: true, receiver_id: null}};
    mirror.senderActiveData[uuid] = {master_enable: true, transport_params: [{mxl_domain_id: 'b7e1f2a0-6c3d-4e58-9a71-0d2c4f8e1a35', mxl_flow_id: mxlFlowId(f.num)}]};
    dev.senders[type].push(f);
  };
  const mxlReceiver = (dev, type, name, caps) => {
    const f = flow(type, name, {node: 60, host: 1, mxl: true}), uuid = f.id.slice(5);
    mirror.receivers[uuid] = {id: uuid, label: name, format: 'urn:x-nmos:format:' + type, transport: 'urn:x-nmos:transport:mxl', interface_bindings: [], caps: {...caps, version: '1700000000:0'}, subscription: {active: false, sender_id: null}};
    dev.receivers[type].push(f);
  };
  const v210 = (w, h, rate) => ({media_type: 'video/v210', frame_width: w, frame_height: h, interlace_mode: 'progressive', grain_rate: rate, colorspace: 'BT709', transfer_characteristic: 'SDR', components: [{name: 'Y', width: w, height: h, bit_depth: 10}, {name: 'Cb', width: w / 2, height: h, bit_depth: 10}, {name: 'Cr', width: w / 2, height: h, bit_depth: 10}]});
  const float32 = (rate) => ({media_type: 'audio/float32', sample_rate: {numerator: rate}, bit_depth: 32});
  const channels = n => ({channels: Array.from({length: n}, (_, i) => ({label: 'CH ' + (i + 1)}))});
  const mxl = device('nmos_mxl1', 'MXL Function 1', 60, 1);
  mxlSender(mxl, 'video', 'MXL Out', v210(1920, 1080, {numerator: 50, denominator: 1}));
  mxlSender(mxl, 'audio', 'MXL Out Audio', float32(48000), channels(8));
  mxlReceiver(mxl, 'video', 'MXL In', {media_types: ['video/v210', 'video/v210a'], constraint_sets: [
    {'urn:x-nmos:cap:meta:label': 'HD 50p', 'urn:x-nmos:cap:meta:preference': 10, 'urn:x-nmos:cap:format:frame_width': {enum: [1920]}, 'urn:x-nmos:cap:format:frame_height': {enum: [1080]}, 'urn:x-nmos:cap:format:interlace_mode': {enum: ['progressive']}, 'urn:x-nmos:cap:format:grain_rate': {enum: [{numerator: 50}]}, 'urn:x-nmos:cap:format:color_sampling': {enum: ['YCbCr-4:2:2']}, 'urn:x-nmos:cap:format:component_depth': {enum: [10]}},
    {'urn:x-nmos:cap:meta:label': 'HD 59.94p', 'urn:x-nmos:cap:format:frame_width': {enum: [1920]}, 'urn:x-nmos:cap:format:frame_height': {enum: [1080]}, 'urn:x-nmos:cap:format:interlace_mode': {enum: ['progressive']}, 'urn:x-nmos:cap:format:grain_rate': {enum: [{numerator: 60000, denominator: 1001}]}, 'urn:x-nmos:cap:format:component_depth': {enum: [10]}},
    {'urn:x-nmos:cap:meta:label': 'UHD 50p (licence required)', 'urn:x-nmos:cap:meta:enabled': false, 'urn:x-nmos:cap:format:frame_width': {enum: [3840]}, 'urn:x-nmos:cap:format:frame_height': {enum: [2160]}},
  ]});
  mxlReceiver(mxl, 'audio', 'MXL In Audio', {media_types: ['audio/float32'], constraint_sets: [
    {'urn:x-nmos:cap:meta:label': '48 kHz up to 16 ch', 'urn:x-nmos:cap:format:sample_rate': {enum: [{numerator: 48000}]}, 'urn:x-nmos:cap:format:channel_count': {minimum: 1, maximum: 16}, 'urn:x-nmos:cap:format:sample_depth': {enum: [32]}},
  ]});
  devices.push(mxl);
  const mxl2 = device('nmos_mxl2', 'MXL Function 2', 60, 2);
  mxlSender(mxl2, 'video', 'UHD Graphics', v210(3840, 2160, {numerator: 50, denominator: 1}));
  mxlSender(mxl2, 'audio', 'UHD Graphics Audio', float32(96000), channels(2));
  mxlReceiver(mxl2, 'video', 'UHD In', {media_types: ['video/v210'], constraint_sets: [
    {'urn:x-nmos:cap:meta:label': 'UHD 50p', 'urn:x-nmos:cap:meta:preference': 20, 'urn:x-nmos:cap:format:frame_width': {enum: [3840]}, 'urn:x-nmos:cap:format:frame_height': {enum: [2160]}, 'urn:x-nmos:cap:format:grain_rate': {minimum: {numerator: 25}, maximum: {numerator: 60}}},
    {'urn:x-nmos:cap:meta:label': 'HD any rate', 'urn:x-nmos:cap:format:frame_width': {enum: [1920]}, 'urn:x-nmos:cap:format:frame_height': {enum: [1080]}},
  ]});
  devices.push(mxl2);
  // Starting routes: CAM n → MON n (full), RPLY 1 → MV In 1 (video only).
  const cams = devices.filter(d => d.id.startsWith('nmosgrp_cam')), mons = devices.filter(d => d.id.startsWith('nmosgrp_mon'));
  mons.forEach((mon, i) => connect(cams[i], mon));
  connect(devices.find(d => d.id === 'nmosgrp_rply1'), devices.find(d => d.id === 'nmosgrp_mv1'), ['video']);
  // A degraded receiver for the BCP-008 column.
  mons[2].receivers.audio[3].monitor = {status: 3, message: 'Stream lost', detail: 'Stream: No packets received', counter: 4, domains: [{label: 'Link', status: 1, counter: 0, message: ''}, {label: 'Connection', status: 1, counter: 0, message: ''}, {label: 'Sync', status: 1, counter: 0, message: ''}, {label: 'Stream', status: 3, counter: 4, message: 'No packets received'}]};
  mons[0].receivers.video[0].monitor = {status: 1, message: 'Healthy', counter: 0, domains: []};
  const nmosMirror = mirror;
  const count = dir => devices.reduce((n, d) => n + Object.values(d[dir]).reduce((m, l) => m + l.length, 0), 0);
  const state = {devices, totals: {devices: {avail: devices.length, total: devices.length}, senders: {avail: count('senders'), total: count('senders')}, receivers: {avail: count('receivers') - 1, total: count('receivers')}}};
  // The IS-04 mirror the live engine would hold (nmosState). Non-enumerable so the crosspoint state stays engine-shaped.
  Object.defineProperty(state, 'nmosMirror', {value: nmosMirror, enumerable: false});
  return state;
}
function mxlFlowId(num) { return '5d6e7f80-1a2b-4c3d-8e9f-' + String(num).padStart(12, '0'); }
function describe(flow, source) {
  if (flow.frame_width) { const r = flow.grain_rate, rate = r.denominator && r.denominator !== 1 ? (r.numerator / r.denominator).toFixed(2) : r.numerator; return `${flow.frame_height}p${rate} ${flow.media_type.split('/')[1]}`; }
  return `${flow.sample_rate.numerator / 1000} kHz · ${source.channels?.length || 0} ch · float32`;
}
function connect(src, dst, types = ['video', 'audio', 'data']) {
  for (const type of types) dst.receivers[type].forEach((r, i) => { const s = src.senders[type][i]; if (s) { r.connectedFlow = s.id; r.connectedSenderLabel = `${src.displayLabel} / ${s.name}`; } });
}
