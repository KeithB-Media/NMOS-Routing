// Drives the vendored engine's IS-05 connector against a mock node and
// asserts the exact PATCH bodies for RTP, MXL (BCP-007-03) and disconnect.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'packages/crosspoint-engine/dist/lib');
await access(path.join(dist, 'nmosConnector.js'));
const {NmosRegistryConnector} = require(path.join(dist, 'nmosConnector.js'));
const {MdnsService} = require(path.join(dist, 'mdnsService.js'));
MdnsService.instance = {mdns: {query() {}}, hooks: []}; // discovery is not under test

const sdp = 'v=0\r\no=- 1 1 IN IP4 10.0.0.1\r\ns=Cam\r\nt=0 0\r\nm=video 5004 RTP/AVP 96\r\nc=IN IP4 239.1.1.1/64\r\na=source-filter: incl IN IP4 239.1.1.1 10.0.0.1\r\n';
async function mockNode() {
  const patches = [], requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push(req.method + ' ' + req.url);
    let body = ''; for await (const c of req) body += c;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/sdp') { res.setHeader('Content-Type', 'application/sdp'); return res.end(sdp); }
    if (req.method === 'GET' && req.url === '/x-nmos/connection/v1.1/single/senders/mxl-sender/active/') return res.end(JSON.stringify({master_enable: true, transport_params: [{mxl_domain_id: 'studio-a', mxl_flow_id: 'flow-0001'}]}));
    if (req.method === 'PATCH' && req.url.startsWith('/x-nmos/connection/v1.1/single/receivers/')) { patches.push({url: req.url, body: JSON.parse(body)}); return res.end(JSON.stringify({activation: {mode: 'activate_immediate'}})); }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {base: `http://127.0.0.1:${server.address().port}`, patches, requests, close: () => new Promise(r => server.close(r))};
}
function connectorWith(base, {activeData = true} = {}) {
  const c = new NmosRegistryConnector({staticNmosRegistries: [], nmos: {registryVersions: ['v1.3'], connectVersions: ['v1.1', 'v1.0']}, registryDiscovery: {unicastDnssd: false}});
  for (const key of ['dnssdQueryInterval', 'mdnsQueryInterval', 'syncNmosTimer', 'updateCrosspointTimer', 'connectionStateTimer']) { clearInterval(c[key]); clearTimeout(c[key]); }
  const node = {id: 'node-1', label: 'Node', interfaces: [{name: 'eth0', port_id: 'aa-bb'}, {name: 'eth1', port_id: 'cc-dd'}]};
  const device = {id: 'dev-1', node_id: 'node-1', controls: [{type: 'urn:x-nmos:control:sr-ctrl/v1.1', href: base + '/x-nmos/connection/v1.1'}]};
  c.nmosState = {
    nodes: {'node-1': node}, devices: {'dev-1': device},
    senders: {
      'rtp-sender': {id: 'rtp-sender', device_id: 'dev-1', flow_id: 'f1', transport: 'urn:x-nmos:transport:rtp.mcast', manifest_href: base + '/sdp', interface_bindings: ['eth0'], subscription: {active: true}},
      'mxl-sender': {id: 'mxl-sender', device_id: 'dev-1', flow_id: 'f2', transport: 'urn:x-nmos:transport:mxl', interface_bindings: ['eth0'], subscription: {active: true}},
    },
    receivers: {
      'rtp-receiver': {id: 'rtp-receiver', device_id: 'dev-1', transport: 'urn:x-nmos:transport:rtp.mcast', interface_bindings: ['eth0', 'eth1']},
      'mxl-receiver': {id: 'mxl-receiver', device_id: 'dev-1', transport: 'urn:x-nmos:transport:mxl', interface_bindings: ['eth0']},
    },
    flows: {}, sources: {}, sendersManifestDetail: {},
    senderActiveData: activeData ? {'mxl-sender': {transport_params: [{mxl_domain_id: 'studio-a', mxl_flow_id: 'flow-0001'}]}} : {},
  };
  return c;
}

test('RTP: SDP-derived transport_params per media block, surplus receiver legs disabled, transport_file attached', async t => {
  const mock = await mockNode(); t.after(mock.close);
  const c = connectorWith(mock.base);
  const info = await c.connectionGetSenderInfo('rtp-sender');
  assert.equal(info.error, ''); assert.equal(info.transport, 'rtp.mcast'); assert.match(info.manifestFile, /m=video/);
  await c.makeConnection('rtp-receiver', info);
  const {body} = mock.patches.at(-1);
  assert.equal(body.sender_id, 'rtp-sender'); assert.equal(body.master_enable, true); assert.equal(body.transport_file.type, 'application/sdp');
  assert.deepEqual(body.transport_params, [{multicast_ip: '239.1.1.1', destination_port: 5004, rtp_enabled: true, source_ip: '10.0.0.1'}, {rtp_enabled: false}]);
});

test('MXL (BCP-007-03): no manifest read, mxl_domain_id/mxl_flow_id from the sender active params, no transport_file', async t => {
  const mock = await mockNode(); t.after(mock.close);
  const c = connectorWith(mock.base);
  const info = await c.connectionGetSenderInfo('mxl-sender');
  assert.equal(info.error, ''); assert.equal(info.transport, 'mxl'); assert.equal(info.manifestFile, '');
  assert.deepEqual(info.mxlParams, [{mxl_domain_id: 'studio-a', mxl_flow_id: 'flow-0001'}]);
  assert(!mock.requests.some(r => r.includes('/sdp')), 'MXL senders have no transport file to fetch');
  await c.makeConnection('mxl-receiver', info);
  const {url, body} = mock.patches.at(-1);
  assert.equal(url, '/x-nmos/connection/v1.1/single/receivers/mxl-receiver/staged');
  assert.deepEqual(body, {activation: {mode: 'activate_immediate'}, transport_params: [{mxl_flow_id: 'flow-0001', mxl_domain_id: 'studio-a'}], sender_id: 'mxl-sender', master_enable: true});
  assert.equal(body.transport_file, undefined);
});

test('MXL: active params are fetched on demand when the mirror lacks them; a sender without mxl_flow_id is an error', async t => {
  const mock = await mockNode(); t.after(mock.close);
  const c = connectorWith(mock.base, {activeData: false});
  const info = await c.connectionGetSenderInfo('mxl-sender');
  assert.equal(info.error, ''); assert.deepEqual(info.mxlParams, [{mxl_domain_id: 'studio-a', mxl_flow_id: 'flow-0001'}]);
  assert(mock.requests.includes('GET /x-nmos/connection/v1.1/single/senders/mxl-sender/active/'));
  c.nmosState.senderActiveData['mxl-sender'] = {transport_params: [{}]};
  c.nmosState.devices['dev-1'].controls = [];
  assert.match((await c.connectionGetSenderInfo('mxl-sender')).error, /mxl_flow_id/);
});

test('transport mismatch is refused before any PATCH; disconnect sends {} to MXL receivers and rtp_enabled:false to RTP receivers', async t => {
  const mock = await mockNode(); t.after(mock.close);
  const c = connectorWith(mock.base);
  const rtp = await c.connectionGetSenderInfo('rtp-sender'), mxl = await c.connectionGetSenderInfo('mxl-sender');
  await assert.rejects(() => c.makeConnection('mxl-receiver', rtp), /different transports/);
  await assert.rejects(() => c.makeConnection('rtp-receiver', mxl), /different transports/);
  assert.equal(mock.patches.length, 0);
  const disconnect = {senderId: 'disconnect', interfaces: [], manifestFile: '', active: false, error: '', transport: ''};
  await c.makeConnection('mxl-receiver', disconnect);
  assert.deepEqual(mock.patches.at(-1).body, {activation: {mode: 'activate_immediate'}, transport_params: [{}], master_enable: false});
  await c.makeConnection('rtp-receiver', disconnect);
  assert.deepEqual(mock.patches.at(-1).body.transport_params, [{rtp_enabled: false}, {rtp_enabled: false}]);
});
