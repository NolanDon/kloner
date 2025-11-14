// docs/credits-and-usage.md

# Kloner usage credits

## Overview

Kloner uses a simple credit system based on a user’s tier. Tiers are stored as Firebase custom claims and attached to the user session via `verifySession`.

Backend logic must treat credits as the source of truth. Client logic is only allowed to show remaining credits and block UI actions early, but must never be trusted for enforcement.

## Tiers

Current tiers:

- `free`
- `pro`
- `agency`
- `enterprise`

The tier is read from Firebase custom claims:

- `claims.userTier`

If the claim is missing or unknown, the tier is treated as `free`.

## Daily limits

Credit limits per tier (client view and backend enforcement should match):

- `free`
  - `screenshotDaily`: 3
  - `previewDaily`: 5
- `pro`
  - `screenshotDaily`: 100
  - `previewDaily`: 200
- `agency`
  - `screenshotDaily`: 400
  - `previewDaily`: 800
- `enterprise`
  - `screenshotDaily`: 0 (unlimited)
  - `previewDaily`: 0 (unlimited)

Limits are applied per UTC day or per agreed‐upon daily window. Backend must define the exact window.

## What consumes credits

- Screenshot credits:
  - `/generate-screenshots` backend controller, called via `/api/private/generate`.
  - Only successful queue/accept responses should increment usage.

- Preview credits:
  - Preview render controller (e.g. `/preview/render` backend route).
  - Only successful queue/accept responses should increment usage.

Errors or timeouts must not consume credits.

## Frontend behaviour

- `PreviewPage` reads user tier from Firebase ID token (custom claims).
- It maintains a local daily usage snapshot in `localStorage` as:
  - `kloner.credits.{uid}.{YYYY-MM-DD}`
- It shows:
  - Plan name (free, pro, agency, enterprise)
  - Screenshot credits used/remaining
  - Preview credits used/remaining
- On free plans:
  - When user runs out of screenshot credits:
    - `Rescan` is blocked client side.
    - Paywall modal appears with CTA to `/pricing`.
  - When user runs out of preview credits:
    - `Generate preview` is blocked client side.
    - Paywall modal appears with CTA to `/pricing`.
  - `Deploy` is visually locked and replaced with a paid upsell.

Client credits are soft limits; backend must still enforce hard limits.

## Backend expectations

Backend controller for `/generate-screenshots` (and preview render):

- Reads `uid` and `tier` from the internal context (never from the request body).
- Looks up current daily usage for that user and tier in the database.
- If usage >= limit, responds with 429 or 403 and a clear error message.
- If usage < limit:
  - Queues work.
  - Writes a usage increment entry only on success.
- Errors:
  - Failed queue or internal error must not increment usage.

## Security

To avoid reverse engineering around the credit system:

- All credit checks live on the backend.
- Tier value is only read from Firebase custom claims.
- API routes never accept `tier` or `credits` from the client body.
- Internal calls to the backend use server-side context (`userCtx`) and/or an internal API key.

## Upsell and conversion

- After first successful preview customization (first draft save) the user sees:
  - “Make this website yours” modal with a direct CTA to upgrade.
- Free plan users see:
  - Plan banner in the dashboard with daily limits and upgrade button.
  - Locked deploy button with messaging that deploy is a paid feature.

Stripe webhooks will later update `userTier` custom claims, which automatically updates both client display and backend enforcement without changing frontend code.
