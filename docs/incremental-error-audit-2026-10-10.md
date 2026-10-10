# Incremental error audit — October 10, 2026

## Scope and evidence

Audit window: **2026-10-10 09:26:31–22:42:00 UTC** (**03:26:31–16:42:00 Edmonton**), starting at the previous OAuth audit commit `90cc4b5`. Read the actual Slack **#errors** channel (`C0AGW6Z3A9J`), then matched every alert to production Firestore `observability_events`. There were **four alerts and four matching event records**. A closing Slack/database read found no additional events through the stated cutoff. No new 429 or edit-plan alerts appeared in this window.

Read the affected URL records and Remowers app/generation job; checked public domain responses and local frontend/backend source. Six generation jobs created in the window completed with `status=done`, `stage=ready`, and no recorded error. Queries by `updatedAt` also returned those six jobs, zero edit-plan jobs, and zero preview-restart jobs in the audit interval through the query time. This does not establish that every historical project works.

A projected, paginated review of all **5,124 URL documents** found **six with their latest update in the window**: Online Dice was blocked; Remowers and four other URLs were ready with nonzero ZIP bytes. The other ready URLs were `chainsnap-2gqw7nal.manus.space`, `rekonise.com`, `smartfeni.com`, and `saaslu.mantrakshdevs.com`. These are current persisted outcomes, not independent endorsements of those websites or a complete history of intervening retries. The indexed timestamp collection-group query was unavailable; the projection fallback required no index or production configuration changes.

Fly's available 100-line log tail covers only 22:30:40–22:39:40 UTC and contains no error-level records or HTTP 4xx/5xx responses. It cannot reconstruct the morning incidents. Private evidence files retain original records locally; this report omits account emails, IP addresses, credentials, signed storage URLs, and customer file contents.

## Findings

| Edmonton time | Alert | Assessment | Disposition |
| --- | --- | --- | --- |
| 04:27:41 | [OAuth: missing code, 400](https://app.slack.com/archives/C0AGW6Z3A9J/p1791628063450049) | A bare callback URL has no authorization code. It cannot complete OAuth. | Correct rejection; low actionability. No new patch. |
| 04:27:45 | [OAuth: session verification, 401](https://app.slack.com/archives/C0AGW6Z3A9J/p1791628066594409) | Session was not verified; query values are literal test placeholders. Caller and exact session failure are unproven. | Retain rejection; no authentication bypass or additional OAuth patch. |
| 09:53:02 | [Online Dice: “Load failed,” critical 502](https://app.slack.com/archives/C0AGW6Z3A9J/p1791647583812519) | Browser failure preceded a persisted upstream block. The 502 does not prove a backend HTTP 502. | Valid scan block; misleadingly generic browser diagnosis. Preserve block and incident. |
| 10:05:09 | [Remowers: editor timeout, 504](https://app.slack.com/archives/C0AGW6Z3A9J/p1791648310858549) | Scan and app generation succeeded before the alert. The browser's editor-navigation timer expired. | Worth investigating as an editor handoff issue; not a failed scan or reason to rescan. |

### OAuth: rejected requests, not proof of another connection outage

The first record contains the bare callback URL and `extra.reason=token`. The second contains `code=secret-code&state=secret-state` and `extra.reason=auth`; those literal placeholder values also appear in the repository's observability redaction test. This is evidence of a test-like request, **not proof that a particular person, test runner, or attacker sent it**. The unit test mocks its dependencies; matching strings do not establish that it caused a live request.

Both records have the legacy format: no component, request ID, verified UID, or detailed authentication cause. The callback is a **Next.js server route on Vercel**, not browser code or the Fly backend. Under the old implementation, 400/401 describe the logged failure while the callback actually returns a 302 redirect. Neither rejected branch exchanges OAuth tokens.

The prior OAuth patch already improves identity, request diagnostics, secret redaction, and session/state handling. These records are inconsistent with that patched callback's logging shape at 10:27 UTC; they do not prove the current production deployment version or why older code served the requests. Deployment/version confirmation remains a separate check requiring Vercel access. Adding another patch would not resolve that uncertainty.

### Online Dice: real upstream protection; no false block demonstrated

[Online Dice](https://www.online-dice.com/) is a public virtual dice simulator, rather than an identified piracy site. Its public page is readable through the web reader. However, a fresh direct request from this audit environment returned **HTTP 403**, with title **“Just a moment...”** and Cloudflare challenge resources. Accessibility differs by client/network; the web reader's success does not mean the production crawler has access.

The exact affected URL document matches the alert's request/job IDs. Its creation time is **15:51:17.276 UTC**. The browser reported “Load failed” at **15:53:02.325 UTC**, while its observed backend status was still `in_progress`. At **15:53:06.639 UTC**, the persisted document recorded:

- `status=stale`, `retry=true`;
- `lastErrorCode=BLOCKED`;
- `lastError=snapshot_capture_blocked:forbidden_page`;
- zero ZIP bytes and no ZIP path.

The browser event predates the definitive block record by about **4.3 seconds**. “Load failed” does not establish the failed network request, an upstream 502, or a Fly outage; it may be a transport failure, but the saved event does not identify its cause. The later record and independent 403 support preserving the scan rejection. There is no evidence of healthy content incorrectly rejected by the detector, so no domain exemption, fabricated success, or crawler patch was applied.

### Remowers: successful capture followed by an unresolved editor handoff

[Remowers](https://remowers.shop/) returned **HTTP 200** to a fresh direct request. Its public page presents an appliance shop with product categories, contact information, and policies. Those self-published claims do not verify merchant legitimacy; UK delivery language alongside euro prices warrants caution rather than a definitive trust judgment. No piracy content was identified in the reviewed homepage. No domain policy exception is needed to explain this incident.

Production evidence for the alert's exact URL/request/job:

| UTC | Result |
| --- | --- |
| 15:58:18.295 | Scan URL record created. |
| 15:58:45.262 | Scan `ready`; **894,239-byte ZIP**, 10 HTML pages, 6 stylesheets, 26 images; archive health `healthy`, all listed checks pass, `needsRescan=false`. |
| 15:59:01.605 | App generation job/app created. |
| 15:59:14.845 | Generation job `done`, `finished=true`, `stage=ready`, no error. App generation also records readiness. |
| 15:59:37.657 | App updated, with sharded file manifest and entry points `package.json`, `server.js`, `public/index.html`. |
| 16:05:09.383 | Browser reports “Opening your editor timed out after 5 minutes”; backend status still `ready`. |

Source inspection confirms this exact message originates in `draftFlow.ts` for a **navigating** session after five minutes, separate from its ten-minute processing timeout. The dashboard starts that phase before asking the editor-opening function to navigate. Existing access guards or failed/stalled navigation can leave the page in place; the event lacks the data needed to distinguish those paths. A functioning editor render is not proven by completed generation alone.

Therefore the alert's **“URL capture failed” wording, generic `URL_CAPTURE_TERMINAL_ERROR` code, and “Backend reason” label misattribute a browser navigation timeout to capture/backend diagnostics**. The timeout itself remains useful evidence of a user-facing problem. The immediate recovery is to open the existing completed app from the dashboard; repeating its successful scan is not justified by this alert.

If it recurs, the useful next evidence is the target app ID, navigation/access decision, destination, page lifecycle, and whether the editor request reached Vercel. That would support a targeted handoff fix. Current records establish the stage mismatch but not a safe root-cause repair; no speculative editor rewrite or scan change was made.

## Changes and validation

**Report only. No application patches were necessary on the available evidence.** Valid OAuth rejections and upstream blocks remain intact; the editor timeout is retained for investigation. No Slack records were deleted, no emails sent, no OAuth codes replayed, no scans charged to accounts, and no customer documents or previews modified.

Validation consisted of matching Slack/database records, inspecting job and archive outcomes, read-only public HTTP checks, and tracing the relevant code branches. Application tests were not rerun because runtime code is unchanged. The report is committed to frontend main. The Fly backend is unchanged and requires no deployment for this report.
