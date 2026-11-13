# Changelog

## 0.1.0 — unreleased

Project start: combines the videoIPath Route Desk operator UI/server with the
nmos-crosspoint v3 engine (vendored, MIT).

- `packages/crosspoint-engine`: nmos-crosspoint server vendored as a library
  package (TypeScript, built with `tsc`; audio-monitor native deps optional).
- `lib/engine.mjs`: in-process bootstrap of the engine without its Express/
  Svelte front end; clean shutdown.
- `lib/nmos-model.mjs`: engine state → Route Desk groups/levels/routes.
- `route-server.mjs`: videoIPath client replaced by the engine; `/api/route`,
  `/api/disconnect`, `/api/name(s)`, `/api/sdp`, `/api/hidden`,
  `/api/enable`, `/api/engine`; demo mode with a generated facility.
- Manual routing groups: operator-defined groups (`lib/manual-groups.mjs`,
  `/api/groups`) overlay the engine's automatic device/grouphint groups; a
  claimed flow leaves its automatic group and returns on delete. Built from a
  Groups dialog in the routing toolbar. Persisted in `DATA_DIR`.
- BCP-007-03 (NMOS With MXL): the engine recognises `urn:x-nmos:transport:mxl`,
  connects MXL receivers with `{mxl_domain_id, mxl_flow_id}` and no transport
  file, refuses RTP/MXL mixes; the UI shows the MXL domain/flow in the address
  columns and the planners explain transport mismatches. Engine changes are
  marked and listed in `packages/crosspoint-engine/UPSTREAM-PATCHES.md`.
- Setup page (rail): registry + DNS-SD discovery, acceptable PTP GMID, routing
  behaviour, multicast DHCP with adopt/renew and the lease inventory
  (release, export, import), vendor web-UI profiles with detected devices,
  virtual senders, DDNS (TSIG secret never echoed), BCP-008 and audio-monitor
  toggles. `/api/setup`, `/api/leases/*`; writes the engine settings.json and
  hot-applies registry, lease, DDNS and BCP-008 changes.
- Tests: 78 passing, including IS-05 PATCH-body tests against a mock node and
  a live-mode engine boot test.
