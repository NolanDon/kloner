# Vercel OAuth callback incident — October 9, 11 PM Edmonton

## Evidence and timeline

The six pasted alerts were independently confirmed in production Firestore `observability_events`. A bounded timestamp query from 04:59 to 05:02 UTC returned exactly these six events. A separate route query returned 12 historical callback events in total, of which these six were dated within the last week. Slack connector search did not return these messages; the incident evidence comes from the supplied messages and matching production database records.

| UTC, October 10 | Edmonton, October 9 | Observed fact |
| --- | --- | --- |
| 05:00:15.952 | 23:00:15.952 | First callback recorded in the session-verification catch branch. |
| 05:00:17.846 | 23:00:17.846 | Last of six rejected callbacks; the burst spans 1.894 seconds. |
| 05:00:39 | 23:00:39 | Firebase Auth records a subsequent sign-in for the account associated with the matching integration. |
| 05:03:36.779 | 23:03:36.779 | Matching integration’s `createdAt` and `updatedAt` fields record a save with `connected: true` and an encrypted access token present. |

All six requests supplied the same query `state` and team ID, but six different authorization codes and configuration IDs. Their full stored `next` parameters point at a Vercel dashboard integration URL. These are observed request parameters; the failed callbacks never verified the codes with Vercel, so parameters alone do not prove that Vercel issued them or that the requests came from a browser.

A projected scan of all 153 saved integration documents found one matching team. Its configuration ID also exactly matches one of the six callbacks. The associated account is Emiratespaymentpoint, one of the subscribers from the checkout audit. Firebase's subsequent sign-in and the matching integration's recorded save time support a connection flow that recovered after the burst. The callback overwrites `createdAt` on reconnect, so this timestamp does not prove a first-ever installation. They do **not** authenticate the six failed requests retrospectively. Full account identifiers and original request data are kept in private local audit artifacts rather than this Git report.

## What the failures actually mean

These events came from `app/api/vercel/oauth/callback/route.ts`: a **Next.js server route hosted on Vercel**, within the frontend repository. They were emitted by server code, not browser JavaScript. The callback does not invoke the Fly backend.

The old code calls `verifySession(req)` before exchanging the authorization code. Each stored event shows that execution entered that function call's catch branch. Therefore none of these six rejected invocations reached the OAuth token exchange or integration-write code.

The authentication helper expects a Firebase `__session` cookie. It rejects a missing cookie and rejects verification failures for a present cookie. However, the old callback discarded the exception and always reported `verifySession failed` with status 401—even for an unexpected server error. The stored records contain only `extra.reason = auth`, an empty stack, and no cookie-presence or underlying Firebase error code. They cannot distinguish a missing cookie, expired/revoked/invalid session, or a server-side verification problem. Firebase documents session expiration and revocation as separate verification failures. [Firebase session-cookie verification](https://firebase.google.com/docs/auth/admin/manage-cookies).

The callback actually responds with an **HTTP 302 redirect** to the error page. The displayed 401 was the logger's classification of the failure, not evidence of a 401 HTTP response. The new logs record both the failure classification and `httpResponseStatus: 302`.

### Why “anonymous” and “Req ID: n/a” appeared

The callback only obtains a trusted UID after successful session verification. Its reporting helper never passes `userId` or `requestId` to observability. The formatter substitutes `anonymous` and `n/a` when those fields are absent. In this auth-error branch, the user could not be verified; identifying the caller as the correlated account would overstate the evidence.

The old event also lacks IP, user agent, origin, referrer, cookie-presence flags, and provider request headers. Those facts cannot be reconstructed from the six saved events. Historical Vercel runtime/access logs were not available through the currently connected tools, so no claim is made about a source IP or browser/script identity.

### Why all six reached Slack

The old Slack fingerprint includes the entire callback URL. Each changing code and configuration ID generates a different fingerprint, even when the failure message and OAuth state are identical. All six therefore bypassed duplicate suppression. Additionally, the formatter labels browser and proxy events but did not label ordinary Vercel server events.

The six failures are worth retaining as a real connection incident. There is insufficient evidence to call them an attack, a bot, provider retries, or harmless noise. `source=external` is an integration flow parameter documented by Vercel, not proof of malicious access or the request's transport origin. [Vercel external integration flow](https://vercel.com/docs/integrations/create-integration/submit-integration).

## Patches

1. Add explicit `[SERVER / VERCEL]` and `[BACKEND / FLY]` labels and a component field, while preserving existing browser/proxy labels. The callback explicitly identifies itself as `nextjs-server`.
2. Describe missing identity factually: `unverified (no session cookie)`, `session cookie rejected`, or `session verification unavailable`. Only a verified Firebase session supplies a UID/email. Query team/configuration IDs remain explicitly request-supplied context.
3. Record platform request ID (or a labeled client-provided ID/generated fallback), IP header and its source, user agent, origin/referrer, fetch-site header, cookie/state presence and equality, a state fingerprint, reason, and actual redirect status. These OAuth diagnostics appear in Slack without requiring the global verbose flag. Header values are observations and are not proof of caller identity.
4. Preserve the safe Firebase error code and distinguish expected session rejection from infrastructure verification failures. Genuine server problems are logged as 500s rather than being mislabeled 401s.
5. Group same-flow failures into five-minute Slack notification buckets. Every occurrence is stored before Slack deduplication, so repeated alerts are reduced without losing evidence. Grouping uses a hashed state, team, observed caller headers, verified UID when available, and failure reason.
6. Require both a state cookie and an exactly matching query state before exchanging tokens. The old condition only rejected mismatches when a cookie happened to exist, allowing authenticated requests with no state cookie to proceed. Legitimate Kloner-started flows already set this cookie.
7. Refresh the server session before all three Kloner Vercel-connect entry points navigate externally. A Firebase client login alone does not establish that the server cookie is current; refresh failure stays in Kloner with a sign-in/retry message.
8. Redact authorization codes, raw OAuth state, signed tokens, URL credentials, and fragments from diagnostic URLs. Provider token response bodies are no longer printed. IP/UA and verified user metadata remain available for debugging without logging cookies or bearer tokens.
9. Decode valid local return cookies, constrain successful redirects to the configured origin, add a request reference, disable caching, and bound token exchange to 15 seconds. Avoid an additional browser alert when the error page already carries a server-recorded request reference.

## Verification and release

Tests exercise missing sessions, strict state checks, verified user context, rejection-versus-infrastructure classification, changing codes/configurations within one incident, encrypted token storage, provider and database failures, safe redirects, diagnostic redaction, and storing repeated occurrences while notifying Slack once. Regression checks passed: 37 tests across seven suites, covering OAuth, authentication, observability, frontend timeouts, checkout recovery, and Stripe webhooks. `npx tsc --noEmit` passed. ESLint returned zero errors and 145 existing warnings, mainly from the large dashboard component. The final production build passed, including compilation, TypeScript, and all 122 generated pages. The final observability formatter rerun passed all 10 tests. `git diff --check` passed.

No production OAuth codes were replayed, no user integration credentials were modified, and no live alert tests were sent. Existing incident records are preserved; the findings classify them rather than deleting evidence. The patch belongs to the frontend/Vercel repository. The Fly backend is unchanged. A push to main does not independently prove a successful Vercel rollout; deployment confirmation requires connected Vercel access.
