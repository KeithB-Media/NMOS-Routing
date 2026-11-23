# Local patches to the vendored engine

`src/lib` is kept as close to upstream (`UPSTREAM-COMMIT`) as possible so fixes
can be merged. Every deviation is marked in the source with a comment that
starts `NMOS-Routing patch` and is listed here. Patches are candidates for
upstream pull requests.

## BCP-007-03 — NMOS With MXL

Adds the MXL transport (`urn:x-nmos:transport:mxl`) next to RTP.

- `crosspointAbstraction.ts` — `CrosspointConnectionSenderInfo.mxlParams`:
  the sender's IS-05 `transport_params` (`mxl_domain_id`, `mxl_flow_id`).
- `nmosConnector.ts` `connectionGetSenderInfo` — for MXL senders skip the
  manifest (there is no transport file) and read the params from the mirrored
  `/single/senders/{id}/active` data, fetching it on demand if missing.
- `nmosConnector.ts` `makeConnection` — refuse RTP↔MXL mixes with a clear
  error; for MXL receivers send `{mxl_domain_id, mxl_flow_id}` per leg, no
  `transport_file`, and `{}` instead of `rtp_enabled:false` on disconnect.
- `crosspointUpdateThread.ts` — tag `capabilities.transport = "mxl"` on MXL
  senders and receivers.

Spec: https://specs.amwa.tv/bcp-007-03/ (IS-04 v1.3+, IS-05 v1.2+). Receiver
capability checks (BCP-004-01 `constraint_sets`) are done in NMOS Routing's
planner layer (`public/caps.js`, `lib/model.mjs`), not in the engine, so no
further engine patch was needed.
