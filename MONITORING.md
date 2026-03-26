# Observability (Vercel + Fly + Slack)

This project now has a unified critical-error pipeline:

- Captures API failures (4xx/5xx) from most Next.js routes via shared route guard
- Captures uncaught server exceptions with request/user context
- Accepts Fly/backend error events through a secure ingestion endpoint
- Stores all captured events in Firestore (`observability_events`)
- Sends rich Slack alerts (message + metadata + stack + deep link)
- Lets admins inspect events in `/dashboard/observability`

## What gets captured

An event includes:

- `statusCode`
- `route` / `page`
- `action`
- `method`
- `userId`
- `requestId`
- `message`, `errorName`, `stack`
- `service`, `source`, `environment`
- arbitrary `extra` payload

By default, only events at or above threshold are delivered:

- `critical` severity
- `statusCode >= 500`
- `statusCode >= 400` with severity `error`

## Required environment variables

Set these in Vercel:

- `SLACK_ERROR_WEBHOOK_URL` (required for Slack delivery)
- `OBS_INGEST_TOKEN` (required for secure backend ingestion)

Optional:

- `SLACK_ERROR_CHANNEL` (override channel)
- `OBS_PROJECT_NAME` (defaults to `kloner`)
- `OBS_DASHBOARD_BASE_URL` (defaults to `NEXT_PUBLIC_SITE_URL`)
- `OBS_ALLOW_UNAUTH_FRONTEND_INGEST=1` (only if you want global frontend errors ingested)
- `OBS_SUPPRESS_LOCALHOST_SLACK=1` (silence localhost-origin alerts; defaults to off in development)

## Slack setup

1. Create a Slack app with Incoming Webhooks enabled.
2. Create a webhook for your target channel.
3. Put webhook URL into `SLACK_ERROR_WEBHOOK_URL`.

Notes:

- Alerts are posted as normal Slack messages, so you can react with emoji, thread replies, assign ownership, etc.
- Alerts include a deep link button to `/dashboard/observability?event=<eventId>`.

## Fly/backend integration

Send events from Fly (or any backend) to:

- `POST /api/internal/observability/ingest`

Auth options:

- Header: `x-observability-token: <OBS_INGEST_TOKEN>`
- Or `Authorization: Bearer <OBS_INGEST_TOKEN>`

Single event payload example:

```json
{
   "source": "fly",
   "severity": "critical",
   "statusCode": 503,
   "route": "/api/v1/render",
   "method": "POST",
   "action": "render.create",
   "userId": "uid_123",
   "requestId": "fly-req-abc",
   "message": "Render worker crashed",
   "errorName": "WorkerCrashedError",
   "stack": "...",
   "service": "fly-backend",
   "environment": "production",
   "extra": {
      "jobId": "job_456"
   }
}
```

Batch payload (up to 25 events/request):

```json
{
   "events": [
      { "source": "fly", "severity": "error", "statusCode": 429, "message": "Rate limit hit" },
      { "source": "fly", "severity": "critical", "statusCode": 500, "message": "Unhandled exception" }
   ]
}
```

## Admin dashboard

Use:

- `/dashboard/observability`

Capabilities:

- View recent captured events
- Click an event to inspect stack and metadata
- Open deep links from Slack into the exact event

Access control:

- Uses existing session auth
- Requires Firebase custom claim `admin=true`

## Storage monitoring (existing)

WebContainer `/tmp` space is still relevant for build instability.

Log patterns:

- `ENOSPC`
- `Insufficient disk space`
- `npm install failed`
- `Available disk space in /tmp`
- `Emergency cleanup`
