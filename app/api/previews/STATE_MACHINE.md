# Previews BFF state machine

This folder contains Next.js route handlers that act as a BFF (browser-facing facade) for the hub.
The browser must only call these routes; it must never call the hub/Fly directly.

## Endpoints

- `POST /api/previews/apply`
  - Forwards to hub `POST /api/v1/webcontainer/apply`
  - Best-effort reliability logic on structured hub responses.

- `GET /api/previews/inspect`
  - Forwards to hub `GET /api/v1/webcontainer/inspect?appId=...&code=...`
  - Used as the “HMR readiness” check.

- `POST /api/previews/restart`
  - Forwards to hub `POST /api/v1/preview/:code/restart` with body `{ appId }`
  - Used when hub says proxy is not ready.

## Hub error codes

Hub may return non-2xx with `{ code, reason }`.

- `404 NO_ACTIVE_PREVIEW`
  - Meaning: no preview exists for `appId` (or the provided code is stale and no previews exist).
  - UI action: start/reconnect the preview, then retry.

- `409 MACHINE_NOT_READY`
  - Meaning: preview machine is booting or doesn’t have machineId wired yet.
  - BFF action: poll status briefly, then retry apply once.
  - UI action: show “starting…” and retry after a short delay.

- `409 PROXY_NOT_READY`
  - Meaning: proxy isn’t ready or needs a restart.
  - BFF action: restart once, poll inspect briefly, then retry apply once.
  - UI action: offer “Restart Preview”, then re-run inspect.

- `503 MACHINE_UNREACHABLE`
  - Meaning: machine exists but isn’t reachable (e.g. missing private IP).
  - UI action: show error; a restart may help depending on the reason.
