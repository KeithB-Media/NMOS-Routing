// A small enriched CrosspointState in the shape the engine publishes
// (packages/crosspoint-engine/src/lib/crosspointAbstraction.ts interfaces).
const empty = () => ({audio: [], audiochannel: [], video: [], data: [], websocket: [], mqtt: [], unknown: []});
const flow = (id, type, num, name, extra = {}) => ({
  id: `nmos_${id}`, order: num, available: true, active: true, num, dynamic: false, name, alias: name, hidden: false, connectedFlow: '',
  type, format: type === 'video' ? '1080i50' : type === 'audio' ? '48 kHz · 2 ch' : '', manifestOk: true,
  capabilities: {mediaTypes: [type === 'video' ? 'video/raw' : type === 'audio' ? 'audio/L24' : 'video/smpte291'], transport: 'rtp', dash7: true},
  capLimits: '', channelNumber: 0, sourceNumber: 0, bitrate: {v: type === 'video' ? 2650 : 4.6, hint: ''},
  legs: [{index: 0, dstIp: `239.30.1.${num}`, dstPort: 5004, srcIp: '10.1.0.5'}, {index: 1, dstIp: `239.30.2.${num}`, dstPort: 5004, srcIp: '10.2.0.5'}],
  codec: type === 'video' ? 'RAW' : type === 'audio' ? '24 Bit LPCM' : 'ANC', ...extra,
});
const device = (id, name, extra = {}) => ({id, order: 0, available: true, num: 1, dynamic: false, name, ip: '10.1.0.5', alias: name, hidden: false, senderIds: [], receiverIds: [], connectedFlows: [], senders: empty(), receivers: empty(), nodeLabel: 'Node A', nodeId: 'node-a', displayLabel: name, displayTooltip: name, ...extra});

export function fixtureState() {
  const camera = device('nmosgrp_cam1', 'CAM 1', {alias: 'Camera One', displayLabel: 'Camera One'});
  camera.senders.video.push(flow('cam1-v', 'video', 1, 'CAM 1 Video'));
  camera.senders.audio.push(flow('cam1-a2', 'audio', 3, 'CAM 1 Audio 2'), flow('cam1-a1', 'audio', 2, 'CAM 1 Audio 1'));
  camera.senders.data.push(flow('cam1-anc', 'data', 4, 'CAM 1 ANC'));

  const monitor = device('nmos_mon1', 'MON 1');
  monitor.receivers.video.push(flow('mon1-v', 'video', 1, 'MON 1 Video', {connectedFlow: 'nmos_cam1-v', connectedSenderLabel: 'Camera One / CAM 1 Video', monitor: {status: 1, message: 'Healthy'}}));
  for (let i = 1; i <= 4; i++) monitor.receivers.audio.push(flow(`mon1-a${i}`, 'audio', i + 1, `MON 1 Audio ${i}`, i <= 2 ? {connectedFlow: `nmos_cam1-a${i}`} : {active: false}));
  monitor.receivers.audio[3].monitor = {status: 3, message: 'Stream lost', domains: [{label: 'Stream', status: 3, counter: 2, message: 'No packets'}]};

  const gateway = device('nmos_gw1', 'Gateway', {ip: '10.1.0.9'});
  gateway.senders.video.push(flow('gw1-v', 'video', 7, 'GW Out'));
  gateway.receivers.video.push(flow('gw1-rv', 'video', 8, 'GW In'));
  gateway.receivers.video.push(flow('gw1-hidden', 'video', 9, 'GW Hidden', {hidden: true}));

  const hidden = device('nmos_hidden', 'Hidden box', {hidden: true});
  hidden.senders.video.push(flow('hidden-v', 'video', 20, 'Hidden Video'));

  const virtual = device('nmos_virtual', 'Virtual Device', {isVirtual: true});
  virtual.senders.audio.push(flow('virt-a', 'audio', 30, 'Tone', {isVirtual: true, sdp: 'v=0\r\nm=audio 5004 RTP/AVP 97\r\n'}));

  const mxl = device('nmos_mxl', 'MXL Function');
  mxl.senders.video.push(flow('mxl-v', 'video', 40, 'MXL Out', {legs: [], capabilities: {mediaTypes: ['video/raw'], transport: 'mxl', dash7: false}}));

  return {devices: [camera, monitor, gateway, hidden, virtual, mxl], totals: {devices: {avail: 6, total: 6}, senders: {avail: 7, total: 7}, receivers: {avail: 7, total: 7}}};
}

export const fixtureNmosState = {sendersManifestDetail: {'cam1-v': {_RAWSDP: 'v=0\r\ns=CAM 1 Video\r\nm=video 5004 RTP/AVP 96\r\n'}}};
