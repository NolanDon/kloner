# Incremental Slack error audit — October 14, 2026

## Scope

Read all **seven messages** in `#errors` from **October 14, 00:49–21:25 UTC** (October 13, 18:49 through October 14, 15:25 Edmonton), overlapping the previous audit's closing read. They describe **four incident groups**. Matched the three frontend events in production Firestore; the remaining four notifications come directly from the backend. Read affected URL/app records, preview event histories, relevant source, and one current archive read-only. Private evidence omits account credentials from tool summaries and stays outside Git.

**No new 429, edit-job failure, or Undo/restore rejection appears in this window.** The new empty-HTML error is an initial app-generation failure, not a repeat of the restore/index bug fixed in `85fea49`.

## Findings

| Edmonton time | Incident | Outcome / disposition |
| --- | --- | --- |
| 07:09 | Yaga capture alert, critical 502 | Alert explicitly says `captureStatus=ready`, with no backend diagnostic or request ID. Matching scan is healthy; later app and preview are ready. Its critical backend-failure implication is unsupported. Investigate stale handoff/error state and classification; do not infer that the user saw no problem. |
| 08:58 | Free-plan size restriction, 402 | Authenticated Free account's request is rejected by the archive-size/hydration policy path. It is not evidence of a backend crash. The alert omits the actual limiting measurement; the source also maps hydration duration limits into this response. Do not assert that ZIP bytes exceeded the cap without that evidence. |
| 09:00 | Ethiopian Airlines app generation, three alerts | One real failed generation, reported twice by backend and once by browser. Guard rejects `public/akam/13/pixel_37ed7f43-d529f622/index.html` as empty. This needs artifact/input investigation and clearer diagnostics; do not disable the guard or declare the app successful. |
| 14:59 | Preview creation socket failure, two alerts | One failed preview startup reported at inner and outer catch layers. The same app has a subsequent preview ready **28 seconds later**; another copy also gets ready previews. Retain the failure, improve correlation/deduplication, and investigate bounded reconciliation before retrying machine creation. |

## Evidence and implications

### Yaga: misleading critical capture diagnosis

[The alert](https://app.slack.com/archives/C0AGW6Z3A9J/p1791983367457319) says “terminal error without a backend diagnostic; captureStatus=ready.” It contains neither backend status nor job/request IDs. The exact matching URL, including its tracking query, has a healthy **11,107,494-byte ZIP** and no rescan requirement. The same account's subsequent app is ready with 195 manifest files, and its preview records `ready` at **13:14:18 UTC**.

The event's referrer still points to the account's previous ShopLTK selection. That is useful evidence to investigate UI selection/handoff state, but does not prove which React or network path failed. The stored scan URL exactly matches the alert URL; this is not evidence that a tracking-query mismatch alone caused it.

`classifyScanAlert` already recognizes generic diagnostic-free terminal alerts as informational when `backendStatus=ready`. Here that field is absent, while readiness only appears in the message. The classifier therefore falls through to an unclassified critical 502. That 502 is the alert's classification, not an observed backend 502 response. A targeted classification fix should recognize this exact diagnostic-free UI-ready case while preserving actual archive/apply errors and genuine handoff failures.

[Yaga's public site](https://www.yaga.co.za/) presents a secondhand-fashion marketplace and is readable. No domain override is indicated by this incident.

### Free-plan 402: distinguish size from hydration time

[The 402](https://app.slack.com/archives/C0AGW6Z3A9J/p1791989906880509) occurred while the referrer pointed to an AI Designer share URL, not the airline URL used in the later failed generation. The account is currently Free. Its matching scan is healthy with a **2,315,104-byte ZIP**.

The backend maps `archive_zip_too_large`, `archive_uncompressed_too_large`, and `archive_hydration_too_large` to this paywall. The hydration helper can use the last code for both byte limits and a duration-budget overrun. Neither the event's response debug nor the scan metadata establishes the precise limit breached. ZIP size alone cannot prove the response was valid or invalid. Preserve policy enforcement, but record the limit type, measured value, configured cap, and elapsed time; separate hydration timeout from a size-based upgrade message.

### Airline: real generation failure, different from Undo

The backend reports the same job/request in [a generic failure](https://app.slack.com/archives/C0AGW6Z3A9J/p1791990011697299) and [an exception detail](https://app.slack.com/archives/C0AGW6Z3A9J/p1791990011775479), followed by [the browser terminal alert](https://app.slack.com/archives/C0AGW6Z3A9J/p1791990014001359). The saved app is `generation.status=error`, `finished=true`, stage `error`; its `internalError` names the empty pixel-path HTML. This affected the user: generation did not complete. No ready app is claimed.

The path resembles an Akamai ancillary pixel artifact. That inference is insufficient to allow arbitrary empty HTML or to assume the main booking page is usable. The requested URL is the airline's JavaScript-driven `#/confirmation` route; a public shell does not prove access to a user's booking confirmation or authenticated session.

The current URL record points to an older **458,732-byte ZIP**, marked healthy and no-rescan. Downloaded that exact ZIP read-only: it has three non-directory files totaling **1,300,930 uncompressed bytes**, including a 6,260-byte booking HTML shell and a `px6a/index.html` document. **It does not contain the reported `akam/13/pixel_...` path.** Therefore the currently stored ZIP is not sufficient to reproduce the failed job's materialized inputs; archive/input provenance at failure needs to be retained or recovered before applying an artifact filter. Do not claim that removing a file from this different archive fixes the recorded failure.

The code retains `HTML_FILE_EMPTY_BEFORE_PERSIST` on the thrown error but the generation catch maps non-rate-limit failures to generic user copy and HTTP-500 alert classifications. It also emits both a generic failure and exception notification. Improve error-code/stage propagation and incident correlation; keep a genuine empty-primary-page rejection. The previous restore patch concerns nested index deletion and touched-path undo, while this call runs the initial HTML-generation pipeline.

[The public airline booking shell](https://dxbooking.ethiopianairlines.com/dx/ETDX/) loads a JavaScript-required response in the web reader. It is on the airline's own domain; no piracy-domain exception or booking-session bypass is justified.

### Socket hang-up: recovered startup, not two failures

[Inner catch](https://app.slack.com/archives/C0AGW6Z3A9J/p1792011550542899) and [background catch](https://app.slack.com/archives/C0AGW6Z3A9J/p1792011550591959) share the exact preview code/app and occur within 80 milliseconds. Source inspection confirms that the inner catch logs and rethrows, and the outer background catch logs the same exception again. The inner event supplies an empty request ID; the outer retains one. That explains both duplicate notifications and the inconsistent diagnostic detail.

The failed preview records `archiving → uploading_archive → creating_machine → error`, with `socket hang up` and no saved machine ID. This is a real startup failure. The saved error lacks enough transport/provider detail to prove whether a remote creation was accepted before the connection broke. Blindly repeating a create request risks duplicate machines; reconcile by a stable creation key before adding retries.

Another preview for the **same app** reaches `ready` at **20:59:38 UTC**, 28 seconds after the failure at **20:59:10 UTC**. A second generated app copy has previews ready at **21:00:26** and **21:00:36 UTC**, with a successful probe recorded for the latter. They later stop. The original failed preview record stays in error; the recovery is a separate attempt, not proof that its socket failure was harmless.

The cloned domain is `dark-hz.gt.tc`; successful generation/preview metadata does not verify the trustworthiness of that third-party site. No target-site credential submission, live retry, or access-rule change was performed.

## Changes and validation

**Audit/report only: no application code or production configuration changed in this turn.** The archive mismatch and missing transport details leave important facts unresolved; no speculative content exception, create retry, or alert suppression was applied. The existing empty-HTML guard and Free-plan enforcement remain intact. No customer records, previews, Slack messages, charges, or emails were modified.

Verification was read-only: complete channel read, production record correlation, archive listing, preview timelines, and source inspection. No runtime tests or deployment were needed for this report. Report pushed to frontend main; Fly remains on the previously verified restore-fix runtime.
