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
- Tests updated: 61 passing, including a live-mode engine boot test.
