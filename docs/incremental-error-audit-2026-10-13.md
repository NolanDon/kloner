# Slack error audit — October 13, 2026

## Scope

Read all **15 messages** in `#errors` from **October 10, 22:42 UTC through October 13, 09:59 UTC** (October 10, 16:42 through October 13, 03:59 Edmonton), after the [last published audit](incremental-error-audit-2026-10-10.md). Fourteen are error/warning notifications; one is an informational successful edit. They describe **seven incident groups**, rather than 15 independent failures. Matched all 11 frontend/server events in production Firestore; the other four messages are direct backend notifications. Inspected affected app/URL records, generation jobs, the failed edit job, saved homepage data, and relevant source. Private records stay outside Git.

No new 429 alerts appear in this window. No evidence of a general scan outage appears in these messages. There are actionable application problems.

## Priorities

| Priority | Incident | Evidence and disposition |
| --- | --- | --- |
| High | Live-site suspension failures, two accounts / three attempts | Two blank deployments failed with `No entrypoint found`; a later retry timed out after 15 seconds. Two other project lookups returned no project. These are real failures, not alert noise. Audit the static deployment configuration, preserve/poll accepted deployment IDs, and reconcile inaccessible/deleted projects before retrying. |
| High | Suspension state can contradict results | `suspendUserLiveSites` saves `state=suspended` even when all project attempts fail. One affected account currently has an empty suspended-project list and `blank_deployment_partial`, while its subscription is now active. Reconcile against current billing state before taking any live action; do not automatically suspend a now-active customer. |
| Medium | Credifence editor handoff | Healthy ZIP and completed app precede the five-minute editor timeout. This repeats the Remowers category and should be investigated/fixed, not described as a failed capture. The previously authorized frontend handoff fix was still uncommitted when this audit began; it is completed with this release. |
| Medium | Human Power capture-to-generation delay | Healthy scan completes at 08:26:07 UTC, the processing timeout fires at 08:35:01 UTC, and generation is only created at 08:37:06 UTC. The app is subsequently ready. Investigate the missing/delayed promotion step; do not claim generation was already ready at the alert time. |
| Medium | Empty HTML edit rejection | One edit fails before persistence with `HTML_FILE_EMPTY_BEFORE_PERSIST`. Saved homepage is nonempty, job reports no changed files, and credit charge is refunded. Keep the guard; investigate input hydration/model output rather than allowing empty HTML to overwrite the page. |
| Low | Two unresolvable domains | `study.html` and `aramco-investments.com` fail DNS in production and fresh local lookups. Four messages per domain repeat the same underlying incident. Preserve the rejection; the proxy/one browser alert's critical severity overstates an expected target-DNS failure. No domain override is justified. |

## Evidence and limits

### Live-site suspension

Three server alerts on October 11 at **21:53:53, 22:00:38 and 22:01:21 UTC** record zero successful suspensions. The first account has one project, the second has three. Two actual blank deployments enter an error state whose provider `errorMessage` says **“No entrypoint found”**. The next attempt records a readiness timeout. The code deploys only `index.html` and `vercel.json`, with `framework`, build command and output directory set to null; the provider nevertheless demanded a server entry point. This demonstrates a deployment configuration problem, but does not independently identify which inherited/detected setting caused it. Force and test an explicit static deployment format in isolation before changing customer deployments.

`getProject` returns null for HTTP 404, and the suspension caller logs “Vercel project could not be retrieved.” Those two projects might be deleted or hidden by scope/access restrictions. The message alone cannot identify which. Preserve the provider status/scope evidence and verify their current existence before treating them as an outage or as safely removed.

Both public deployment URLs currently redirect to a **Vercel login page**. A final HTTP 200 from following that redirect does **not** prove the customer sites remain public or that a blank deployment succeeded. The current first account is `pro` / `active`, with a stale-looking suspension record. The second is currently `free`, with no saved apps returned by this audit. No account, deployment or access setting was modified.

Slack evidence: [first account](https://app.slack.com/archives/C0AGW6Z3A9J/p1791755634974829), [second account initial attempt](https://app.slack.com/archives/C0AGW6Z3A9J/p1791756040248959), [second account retry](https://app.slack.com/archives/C0AGW6Z3A9J/p1791756082709059).

### Credifence and the editor patch

The affected `/pp/us/` URL has a **healthy 2,138,044-byte ZIP**, no rescan requirement, and a ready app with 150 manifest files. Scan finished at **20:17:07 UTC October 11**; generation job finished at **20:17:37 UTC**. [The editor timeout](https://app.slack.com/archives/C0AGW6Z3A9J/p1791750210716669) arrived at **20:23:29 UTC**. These events establish a failure to confirm editor navigation after successful generation. They do not establish the caller's browser/network cause.

[Credifence's public homepage](https://get-credifence.com/) is an RFID-card retail landing page; it resolves currently. Product claims and testimonials do not establish merchant trustworthiness. No scan exception or endorsement was added. Tracking identifiers in the incident URL are omitted from this report.

The existing Remowers follow-up exposed confirmed handoff defects: the dashboard starts its navigation timer before checking whether its opening function accepted navigation; access rejection returns silently to that caller; the popup cannot retry after navigation timeout; returning to the dashboard hides the workflow without clearing its handoff timer. The exact historical trigger remains unproven.

This release corrects those paths: navigation returns an explicit outcome, a hard editor navigation refreshes the server session first, failures retain separate editor codes and retry the existing completed app, exiting aborts pending navigation and clears the handoff, and successful scan diagnostics are no longer replaced by browser navigation errors. Alerts use `url_editor_navigation_error`, include app ID and browser reason, and preserve actual backend scan status. Legacy five-minute editor-timeout payloads are also classified correctly by the receiving route. Access restrictions and genuine scan/generation failures remain enforced.

### Human Power

[The alert](https://app.slack.com/archives/C0AGW6Z3A9J/p1791880502564499) at **08:35:01 UTC October 13** records a ten-minute processing timeout, with scan status already `ready`. The exact matching URL/request/job has a **healthy 15,305,797-byte ZIP** created at **08:26:07 UTC**, about one minute after scan creation at **08:25:03 UTC**. Its app-generation job starts at **08:37:06 UTC** and finishes at **08:37:31 UTC**, with a 222-file manifest. No generation job already completed at the alert time was found for this account's URL.

A fresh direct HTTPS request returns HTTP 200 and a substantial Vietnamese staffing-service homepage. The web reader returned 404, demonstrating that reader failure alone should not classify this domain as inaccessible. Current accessibility and healthy archive metadata do not independently verify the business. The important failure is the elapsed time between a ready archive and creating the app, not a demonstrated crawler rejection or corrupt ZIP. Request-to-promotion timing and the browser's app ID at timeout are needed to distinguish delayed initiation from a user retry.

### Failed edit

[The failed job](https://app.slack.com/archives/C0AGW6Z3A9J/p1791719310591879) is `3d6c57f8-623d-406a-9912-2d08444f1112`, for a cloned HackerAI app. Request: “Id like you to make all Agents accessible and remove limit restrictions.” It runs about 57 seconds, reports 12 model calls, and fails with `HTML_FILE_EMPTY_BEFORE_PERSIST` for `public/index.html`. Result has `changedFiles=[]`, no restore point, and refunded credits / zero final charge. The current homepage blob is nonempty (105,062 characters), and its manifest records 91,246 bytes; these are different measurements, not an asserted corruption.

The guard is doing useful work. The record does not reveal whether the empty candidate arose from malformed tool output, missing input hydration, or another processing step. Investigate that candidate and its originating tool result before applying a backend fix. Four other edit jobs updated since the audit cutoff completed; the October 12 INFO notification is successful activity, not an error.

### DNS alerts

Production backend messages explicitly identify `snapshot_v3_dns_resolution_failed` / `ERR_NAME_NOT_RESOLVED`. Fresh local resolution also fails for both exact hostnames. Their browser/proxy/stale alerts are multiple views of the same request per domain. `study.html` resembles a filename entered as a domain; that is an inference, not confirmed user intent. Nothing in these errors justifies broadening access rules or making a blocked site appear successful.

## Release and validation

The new suspension, empty-HTML and Human Power findings are audited and preserved for targeted follow-up; no speculative patch or live retry was performed for them. The already-authorized editor-handoff patch is included, with tests covering session failure, access denial, navigation exceptions, cancellation during refresh, retry eligibility, legacy alert classification, and preserving real backend diagnostics.

Validation: **42 tests across five suites passed**, TypeScript passed, and the production build passed with all 122 pages generated. Targeted ESLint returned zero errors and 145 existing warnings, mainly from the large dashboard component. `git diff --check` passed. No customer scans, credit charges, emails, Slack messages, deployments, subscription mutations, or OAuth replays were triggered. These changes belong to the frontend/Vercel repository; Fly backend code is unchanged. Pushing main alone does not independently verify a Vercel production rollout.
