# Architecture

## Pieces

| Path | Role |
| --- | --- |
| `server.mjs`, `route-server.mjs` | HTTP + WebSocket server (Route Desk). Security headers, Basic auth, static assets, `/api/*`, `LiveHub` push. |
| `lib/engine.mjs` | Boots the vendored engine in-process (replaces upstream `server.ts`): settings, registry connector, crosspoint worker, lease manager, DDNS, BCP-008. Exposes `connect/disconnect/changeAlias/toggleHidden/enable*` and `onState`. |
| `lib/nmos-model.mjs` | Adapter: engine `CrosspointState` → Route Desk `{groups, routes, devices}`; SDP lookup for the popup. |
| `lib/model.mjs` | Routing planners (full take, breakaway, missing-level policy, disconnect) and name validation. Backend-agnostic. |
| `lib/demo-state.mjs` | Generated demo facility (`ROUTING_MODE=demo`). |
| `lib/live-hub.mjs` | Browser WebSocket deltas (unchanged from Route Desk). |
| `lib/nmos-viewer.mjs`, `lib/stream-cache.mjs` | NMOS viewer (registry/node browsing) and SDP parsing/view. |
| `public/` | Vanilla-JS UI: routing table, matrix, panels, NMOS viewer. |
| `packages/crosspoint-engine/` | Vendored nmos-crosspoint server, built with `tsc`. `src/lib` is pristine. |

The engine addresses `./config` and `./state` relative to the process cwd, so
`lib/engine.mjs` moves the process into `ENGINE_DIR` (default
`DATA_DIR/engine`) at startup. Route Desk code only uses absolute paths.

## Model mapping

The engine already groups senders/receivers into "devices": one per NMOS
device, or one per BCP-002-01 grouphint group (`nmosgrp_…`). The adapter
turns each engine device into up to two Route Desk groups:

| Engine | Route Desk |
| --- | --- |
| device with senders | source group `src:<deviceId>` |
| device with receivers | destination group `dst:<deviceId>` |
| flow (sender/receiver) | level; `id` = engine flow id `nmos_<uuid>` (the route endpoint) |
| flow type + position | level `key` = content ID: `video-1`, `audio-1`, `audio-2`, `data-1`, … |
| `displayLabel` / `alias` | group `name`; raw NMOS label → `system` |
| `legs[]` (dstIp/dstPort/srcIp) | `level.network.legs[]` (multicast/port/source) |
| `monitor` (BCP-008) | `level.monitor`, rolled up to `group.monitor` |
| receiver `connectedFlow` | route `{from: senderFlowId, to: receiverFlowId}` |
| `hidden` | omitted from inventory |

Routing matches content keys between source and destination exactly like the
VIP version matched schema content IDs, so the planners, matrix, panels and
feedback logic are unchanged. `executeConnection(srcFlow, dstFlow)` in the
engine is called per level — exact flow-to-flow, bypassing the engine's
number-based matcher.

Writes wait (≤2.5 s) for the engine's republished state to confirm the change;
otherwise the response is `202 routePending` and the UI keeps the pending
indicator until the registry push arrives.

## Roadmap

1. **UI rebrand + engine status** — strip videoIPath wording, show registry
   connection, engine log in Activity, BCP-008 health column, multicast
   columns from `level.network`.
2. **Manual group builder** — operator-defined groups persisted in
   `DATA_DIR`, overlaying the engine's automatic grouping (reuse the
   BCP-002-01 preview UI from the NMOS viewer).
3. **Setup page** — registry (static/DNS-SD), acceptable GMID, multicast DHCP
   + lease inventory, vendor Web-UI links, virtual senders, DDNS, BCP-008 and
   audio monitor toggles; writes `settings.json` through the engine's
   `setupConfig` semantics.
4. **BCP-007-03 (MXL)** — recognise `urn:x-nmos:transport:mxl`, IS-05
   connect with `mxl_domain_id`/`mxl_flow_id` and no `transport_file`,
   BCP-004-01 capability check. Engine insertion points:
   `nmosConnector.connectionGetSenderInfo`, `nmosConnector.makeConnection`,
   `crosspointUpdateThread` capability tagging.
5. **Audio monitor + multicast probe** — optional native deps
   (`@discordjs/opus`, `werift`), WebRTC listen-in, probe websocket.
6. **Virtual NMOS node + DDNS** — mount `NmosNodeApi` routes on the Route
   Desk HTTP server; register with the registry.
