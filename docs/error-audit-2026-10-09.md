# Incremental Slack error audit — 2026-10-09

## Scope and evidence

Reviewed every one of 78 messages in #errors from 2026-10-08 11:35:54 UTC through 2026-10-09 20:52:19 UTC. The deliberately overlapping window closes the gap after the original audit: 24 earlier messages, the 5 Krea messages already covered in the Krea follow-up, and 49 messages after that follow-up. A second read during this audit found no newer messages. These are messages, not 78 independent failures; browser, proxy, worker and backend often report the same request.

Read-only evidence: affected account URL records, two affected projects, edit-job results, all eight V3 restore metadata records and the affected project's 95 file blobs. Checked public domain responses, DNS, MIME types and redirects; ran the production Playwright capture/archive helpers in local isolation. Never submitted credentials to target sites, bypassed authentication/challenges, charged account credits, changed customer records, or restarted customer previews. Reports omit account emails, tokens, signed storage URLs and file contents.

Prior reports: [original audit](error-audit-2026-10-08.md), [Krea follow-up](krea-scan-incident-2026-10-08.md). Krea's five old alerts are not new regressions.

## Findings and dispositions

| Incident | Evidence and validity | Action |
| --- | --- | --- |
| Eight restore-point 404s | All eight IDs exist under the authenticated project's `workspace_agent_v3_restore_points`; dashboard detail/keep/legacy apply routes only read `restore_points`. Proven false negatives. | Detail/list/keep now read both namespaces. V3 apply delegates to the existing backend revert endpoint, retaining lease, completeness and per-file conflict checks. Missing records still return 404. Detail previews explicitly omit binary, stored-large and env-file content. |
| Eight failed edit jobs on one saved project | Two actual fast-restart readiness timeouts and six actual apply-readiness failures; each appears again in worker/health logging. Persisted file changes are real; preview success was not proven. Simple branding and subsequent repair/export prompts triggered these. Local reproduction of the current 95-file snapshot boots with HTTP 200 and 441,433 bytes of HTML. Original package snapshot differs in project name, not module type. Historical machine stdout is unavailable; cannot assert an original compile-error cause. | Fast restart timeout now tries one full archive restart with fast mode disabled; real recovery failures still fail. A V3 repair on an owned error/stopped preview can enqueue recovery from its saved snapshot rather than requiring its broken application to accept edits first. Missing machines and absent previews still fail. |
| Export requests mutated the customer site | “Help me export this cloned website…” modified an unrelated page. “Create a zip file … all files … project” created a ZIP server script and modified runtime files, followed by restart failure. This is incorrect intent routing. | Plain project-download requests return honest guidance to the captured ZIP in the URL dashboard, without model calls, writes, restarts or AI charges. Exporting the current edited project is not claimed as an implemented chat feature. Explicit requests to build export buttons/endpoints remain edit requests. |
| Vercel project name collision | Provider returned `Project "netbk-co-jp" already exists.`; current account record has a project ID and a later deployment URL. Recoverable creation collision, not evidence of upstream outage. Earlier browser “Failed to fetch” has no confirmed upstream HTTP 500. | For confirmed 400/409 name collisions, create a distinct app-specific project in the same team, bounded to three attempts. Never adopt, overwrite, or delete an unrelated existing project. Auth and unrelated provider failures are not retried. |
| Corrected domain inherited typo failure | `form-bnisytes.net` genuinely does not resolve. The corrected `form-bni.sytes.net` has a ready 431,733-byte one-page ZIP, but a terminal frontend alert attached the typo's failure/request ID. Proven diagnostic false negative; does not prove this bank-like dynamic-DNS site is trustworthy. | Select target-specific URL records and job state, cancel old asynchronous Firestore callbacks, and filter terminal diagnostics by full normalized URL identity. No DNS exception, access bypass, or safety endorsement for the corrected host. |
| Two stale alerts reported as critical 504 | One followed a proven DNS failure, another a proven target 403. “Stale” did not prove a timeout. | Include matching backend request/job/code/message; classify DNS, target blocks, rate limits and unsupported documents accurately. Unexplained stale state is an incomplete-scan warning, not an invented upstream timeout. Real timeout/internal-failure diagnostics remain errors. |
| Iframe failure called HTTP 403 / cookie block | Browser iframe load timed out; no upstream 403 or cookie diagnosis was demonstrated. Later restart completed. | Warning identifies unconfirmed iframe load; no invented cookie certainty or HTTP 403. Existing recovery remains. |
| Success noise | Four successful embedding batches, eight restart-queued events, six completed restarts, worker warmup and successful Beano snapshot lifecycle messages. | Keep usage/structured workflow logs while suppressing routine embedding and successful queued/completed restart Slack messages. Existing genuine error paths retain alerts. Prior release already suppressed routine worker/snapshot lifecycle Slack events. |

## Domain audit

“Public business/site” below describes observed content, not a guarantee of the operator's trustworthiness or every outbound link.

| Domain / URL | Public evidence | Current capture result and decision |
| --- | --- | --- |
| `massiverepair.com` | Public Florida heavy-equipment repair business, Wix page and contact/project content. | Two pages, 103 sampled files, healthy 8,517,392-byte ZIP. Stored account scan is already ready. Earlier ten-minute browser message is polling uncertainty, not proof of backend failure; exact completion timing is unavailable. |
| `epicredm.com` / `www.epicredm.com` | Public French RedM gaming community; redirects to `http://epicredm.online/`. | Three pages, 24 files, healthy 3,431,073-byte ZIP. Earlier polling timeout is real client uncertainty; current accessible capture needs no domain-specific bypass. |
| `starpets.gg` | Public game-item marketplace, redirects to `/adopt-me`. Commercial site; no operator/transaction endorsement. | One page, 220 sampled files, healthy 5,950,653-byte ZIP. Earlier large archive metadata missed HTML in limited sampling and produced generation 409; previous Krea/archive collector revalidation fix applies. No new safety allowlist. |
| `mycoveggie.gr` | Public Greek supplements retailer. Ordinary public HTTP fetch succeeds; this does not validate product health claims. | Browser capture still returns real 403. Preserve access rejection; no CAPTCHA/WAF bypass or fake success. |
| `demo82.leotheme.com/.../home-4.html` | Official LeoTheme public PrestaShop demo, coherent with [vendor catalogue](https://www.leotheme.com/blog/work-with-us/53-showcase/prestashop-templates.html?limitstart=0). | Browser capture still returns real 403. Legitimate vendor does not make this automated response accessible. Preserve block and correct stale-alert severity. |
| Two `cdn.jsdelivr.net/gh/.../main.svg` URLs | Trusted CDN domain serves `image/svg+xml`, not an HTML page. SVG embeds another site through foreignObject/iframe (`hypestudy.com`); the CDN identity does not establish the embedded operator's legitimacy. | Reject actual unsupported response MIME as 422 with page-URL guidance, replacing misleading internal 500. Both repository paths were checked; direct browser regression confirms 422 for the first. HTML endpoints with file-looking paths remain allowed. |
| `form-bnisytes.net` | DNS non-resolution on supplied typo. | True failure; retain DNS diagnostic. |
| `form-bni.sytes.net` | Resolves; bank-like dynamic-DNS identity is unverified and suspicious. Existing scan is already ready. | Correct wrong diagnostic correlation only; no added scanning exception or trust endorsement. No credentials entered. |
| `google.com/goto?...` | Redirector, not an operator identity. Alert explicitly states an account-plan restriction. | Preserve the 402 entitlement rejection; prior classification patch already corrects misleading frontend 502. |
| `beano.com` | Public entertainment publication. | The four messages describe successful capture/store, not failure; routine noise already handled by previous release. |
| `krea.ai` | Established public AI design site. | Five messages in this overlapping window belong to the already-remediated prior incident; see Krea report. |

Official provider reference used for team/project semantics: [Vercel REST API](https://vercel.com/docs/rest-api). Creating a new project stays in the same explicit team scope; the patch never resolves a collision by taking ownership of an existing project.

## Validation

- Backend predeploy: lint, syntax and controller/middleware/utility suites; final results recorded below before release.
- Frontend: restore detail/apply/keep tests verify owner/app scope, V3 conflict passthrough, retained missing-record 404s, and omission of sensitive/binary/unresolved diff content. Tests also cover hostname identity, Vercel bounded retries/auth failure preservation, scan classification and existing preview/chat behavior. Production build/type check results recorded below.
- Existing-account capture regression: ESPN Orlando Magic (1 page, healthy 214,784-byte ZIP), League Ledger (3 pages, 1,860,926-byte ZIP), Rotten Tomatoes Game of Thrones (3 pages, 9,465,119-byte ZIP), dog-site-seven.vercel.app (3 pages, 910,248-byte ZIP). All passed. These are captures/collections, not full generated-app deployment or visual-fidelity proofs.
- A first affected-domain test invocation omitted the local ZIP binary PATH; capture succeeded for accessible sites but archive creation reported local `spawn zip ENOENT`. Corrected the harness PATH and reran; results above come from that final run. This was a local test setup error, not a production issue.
- Local customer snapshot test only materialized a private temporary copy. Live account files, historical jobs, and restore points were not changed.
- Historical Slack messages remain audit evidence. No messages were deleted. Prior attempts to edit the posting bot's messages returned `cant_update_message`; this audit fixes future emitters rather than claiming historical cleanup.

## Release and remaining limits

Pre-release checks passed: backend `npm run predeploy` (611 passed, 1 skipped; lint and 169-file syntax check passed), frontend 13 focused/regression suites (59 tests passed), `tsc --noEmit` and production `next build`. Main push and verified Fly release details are recorded below. No success claim is based solely on saved files, a queued restart, HTTP 200 from a challenge page, or a present ZIP file. Access-blocked domains remain blocked; old failed jobs were not rewritten as successful. Historical customer preview readiness is not automatically repaired by deploying hub code: the next legitimate V3 edit/retry invokes the recovery path. Current edited-project ZIP export remains an explicit product limitation.

## Complete message ledger

UTC timestamps; each row links to the source message. Repeated layers are deliberately retained in this ledger.

| # | UTC | Action | Recorded HTTP | Disposition |
| --- | --- | --- | --- | --- |
| [1](https://app.slack.com/archives/C0AGW6Z3A9J/p1791459354955139) | 2026-10-08 11:35:54 | `snapshot_v3_rollout_used` | not provided | Routine workflow/success; not an independent error |
| [2](https://app.slack.com/archives/C0AGW6Z3A9J/p1791459408116269) | 2026-10-08 11:36:48 | `snapshot_v3_started` | not provided | Routine workflow/success; not an independent error |
| [3](https://app.slack.com/archives/C0AGW6Z3A9J/p1791459409445009) | 2026-10-08 11:36:49 | `snapshot_v3_ready` | not provided | Routine workflow/success; not an independent error |
| [4](https://app.slack.com/archives/C0AGW6Z3A9J/p1791459409522119) | 2026-10-08 11:36:49 | `snapshot_v3_new_store` | not provided | Routine workflow/success; not an independent error |
| [5](https://app.slack.com/archives/C0AGW6Z3A9J/p1791460428672799) | 2026-10-08 11:53:48 | `edit_plan_worker_ready` | 200 | Routine workflow/success; not an independent error |
| [6](https://app.slack.com/archives/C0AGW6Z3A9J/p1791463057083129) | 2026-10-08 12:37:37 | `url_capture_terminal_error` | 502 | True plan restriction; prior 402 classification fix applies |
| [7](https://app.slack.com/archives/C0AGW6Z3A9J/p1791474133543419) | 2026-10-08 15:42:13 | `n/a` | 409 | Archive sampling false negative; previous revalidation fix applies |
| [8](https://app.slack.com/archives/C0AGW6Z3A9J/p1791474135110739) | 2026-10-08 15:42:15 | `api.post` | 409 | Archive sampling false negative; previous revalidation fix applies |
| [9](https://app.slack.com/archives/C0AGW6Z3A9J/p1791476783113179) | 2026-10-08 16:26:23 | `preview_embed_policy_blocked` | 403 | Real iframe uncertainty; inferred cookie/403 claim corrected |
| [10](https://app.slack.com/archives/C0AGW6Z3A9J/p1791479760240139) | 2026-10-08 17:16:00 | `preview_restart_queued` | not provided | Routine workflow/success; not an independent error |
| [11](https://app.slack.com/archives/C0AGW6Z3A9J/p1791479766093639) | 2026-10-08 17:16:06 | `preview_restart_completed` | not provided | Routine workflow/success; not an independent error |
| [12](https://app.slack.com/archives/C0AGW6Z3A9J/p1791480360143819) | 2026-10-08 17:26:00 | `url_capture_terminal_error` | 502 | Polling uncertainty; current capture healthy, historical timing unproven |
| [13](https://app.slack.com/archives/C0AGW6Z3A9J/p1791482704379539) | 2026-10-08 18:05:04 | `snapshot_v3_failed` | 500 | True unsupported SVG input; correct to 422 |
| [14](https://app.slack.com/archives/C0AGW6Z3A9J/p1791482706012299) | 2026-10-08 18:05:06 | `url_scan_failed` | 500 | True unsupported SVG input; correct to 422 |
| [15](https://app.slack.com/archives/C0AGW6Z3A9J/p1791482709767359) | 2026-10-08 18:05:09 | `url_capture_terminal_error` | 502 | True unsupported SVG input; correct to 422 |
| [16](https://app.slack.com/archives/C0AGW6Z3A9J/p1791482774380549) | 2026-10-08 18:06:14 | `snapshot_v3_failed` | 500 | True unsupported SVG input; correct to 422 |
| [17](https://app.slack.com/archives/C0AGW6Z3A9J/p1791482800198679) | 2026-10-08 18:06:40 | `snapshot_v3_failed` | 500 | True unsupported SVG input; correct to 422 |
| [18](https://app.slack.com/archives/C0AGW6Z3A9J/p1791482801808059) | 2026-10-08 18:06:41 | `url_scan_failed` | 500 | True unsupported SVG input; correct to 422 |
| [19](https://app.slack.com/archives/C0AGW6Z3A9J/p1791482806146759) | 2026-10-08 18:06:46 | `url_capture_terminal_error` | 502 | True unsupported SVG input; correct to 422 |
| [20](https://app.slack.com/archives/C0AGW6Z3A9J/p1791483265588949) | 2026-10-08 18:14:25 | `snapshot_v3_blocked` | 403 | True target access block; retain |
| [21](https://app.slack.com/archives/C0AGW6Z3A9J/p1791483321459289) | 2026-10-08 18:15:21 | `snapshot_v3_blocked` | 403 | True target access block; retain |
| [22](https://app.slack.com/archives/C0AGW6Z3A9J/p1791486849080999) | 2026-10-08 19:14:09 | `url_capture_terminal_error` | 502 | Polling uncertainty; current capture healthy, historical timing unproven |
| [23](https://app.slack.com/archives/C0AGW6Z3A9J/p1791493409581709) | 2026-10-08 21:03:29 | `preview_restart_queued` | not provided | Routine workflow/success; not an independent error |
| [24](https://app.slack.com/archives/C0AGW6Z3A9J/p1791493413979199) | 2026-10-08 21:03:33 | `preview_restart_completed` | not provided | Routine workflow/success; not an independent error |
| [25](https://app.slack.com/archives/C0AGW6Z3A9J/p1791494838474689) | 2026-10-08 21:27:18 | `n/a` | 409 | Previously audited Krea incident; no new regression |
| [26](https://app.slack.com/archives/C0AGW6Z3A9J/p1791494840071289) | 2026-10-08 21:27:20 | `api.post` | 409 | Previously audited Krea incident; no new regression |
| [27](https://app.slack.com/archives/C0AGW6Z3A9J/p1791495560811899) | 2026-10-08 21:39:20 | `snapshot_v3_failed` | 504 | Previously audited Krea incident; no new regression |
| [28](https://app.slack.com/archives/C0AGW6Z3A9J/p1791495571964419) | 2026-10-08 21:39:31 | `snapshot_v3_failed` | 504 | Previously audited Krea incident; no new regression |
| [29](https://app.slack.com/archives/C0AGW6Z3A9J/p1791496006250359) | 2026-10-08 21:46:46 | `url_capture_terminal_error` | 502 | Previously audited Krea incident; no new regression |
| [30](https://app.slack.com/archives/C0AGW6Z3A9J/p1791537183693749) | 2026-10-09 09:13:03 | `preview_restart_queued` | not provided | Routine workflow/success; not an independent error |
| [31](https://app.slack.com/archives/C0AGW6Z3A9J/p1791537185601369) | 2026-10-09 09:13:05 | `preview_restart_queued` | not provided | Routine workflow/success; not an independent error |
| [32](https://app.slack.com/archives/C0AGW6Z3A9J/p1791537186375899) | 2026-10-09 09:13:06 | `preview_restart_queued` | not provided | Routine workflow/success; not an independent error |
| [33](https://app.slack.com/archives/C0AGW6Z3A9J/p1791537188501309) | 2026-10-09 09:13:08 | `preview_restart_queued` | not provided | Routine workflow/success; not an independent error |
| [34](https://app.slack.com/archives/C0AGW6Z3A9J/p1791537190302219) | 2026-10-09 09:13:10 | `preview_restart_completed` | not provided | Routine workflow/success; not an independent error |
| [35](https://app.slack.com/archives/C0AGW6Z3A9J/p1791537192530569) | 2026-10-09 09:13:12 | `preview_restart_completed` | not provided | Routine workflow/success; not an independent error |
| [36](https://app.slack.com/archives/C0AGW6Z3A9J/p1791537192886939) | 2026-10-09 09:13:12 | `preview_restart_completed` | not provided | Routine workflow/success; not an independent error |
| [37](https://app.slack.com/archives/C0AGW6Z3A9J/p1791537194790809) | 2026-10-09 09:13:14 | `preview_restart_completed` | not provided | Routine workflow/success; not an independent error |
| [38](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542423331859) | 2026-10-09 10:40:23 | `preview_restart_queued` | not provided | Routine workflow/success; not an independent error |
| [39](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542470179979) | 2026-10-09 10:41:10 | `preview_machine_restart_failed` | 504 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [40](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542470298269) | 2026-10-09 10:41:10 | `workspace_autonomy_v3_health_check_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [41](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542470465469) | 2026-10-09 10:41:10 | `edit_plan_worker_job_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [42](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542470825799) | 2026-10-09 10:41:10 | `embedding_batch` | 200 | Routine workflow/success; not an independent error |
| [43](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542471913099) | 2026-10-09 10:41:11 | `embedding_batch` | 200 | Routine workflow/success; not an independent error |
| [44](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542475148409) | 2026-10-09 10:41:15 | `api.get` | 404 | False 404; V3 namespace fallback fixed |
| [45](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542514144809) | 2026-10-09 10:41:54 | `workspace_autonomy_v3_health_check_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [46](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542514298579) | 2026-10-09 10:41:54 | `edit_plan_worker_job_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [47](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542519958039) | 2026-10-09 10:41:59 | `api.get` | 404 | False 404; V3 namespace fallback fixed |
| [48](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542549180259) | 2026-10-09 10:42:29 | `workspace_autonomy_v3_health_check_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [49](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542549362349) | 2026-10-09 10:42:29 | `edit_plan_worker_job_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [50](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542555163259) | 2026-10-09 10:42:35 | `api.get` | 404 | False 404; V3 namespace fallback fixed |
| [51](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542609651499) | 2026-10-09 10:43:29 | `workspace_autonomy_v3_health_check_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [52](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542609814339) | 2026-10-09 10:43:29 | `edit_plan_worker_job_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [53](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542616484289) | 2026-10-09 10:43:36 | `api.get` | 404 | False 404; V3 namespace fallback fixed |
| [54](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542736753689) | 2026-10-09 10:45:36 | `workspace_autonomy_v3_health_check_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [55](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542736943929) | 2026-10-09 10:45:36 | `edit_plan_worker_job_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [56](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542744503159) | 2026-10-09 10:45:44 | `api.get` | 404 | False 404; V3 namespace fallback fixed |
| [57](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542779094329) | 2026-10-09 10:46:19 | `workspace_autonomy_v3_health_check_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [58](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542779265109) | 2026-10-09 10:46:19 | `edit_plan_worker_job_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [59](https://app.slack.com/archives/C0AGW6Z3A9J/p1791542787798529) | 2026-10-09 10:46:27 | `api.get` | 404 | False 404; V3 namespace fallback fixed |
| [60](https://app.slack.com/archives/C0AGW6Z3A9J/p1791543178291009) | 2026-10-09 10:52:58 | `preview_restart_queued` | not provided | Routine workflow/success; not an independent error |
| [61](https://app.slack.com/archives/C0AGW6Z3A9J/p1791543224559109) | 2026-10-09 10:53:44 | `preview_machine_restart_failed` | 504 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [62](https://app.slack.com/archives/C0AGW6Z3A9J/p1791543224764249) | 2026-10-09 10:53:44 | `workspace_autonomy_v3_health_check_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [63](https://app.slack.com/archives/C0AGW6Z3A9J/p1791543224926669) | 2026-10-09 10:53:44 | `edit_plan_worker_job_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [64](https://app.slack.com/archives/C0AGW6Z3A9J/p1791543225339099) | 2026-10-09 10:53:45 | `embedding_batch` | 200 | Routine workflow/success; not an independent error |
| [65](https://app.slack.com/archives/C0AGW6Z3A9J/p1791543231419659) | 2026-10-09 10:53:51 | `api.get` | 404 | False 404; V3 namespace fallback fixed |
| [66](https://app.slack.com/archives/C0AGW6Z3A9J/p1791543259144519) | 2026-10-09 10:54:19 | `workspace_autonomy_v3_health_check_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [67](https://app.slack.com/archives/C0AGW6Z3A9J/p1791543259293099) | 2026-10-09 10:54:19 | `edit_plan_worker_job_failed` | 502 | Real preview failure; bounded recovery/intent patches, duplicates correlated |
| [68](https://app.slack.com/archives/C0AGW6Z3A9J/p1791543259614689) | 2026-10-09 10:54:19 | `embedding_batch` | 200 | Routine workflow/success; not an independent error |
| [69](https://app.slack.com/archives/C0AGW6Z3A9J/p1791543266163969) | 2026-10-09 10:54:26 | `api.get` | 404 | False 404; V3 namespace fallback fixed |
| [70](https://app.slack.com/archives/C0AGW6Z3A9J/p1791546895186249) | 2026-10-09 11:54:55 | `deploy_wizard_error` | 500 | Network uncertainty / recoverable Vercel name collision |
| [71](https://app.slack.com/archives/C0AGW6Z3A9J/p1791546911794569) | 2026-10-09 11:55:11 | `api.post` | 400 | Network uncertainty / recoverable Vercel name collision |
| [72](https://app.slack.com/archives/C0AGW6Z3A9J/p1791566391458109) | 2026-10-09 17:19:51 | `snapshot_v3_dns_resolution_failed` | 502 | True typo DNS failure; retain |
| [73](https://app.slack.com/archives/C0AGW6Z3A9J/p1791566393100999) | 2026-10-09 17:19:53 | `url_scan_failed` | 502 | True typo DNS failure; retain |
| [74](https://app.slack.com/archives/C0AGW6Z3A9J/p1791566394139949) | 2026-10-09 17:19:54 | `url_capture_terminal_error` | 502 | True typo DNS failure; retain |
| [75](https://app.slack.com/archives/C0AGW6Z3A9J/p1791566395084959) | 2026-10-09 17:19:55 | `url_capture_stale` | 504 | Misleading stale 504; backend diagnostic classification fixed |
| [76](https://app.slack.com/archives/C0AGW6Z3A9J/p1791566418033669) | 2026-10-09 17:20:18 | `url_capture_terminal_error` | 502 | False corrected-domain diagnostic; URL/job isolation fixed |
| [77](https://app.slack.com/archives/C0AGW6Z3A9J/p1791579136445509) | 2026-10-09 20:52:16 | `snapshot_v3_blocked` | 403 | True target access block; retain |
| [78](https://app.slack.com/archives/C0AGW6Z3A9J/p1791579139006049) | 2026-10-09 20:52:19 | `url_capture_stale` | 504 | Misleading stale 504; backend diagnostic classification fixed |

### Final-image Fly smoke test

Ran all 10 fixtures on temporary Fly machine `e820500cd29018` in `ord`, using the exact final image. Seven public-site captures produced healthy ZIPs, the two real access blocks remained 403, and the SVG input returned the expected 422. The QA machine was destroyed after results were saved. One initial VM launch hit registry `MANIFEST_UNKNOWN` immediately after image push; a retry succeeded before production rollout.

| URL | Outcome | ZIP bytes / diagnostic |
| --- | --- | --- |
| `https://www.espn.com/nba/team/_/name/orl/orlando-magic` | Healthy capture | 219147 |
| `https://league-ledger.com/` | Healthy capture | 1860926 |
| `https://www.rottentomatoes.com/tv/game_of_thrones` | Healthy capture | 9431130 |
| `https://dog-site-seven.vercel.app/` | Healthy capture | 912376 |
| `https://mycoveggie.gr/` | Valid rejection | 403 `SNAPSHOT_CAPTURE_BLOCKED` |
| `https://massiverepair.com/` | Healthy capture | 4694398 |
| `https://epicredm.com/` | Healthy capture | 3431073 |
| `https://starpets.gg/` | Healthy capture | 7279037 |
| `https://demo82.leotheme.com/prestashop/leo_agista_elementor_demo/home-4.html` | Valid rejection | 403 `SNAPSHOT_CAPTURE_BLOCKED` |
| `https://cdn.jsdelivr.net/gh/pineapple-petezah/homework/main.svg` | Valid rejection | 422 `UNSUPPORTED_SNAPSHOT_DOCUMENT` |

Code commits: backend `4cf2004`, frontend `b5e3da5`, both pushed to `origin/main` after tests passed. A final targeted preview recovery suite passed all 42 tests and controller lint after correcting recovery-state metadata.

Final runtime image: `registry.fly.io/tracksite-hub:deployment-01M4HFZ4PC971GVB6K295XJ78W` (`sha256:af12a6c7242084c3412e85a8e317747a48f37b550629b769a88ed060de76a638`). Production rolling deployment completed successfully. At 2026-10-09 23:36 UTC, all nine production machines used this image: hub `784ed164b19208` started, one worker started, seven workers stopped. Fly HTTP service check passed, and `/api/v1/health` returned `{ "ok": true, "service": "tracksite-hub-backend" }`. No QA machine remains. Preserved existing VM sizes; the stopped 512 MB/1 CPU worker was returned to that original size after Fly applied its general deployment VM default. Code commits remain the runtime source references; subsequent commits update this report only. Frontend changes are pushed to main and production-build validated; its Vercel rollout was not independently verified.
