# NMOS Routing

An NMOS controller for ST 2110 / AES67 (and, on the roadmap, MXL) media
networks: the **Route Desk** operator interface — routing table, matrix,
button panels, name management and NMOS viewer — driven by the
**nmos-crosspoint** engine for IS-04 discovery, IS-05 connection management,
multicast lease management and BCP-008 health monitoring.

One Node 22 process, one container, no frontend build.

```
Browser ──HTTP/WebSocket──▶ route-server.mjs ──▶ lib/nmos-model.mjs (adapter)
                                   │                    ▲
                                   ▼                    │ CrosspointState
                             lib/engine.mjs ──▶ packages/crosspoint-engine
                                                 (IS-04 registry WS, IS-05 PATCH,
                                                  leases, BCP-008, DDNS, …)
```

## Status

Early. Milestone 1 (this tree) boots the engine in-process, shows the live
NMOS inventory as routable groups, routes sender→receiver through IS-05, and
keeps Route Desk's tags, favorites, activity and panels. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the model mapping and the roadmap
(multicast UI, BCP-008 column, Setup page, manual group builder, audio
monitor, MXL/BCP-007-03).

## Run

```bash
npm ci
npm run build          # compiles the vendored engine (TypeScript → packages/crosspoint-engine/dist)
cp .env.example .env
npm start              # demo mode by default: http://127.0.0.1:8194
```

Live mode: set `ROUTING_MODE=live` and either `NMOS_REGISTRY=<registry ip>` or
let the engine discover the registry (unicast DNS-SD, then mDNS). The engine's
own configuration lives in `data/engine/config/settings.json` (seeded from
`packages/crosspoint-engine/config.default/settings.json`) and its persisted
state in `data/engine/state/`. Routing is read-only until `WRITE_ENABLED=true`.

Docker:

```bash
cp .env.example .env
docker compose up -d --build
```

The compose file uses host networking so registry discovery, IS-05 control
and multicast features reach the media network.

## Tests

```bash
npm test
```

`test/integration.test.mjs` includes a live-mode test that boots the real
engine against an unreachable registry and asserts that the UI reports it and
refuses writes.

## Attribution

- `packages/crosspoint-engine/` is vendored from
  [chrisjlapp/nmos-crosspoint_v3](https://github.com/chrisjlapp/nmos-crosspoint_v3)
  (NMOS Crosspoint, © Johannes Grieb, MIT — see
  `packages/crosspoint-engine/LICENSE.md`; the upstream commit is recorded in
  `UPSTREAM-COMMIT`). Its `src/lib` is kept unmodified so upstream fixes can
  be merged; only `package.json`/`tsconfig.json` were adjusted to build it as
  a library, and `server.ts`/the Svelte UI are not used.
- The operator UI and server come from
  [KeithB-Media/videoipath-route-desk](https://github.com/KeithB-Media/videoipath-route-desk).
