# Executive Summary

This repository shows a real SaaS production stack, not a toy app: Firebase auth and Firestore, Vercel hosting/webhooks, Stripe billing, Resend email, Mixpanel, Google Analytics, Supabase OAuth automation, Google AI usage, and a backend crawl/generation service reached through `callBackend`. The code also shows meaningful controls: CSRF enforcement, app-scoped cookies, owner-only Firestore rules for most user data, signed unsubscribe links, and several deletion endpoints for app/render/storage data.

The compliance posture is still materially weak. The biggest verified issues are: a hard-coded internal API secret in `vercel.json`, no visible Privacy Policy page in the repo despite the Terms and signup UI referencing one, no backend-recorded evidence of terms/privacy acceptance, no self-serve account deletion or data export endpoint, analytics loaded globally without any consent gate, Mixpanel page-view tracking that includes query strings, Vercel integration access tokens stored plaintext in Firestore, and an external crawl backend whose SSRF/robots/rate-limit behavior cannot be verified from this repository. If EU residents are processed, GDPR is in scope because the app is globally accessible and the code does not geofence or suppress EU traffic.

Scope note: the crawl engine itself is delegated to an external backend (`BACKEND_URL` / `BACKEND_ORIGIN`) and is not present in this repository. The audit therefore verifies the front-end gate, route guards, and backend contract, but cannot directly confirm Playwright request interception, DNS pinning, robots.txt handling, or crawl-concurrency controls inside that external service.

# System Architecture Overview

- Frontend: Next.js app router in `app/`, shared client utilities in `components/` and `lib/`.
- Identity/session: Firebase Auth with a server session cookie (`__session`) and CSRF cookie (`csrf`). See `app/api/auth/session/route.ts`, `app/api/_lib/auth.ts`, `app/api/_lib/route-guard.ts`.
- Primary storage: Firestore under `kloner_users/{uid}` with subcollections for apps, renders, URLs, deployments, integrations, restore points, and metadata. See `firebase.rules` and app routes under `app/api/app-builder/` and `app/api/user-render/`.
- File/storage layer: Firebase Storage uploads under `kloner-images/public/...` and related buckets; signed download URLs are generated server-side. See `app/api/user-blob/upload-url/route.ts` and `app/api/user-storage/delete/route.ts`.
- Crawl/generation: user-submitted URLs are validated in `src/lib/publicHttpUrl.ts`, then proxied to the external backend through `src/lib/callBackend.ts` and `app/api/private/generate/route.ts` / `app/api/generate-app-from-url/route.ts`.
- AI/editing: Gemini is used for app-builder edits and AI-assisted changes in `app/api/app-builder/[appId]/agent/route.ts`, `app/api/ai-edit/route.ts`, and `app/api/app-embeddings/edit-plan/route.ts`.
- Billing: Stripe checkout, subscription sync, and cancellation flows in `app/api/billing/*` and `app/api/stripe/webhook/route.ts`.
- Analytics/observability: Mixpanel, Google Analytics, Slack/webhook error reporting, and optional session replay are wired from `app/layout.tsx`, `components/MixpanelClient.tsx`, `components/MixpanelAutocapture.tsx`, `lib/mixpanel.ts`, and `lib/observability.ts`.
- Third-party integrations: Vercel OAuth/webhooks, Supabase OAuth/project creation, Resend emails, Stripe, Google AI, Mixpanel, and Google Analytics.

# Full Data Inventory

| Data type | Classification | Source | Storage / processing | Third-party transmission |
|---|---|---|---|---|
| Email address, uid, display name | Personal data | Firebase Auth signup/login | Firestore user docs, session cookie, billing, support, notifications | Stripe, Resend, Slack/observability, Mixpanel identify/people, Vercel/Supabase flows |
| Session cookie, CSRF cookie | Security data | Server session bootstrap | Browser cookies; verified in `app/api/_lib/auth.ts` | None directly, but gates all downstream APIs |
| Submitted URLs | Personal/indirect identifier data | User input in login/dashboard/crawl flows | Firestore `kloner_urls`, app docs, observability events, blocked-attempt webhooks | Crawl backend, Slack/webhook, Mixpanel page views if embedded in query strings |
| Crawled HTML/content and derived structure | Potential personal data and sensitive inferred data | External site fetches | Firestore app docs / restore points / file manifests / backend artifacts | Crawl backend, Gemini AI routes when editing generated content |
| Screenshots / uploaded assets | Potential personal data | Capture pipeline and user upload routes | Firebase Storage, Firestore metadata, signed URLs | Firebase Storage download URLs, proxy route, possibly Vercel preview/export paths |
| AI prompts, current code, HTML snapshots, edit instructions | Potentially sensitive / third-party content | App-builder and AI edit routes | Sent to Gemini and backend edit services; some snapshots are stored in Firestore | Google Generative AI, backend generation service, Resend abuse mail when triggered |
| Analytics events, page URLs, click props | Personal data / inferred behavior | Mixpanel autocapture and page views | Local browser, Mixpanel server-side analytics | Mixpanel, possibly with query strings and uid/userTier/isAdmin |
| Google Analytics page paths | Behavioral data | Global script in `app/layout.tsx` | Browser GA client | Google Analytics |
| IP address, user agent, referer, request IDs | Personal data / indirect identifiers | Request headers and route-guard classification | Observability events, Slack alerts, blocked-signup alerts | Slack webhook, observability storage, abuse webhooks |
| Stripe customer/subscription IDs | Personal data / account linkage | Billing sync and webhook flows | Firestore user docs and billing state | Stripe |
| Vercel access token / project IDs / deployment metadata | Secret / account credential data | Vercel OAuth callback | Firestore integration docs and deployment docs | Vercel API |
| Supabase access token / refresh token / project provisioning data | Secret / account credential data | Supabase OAuth / finalize flow | Encrypted at app level in Firestore (`supabase_setup`) | Supabase API |
| Email preferences and unsubscribe status | Preference data | Notification prefs and unsubscribe routes | Firestore user doc fields | Resend only for delivery |
| Support/escalation content and feedback | Potentially sensitive | Cancel-subscription, support routes, observability | Firestore / Resend / Slack | Resend, Slack |
| Affiliate attribution / journey metadata | Inferred behavioral data | Cookies, localStorage, signup flows | Firestore user doc fields and client storage | Analytics and internal reporting |

# Data Flow Maps

## Authentication and session

Firebase Auth sign-in/sign-up happens in `app/login/LoginForm.tsx`. After a successful sign-in, the client posts the ID token to `app/api/auth/session/route.ts`, which mints the `__session` cookie. The CSRF token is issued separately and enforced by `app/api/_lib/auth.ts` and `app/api/_lib/route-guard.ts`. User docs are written in Firestore for `createdAt`, affiliate attribution, and notification preferences.

## URL ingestion and crawl

User input URL -> client validation in `src/lib/publicHttpUrl.ts` -> route validation in `app/api/private/generate/route.ts` or `app/api/generate-app-from-url/route.ts` -> backend proxy call via `src/lib/callBackend.ts` -> external crawl/generation backend -> Firestore app/render data and possibly Firebase Storage assets. Rejection reasons and blocked attempts can be reported to observability/webhooks.

## Storage and deletion

Screenshots/uploads -> `app/api/user-blob/upload-url/route.ts` -> Firebase Storage object + signed download URL -> `app/api/user-storage/delete/route.ts` for file deletion. App-level data -> `app/api/app-builder/delete/route.ts` (recursive delete of app doc and subcollections). Render history -> `app/api/user-render/delete/route.ts`. Account/session teardown currently stops at cookie deletion in `app/api/auth/session/route.ts`; no user account deletion or export endpoint is present.

## Analytics and observability

`app/layout.tsx` mounts Google Analytics globally and `AppClientProviders` mounts Mixpanel across the entire app. `components/MixpanelClient.tsx` identifies users and sends page-view events. `components/MixpanelAutocapture.tsx` sends click events for elements with `data-mp-event`. `lib/observability.ts` builds Slack alerts and can include userId, url, stack, request context, and derived fingerprints.

## Vendor flows

Stripe handles billing and subscription lifecycle. Resend sends welcome, cancellation, preference, and support emails. Vercel OAuth and webhooks store access tokens and deployment metadata. Supabase OAuth/project creation uses encrypted tokens for its setup doc, then talks to the Supabase API. Gemini receives prompts, current HTML/code, and generated content context for AI edits.

# Compliance Findings

## 1. Hard-coded internal API secret in deployment config

- Issue: `vercel.json` contains a live `INTERNAL_API_KEY` value and backend URL in source control.
- Severity: Critical
- Regulation impacted: OWASP, general security best practice, vendor security guidance
- Technical root cause: a shared deployment config file commits a sensitive secret that is used for backend request signing.
- Exact remediation patch: remove the secret from `vercel.json`, set it only in the Vercel environment store or secret manager, rotate the exposed key, and purge it from git history. If the backend expects the same key, rotate both sides and update `src/lib/callBackend.ts` to fail closed when the env var is missing.

## 2. No visible Privacy Policy page in repo

- Issue: Terms and signup UI reference a Privacy Policy, but no privacy policy route/file exists in the repository.
- Severity: Critical
- Regulation impacted: PIPEDA, Alberta PIPA, GDPR, CASL, OWASP
- Technical root cause: the app exposes only a Terms page and a signup checkbox; there is no implemented privacy notice page or policy route to show data practices.
- Exact remediation patch: add a real `/privacy` page, link it from signup and footer, and align it to the actual data map in code. Add versioned policy acceptance fields at signup and persist them server-side in Firestore with timestamp, policy version, and source route.

## 3. Consent acceptance is UI-only; no backend evidence of terms/privacy acceptance

- Issue: signup blocks progress unless the user checks the Terms box, but no server-side consent record is written.
- Severity: High
- Regulation impacted: PIPEDA, Alberta PIPA, GDPR, CASL
- Technical root cause: `acceptedTerms` is a React state gate in `app/login/LoginForm.tsx`; the submit flow never persists a consent artifact in Firestore or the auth session.
- Exact remediation patch: include `termsVersion`, `privacyVersion`, `acceptedTermsAt`, `acceptedPrivacyAt`, `acceptanceSource`, and `acceptanceIpHash` in the signup transaction, and prevent account creation unless those fields are written successfully.

## 4. No self-serve account deletion or data export endpoint

- Issue: the code supports app deletion and render deletion, but not a full user-account deletion or data export flow.
- Severity: Critical
- Regulation impacted: PIPEDA, Alberta PIPA, GDPR
- Technical root cause: `app/dashboard/settings/page.tsx` tells users to email support for closure/deletion; the backend only exposes partial object/app deletion routes.
- Exact remediation patch: add authenticated `GET /api/me/export` and `DELETE /api/me` endpoints that collect Firestore user docs, render docs, settings, deployment metadata, uploaded assets, and vendor identifiers; then delete or mark-for-deletion across Firebase Auth, Firestore, Firebase Storage, Stripe, Vercel, Supabase, and analytics systems.

## 5. Analytics is globally enabled without a consent gate

- Issue: Google Analytics loads on every page and Mixpanel initializes from the root provider; there is no cookie banner or consent gate in the repo.
- Severity: High
- Regulation impacted: GDPR, CNIL cookie guidance, OWASP, PIPEDA
- Technical root cause: `app/layout.tsx` always injects GA scripts; `AppClientProviders` always mounts Mixpanel components; `lib/mixpanel.ts` only supports an environment disable flag, not user-level consent.
- Exact remediation patch: add a consent manager that defaults analytics off until the user opts in where legally required, gate GA and Mixpanel script injection on that consent state, and expose a revocation path that clears Mixpanel persistence and stops session replay.

## 6. Mixpanel page views include query strings and user identity

- Issue: page-view telemetry can leak submitted URLs and other query parameters into Mixpanel events.
- Severity: High
- Regulation impacted: GDPR, PIPEDA, OWASP
- Technical root cause: `components/MixpanelClient.tsx` tracks `pathname` plus the full search string as `url`, and also identifies the user with `uid`, `userTier`, and `isAdmin` in `lib/mixpanel.ts`.
- Exact remediation patch: strip or hash sensitive query parameters before calling `trackMixpanel`, avoid sending user-provided URLs in page-view props, and move identity properties behind explicit consent and a documented analytics purpose.

## 7. Mixpanel session replay can capture unmasked text and inputs

- Issue: session replay is configured to allow text and input recording unless the vendor redacts it itself.
- Severity: High
- Regulation impacted: GDPR, PIPEDA, OWASP
- Technical root cause: `lib/mixpanel.ts` sets `record_mask_all_text: false` and `record_mask_all_inputs: false`, and enables replay/heatmaps via environment variables without a UI consent flow.
- Exact remediation patch: default replay off, require explicit consent for replay, and add DOM-level masking for any fields that can contain URLs, emails, prompts, or support data. Keep password fields excluded and verify with a test that sensitive fields never enter replay.

## 8. Vercel integration access token is stored plaintext in Firestore

- Issue: the Vercel OAuth callback writes `accessToken` directly to the integration doc.
- Severity: High
- Regulation impacted: OWASP, vendor security guidance, PIPEDA
- Technical root cause: `app/api/vercel/oauth/callback/route.ts` persists the token without app-level encryption, unlike the Supabase setup flow.
- Exact remediation patch: encrypt Vercel tokens before writing them to Firestore, store only the ciphertext plus metadata, and add a rotation/revocation path when the integration disconnects.

## 9. Crawl SSRF, redirect, and DNS-rebinding risk is not fully verifiable

- Issue: the repository validates submitted URLs, but the actual Playwright crawl backend is external and not visible here.
- Severity: High
- Regulation impacted: OWASP, GDPR, PIPEDA, Alberta PIPA
- Technical root cause: `src/lib/publicHttpUrl.ts` blocks obvious private hosts and sensitive terms, but the external backend still needs to re-resolve, pin, and re-check destinations at fetch time. The repo does not prove that redirects, DNS rebinding, or internal-IP resolution are blocked after validation.
- Exact remediation patch: enforce server-side destination checks inside the crawl backend, resolve hostnames to IPs before fetch, reject private/link-local/loopback/multicast/metadata ranges after redirects, disable cross-origin redirect following, rate-limit by user and domain, and log the deny reason without leaking target content.

## 10. No proof of robots.txt compliance or per-domain crawl throttling

- Issue: the product claims crawling capability, but no repo-visible enforcement of robots.txt or per-domain rate limiting exists in the front-end layer.
- Severity: High
- Regulation impacted: OWASP, PIPEDA, GDPR, general platform-abuse controls
- Technical root cause: the only visible guard is URL validation and credit gating; crawl politeness and abuse prevention are delegated to the external backend and not verifiable here.
- Exact remediation patch: add backend-side robots.txt fetch/parse before crawl, store a crawl-policy decision per domain, apply per-domain concurrency limits, and surface block reasons to the user.

## 11. App-level and render-level deletion exists, but storage lifecycle is incomplete

- Issue: some data deletes cleanly, but the repo does not show a complete end-to-end deletion lifecycle for all stored artifacts and backups.
- Severity: Medium
- Regulation impacted: PIPEDA, Alberta PIPA, GDPR
- Technical root cause: `app/api/app-builder/delete/route.ts`, `app/api/user-render/delete/route.ts`, and `app/api/user-storage/delete/route.ts` handle live objects/docs, but there is no backup purge policy, no export/deletion audit trail, and no account-level propagation to every vendor.
- Exact remediation patch: add a deletion ledger, mark records pending purge, propagate deletes to Stripe/Vercel/Supabase/analytics, and document backup retention and maximum deletion lag.

## 12. File upload route trusts client-supplied content type and has no size validation

- Issue: user uploads are stored using the request content-type and raw body with no visible MIME validation or size cap.
- Severity: Medium
- Regulation impacted: OWASP
- Technical root cause: `app/api/user-blob/upload-url/route.ts` accepts the request body as-is, derives the object name from a user-controlled filename, and stores whatever bytes are sent.
- Exact remediation patch: enforce a strict allowlist of image/media MIME types, cap upload size, sanitize the filename, verify image signatures server-side, and reject executable or polyglot payloads.

## 13. Observability and support tooling can capture PII and source URLs

- Issue: error reporting can transmit userId, URL, IP, user agent, referer, stack traces, and prompt snippets to Slack or related observability sinks.
- Severity: Medium
- Regulation impacted: PIPEDA, GDPR, OWASP
- Technical root cause: `lib/observability.ts`, `app/api/_lib/route-guard.ts`, `app/api/private/generate/route.ts`, and `app/api/ai-edit/route.ts` include rich diagnostic data in alerts.
- Exact remediation patch: redact URLs, hash IPs, truncate prompts, strip stack frames unless needed, and split operational logs from user-facing audit logs with a short retention window.

## 14. Firestore rules accept loose truthy admin/support values

- Issue: admin/support checks accept boolean, string, and numeric values.
- Severity: Low
- Regulation impacted: OWASP
- Technical root cause: `firebase.rules` uses `request.auth.token.admin == true || ... == "true" || ... == 1` and the same pattern for support users.
- Exact remediation patch: use a single typed custom-claim shape, document the claim issuer, and reject all non-boolean claim encodings.

# Vendor Risk Report

- Firebase / Firestore / Storage: core identity and data store. Good: owner-only rules exist for most user collections and storage paths. Risk: no code-visible DPA/residency controls, user deletion/export propagation not complete, and some tokens/metadata are sensitive.
- Vercel: hosting, webhooks, and OAuth integration. Good: webhook signature verification exists. Risk: plaintext Vercel access token in Firestore and hard-coded backend secret in deployment config.
- Stripe: billing and subscription lifecycle. Good: webhook signature verification and subscription sync are implemented. Risk: vendor payment data and subscription identifiers are retained in Firestore; delete/export propagation should include Stripe customer/subscription cleanup and invoice retention policy.
- Resend: sends welcome, cancellation, preference, and support emails. Risk: no visible consent ledger for marketing-style email categories; unsubscribe exists for journey/product mail only.
- Mixpanel: product analytics and optional session replay. Risk: global mount without consent gate, query-string leakage, user identity collection, and potential replay capture of sensitive content.
- Google Analytics: globally mounted from the root layout. Risk: no cookie consent gate and no opt-in suppression for EU users.
- Supabase: OAuth/project creation and API access. Good: sensitive setup tokens are encrypted in the Supabase setup flow. Risk: external processing and cross-border transfer need vendor paperwork confirmation.
- Google Generative AI: receives prompts, HTML, and code from app-builder and AI edit flows. Risk: prompts and crawled/generated content may contain personal data or third-party content; data minimization and processing notices need to be explicit.
- External crawl backend: receives the user-submitted URL and likely the Playwright fetch instructions. Risk: SSRF, DNS rebinding, redirect handling, robots.txt, throttling, and log hygiene are not verifiable from this repo and must be enforced in the backend service itself.

# Crawling & SSRF Risk Report

Verified protections:

- `src/lib/publicHttpUrl.ts` rejects localhost/private IP ranges, obvious sensitive hosts, and some abuse-oriented terms.
- `app/api/generate-app-from-url/route.ts` and `app/api/private/generate/route.ts` validate URLs before sending them to the external backend.
- `app/api/webcontainer-probe/route.ts` only allows localhost, Fly domains, or an explicit allowlist.

Residual risks:

- DNS rebinding is not disproven by string-based validation.
- Redirects can still move a request to an unintended destination unless the backend checks the final resolved IP/origin.
- The repo does not show robots.txt fetch/parse, crawl politeness, or per-domain concurrency controls.
- The external backend is outside this repository, so the actual Playwright request interception, metadata-endpoint blocking, and redirect policy cannot be audited here.

Required backend-side fix: enforce destination allow/deny logic after DNS resolution and after every redirect hop; reject RFC1918, link-local, loopback, multicast, and metadata-service ranges; cap crawl concurrency per user and per domain; and log only normalized deny reasons.

# Analytics & Tracking Report

Verified behavior:

- Google Analytics is injected globally from `app/layout.tsx` and initialized by `public/ga-init.js`.
- Mixpanel is initialized globally from `AppClientProviders` via `components/MixpanelClient.tsx` and `components/MixpanelAutocapture.tsx`.
- Mixpanel identifies users with `uid`, `userTier`, and `isAdmin` and emits page-view events for every route.
- Session replay can be enabled via env vars and is configured not to mask all text or all inputs.

Compliance gaps:

- No consent banner or consent-state persistence is present in the repo.
- Analytics is therefore opt-out by environment only, not opt-in by user choice.
- Mixpanel page-view URLs include query strings, which can leak submitted URLs, tokens, or user-generated content into analytics.
- The page-level click autocapture accepts arbitrary `data-mp-props` payloads, which could leak sensitive values if developers bind them to user content.

Required fix: make analytics and replay contingent on a stored consent state, strip or hash query strings, and add tests that no URL submission parameter or prompt content is sent to Mixpanel or GA without explicit consent.

# Security Vulnerability Report

- Critical: hard-coded internal API secret in `vercel.json`.
- Critical: no visible privacy policy page while signup/terms claim one exists.
- Critical: no self-serve account deletion/export path.
- High: analytics and replay on by default without consent gating.
- High: Mixpanel query-string leakage and identity propagation.
- High: plaintext Vercel access token storage.
- High: external crawl backend not verifiably protected against SSRF/DNS rebinding/robots/rate-limit abuse.
- Medium: storage upload route lacks MIME and size validation.
- Medium: observability and support tooling can expose URLs, user IDs, IPs, and stack traces.
- Low: Firestore auth claim checks are loosely typed.

# Policy Mismatch Report

- Terms page says personal data handling is described in a Privacy Policy, but no privacy policy route exists in the repo. See `app/terms/page.tsx` and the absence of any `privacy` page under `app/`.
- Signup UI forces a Terms checkbox, but no backend consent record is written.
- Settings page tells users to email support for deletion/export, while the product should provide a formal rights workflow.
- Marketing/privacy-sensitive tracking is active by default, which is incompatible with an opt-in cookie/analytics model in jurisdictions that require consent.
- Terms disclaim that the service does not pre-approve URLs, but the actual crawl backend must still enforce robots.txt, safety limits, and SSRF protections. That control is not proven in this repository.

# Required Fixes (Actionable Patch List)

1. Remove the embedded secret from `vercel.json`, rotate it, and move all backend credentials to the deployment secret store.
2. Add a real Privacy Policy page and persist consent evidence at signup.
3. Add account export and account deletion endpoints that fan out to Firebase Auth, Firestore, Storage, Stripe, Vercel, Supabase, and analytics processors.
4. Implement an explicit analytics consent manager and default analytics/replay off until consent is granted.
5. Strip query strings from Mixpanel page-view events and block sensitive props from autocapture.
6. Encrypt Vercel access tokens before writing them to Firestore.
7. Move crawl SSRF checks into the backend crawler and verify destination IP after DNS resolution and after redirects.
8. Add robots.txt handling, crawl rate limits, and domain-level throttling in the backend crawler.
9. Add upload MIME and size enforcement to the storage upload route.
10. Add a deletion audit log and a documented retention schedule for logs, analytics, backups, and screenshots.

# Final Compliance Posture Score (0–100)

36/100.

Justification: the app has real security primitives (session cookies, CSRF, owner-scoped Firestore rules, signed unsubscribe tokens, partial deletion routes), but the highest-value compliance controls are missing or unproven: privacy notice, consent evidence, analytics consent, self-serve rights handling, secret hygiene, and backend crawl hardening. The crawl backend itself is also outside the repository, so the most important SSRF and robots protections are not verifiable here.