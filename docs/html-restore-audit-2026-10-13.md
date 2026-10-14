# HTML persistence / undo audit — October 13, 2026

## Findings

**The reported pair of HTML errors is one failed undo, reported by backend and frontend. It is a real application defect, not a failed agent edit or a reason to disable empty-HTML protection.** The agent had completed three edits with successful preview/health results before the failed restore.

Read all eight Slack messages since frontend change `5e6c832` (October 13, 10:06:13 UTC) through October 14, 00:49 UTC / October 13, 18:49 Edmonton. Three messages are successful edit notifications, two describe this undo failure, and three concern other scan/preview timeouts. Matched all four new frontend events in Firestore. Read the affected project's metadata, 182 saved blobs, four restore points and their file records, three completed edit jobs, and preview records. Original account identifiers, contact details, file contents, and replay identifiers stay in private local evidence.

## Replay access

Tried the supplied Mixpanel link first. The web reader could not access it, and the initial local browser lacked shared libraries. After extracting the missing browser dependencies into a temporary directory, a real browser opened the link and was redirected to **Mixpanel Request Access / “You need permission.”** No access request was submitted. **The replay was not watched.** A shareable link or authenticated access is still needed to verify the exact visual experience. The conclusions below come from production records and source code, not an assertion of having observed the session.

## Timeline — October 13 UTC

| Time | Observed result |
| --- | --- |
| 23:00:06 | Contact-information edit completes; one file changed, live static apply succeeds, preview runtime probe returns HTTP 200. |
| 23:09:27 | “Remove the news tab” edit completes; four paths change, including deletion of `public/article/index.html`. Preview apply and health check succeed. Its earlier content remains in the edit's restore point. |
| 23:18:30 | Another request completes with one changed file, `test.txt`, containing empty text. Empty text files are allowed. Preview apply and health check succeed. |
| 23:19:53 | Undo of that last change creates/reuses an inverse restore point. Its intended file operation is deletion of `test.txt`. |
| 23:19:54 | Backend rejects a full-project save because an unrelated `public/article/index.html` appears empty. |
| 23:19:56 | Frontend records the same restore request's HTTP 422 and `HTML_FILE_EMPTY_BEFORE_PERSIST`. |

The failed restore endpoint is `/api/app-embeddings/agent-v3/restore-points/1029c57e-50de-4e9b-8b29-64bcf6b1b4c5/revert`. [Backend alert](https://app.slack.com/archives/C0AGW6Z3A9J/p1791933596636589), [frontend alert](https://app.slack.com/archives/C0AGW6Z3A9J/p1791933598501779).

## Root cause and impact

The incremental edit correctly deletes the article blob and its manifest entry. However, the app metadata write uses Firestore `set(..., { merge: true })` with a nested `files` map. Omitting a deleted path from that map does not remove the preexisting nested key. The captured project has **181 index entries versus 180 manifest entries**. The deleted article remains in the index as an empty-content metadata record claiming 79,412 bytes, while its blob and manifest entry are absent.

The loader falls back from missing blobs to index metadata and turns that obsolete record into an empty HTML file. Its snapshot audit checks path presence, so it initially mistakes that metadata stub for loaded content. Undo then saves **every project file**, although this particular undo only deletes `test.txt`. The safety guard correctly rejects the fabricated empty HTML candidate. It is a false failure of a valid undo caused by stale metadata; the guard itself is useful.

The full saver validates HTML inside its write loop. Records for `jsconfig.json` and `package.json` have writes at the failed undo's timestamp before the alphabetically later article is checked. Therefore this failure was **not guaranteed to leave persisted storage untouched**. Those paths were not intentional changes in the requested undo; historical byte-for-byte versions for them are unavailable, so the report does not claim a proven content change or corruption.

The failed call throws **before** the code that applies restored files to the preview or requests restart/health checks. It did not launch a new build or push that fabricated empty article page into the running preview. The previous edits' checks passed. Current preview records are stopped without a saved compile-failure contract; that later stopped state alone does not prove a build crash. No replay or historical browser console was available to establish every page's visual behavior.

User impact: Undo failed and did not confirm deletion of `test.txt`. `WorkspaceRestoreControls` catches the API error and displays it inline under Undo; it does not switch to Reapply on failure. This code path passes no failure to the preview's **Fix with AI** eligibility contract, so **this 422 does not itself offer Fix with AI**. This is established by source and regression tests, not direct replay observation. A paid model edit would not correct the underlying persistence/index bug; the appropriate recovery is a functioning Undo plus an actionable retry/support message. Actual compile/dependency failures retain their existing AI-repair eligibility.

## Patch

1. Replace the complete `files` and manifest fields using explicit Firestore merge-field masks. Deletions now remove old nested index keys instead of preserving them.
2. Recognize a complete, valid committed manifest as authoritative when loading/indexing old projects. Historical ghost entries from earlier merges no longer become fabricated empty pages. Incomplete/legacy manifests keep their fallback behavior.
3. Treat an expected nonzero file with empty loaded content as incomplete, rather than a successful file load. Missing binary assets retain their existing preservation path.
4. Validate all candidate HTML files before any file/blob/storage writes or deletes, in both full and incremental persistence. Genuine empty-HTML mutations still fail with 422.
5. Restore sharded projects incrementally: persist/apply only the restore point's touched paths. Preserve lease, conflict detection, inverse snapshots, cached successful responses, preview checks, and legacy full-save support. Validate restore candidates before creating the inverse snapshot.
6. Preserve genuine restore rejections in backend diagnostics with the actual restore route, request ID, app ID, path, and explicit preflight/no-file-persistence/no-preview-apply context.
7. Show a readable Undo retry/support message with request reference, preserving Undo state on failure. Do not trigger paid AI repair for a storage/restore rejection.

No customer's Undo was replayed live, no saved files/indexes were manually repaired, and no model credits were consumed by audit tests. The old record will be handled through the fixed loader and corrected on a subsequent legitimate save/undo.

## Other new alerts

- **Crutchfield:** scan ends `BLOCKED / snapshot_capture_blocked:forbidden_page`, zero ZIP bytes. A fresh direct request to the same URL also returns HTTP 403. Keep the rejection. The later generic ten-minute browser message is less specific than the definitive block record; it is not evidence of a corrupted archive or a general backend outage.
- **Vox Media Podcasts:** legitimate [public podcast-network site](https://podcasts.voxmedia.com/). Its scan eventually has a healthy **298,181,461-byte ZIP**, ready at 21:11:12 UTC after creation at 19:37:07. App generation completes at 21:23:14, after the 19:47:02 browser wait limit. The timeout reflects unconfirmed completion at that earlier time, not proof of a failed scan. Large-archive performance remains a separate issue.
- **Vox preview status 504:** the same account's later `/api/webcontainer-status` call times out. Its preview metadata still includes `archiving/preparing_files` and another `uploading_archive/uploading_files` record, with no saved compile error. Preserve this real preparation/status failure for separate investigation; do not classify it as the HTML undo bug or invent an AI-fixable build diagnostic.

The affected undo project's [source site](https://www.sungmei-machinery.com/) is publicly readable and presents packaging machinery. Neither its content nor the reviewed errors indicate a domain-policy block requiring an exception. No domain restrictions were relaxed.

## Validation and release

Backend predeploy checks passed: lint, syntax, and **619 tests total / 618 passed / one skipped**. A final focused run passed **117 of 118 tests / one skipped**, including persistence preflight, deletion masks, ghost-index loading, undo/reapply idempotency, conflict-safe restoration, and existing agent/controller behavior. Frontend validation passed **13 tests across three suites**, TypeScript, targeted ESLint (zero errors, 42 existing warnings), and the production build with all 122 pages generated.

An offline replay of the captured account snapshot passed using its **182 blob records and 180 manifest entries**, hydrating two larger text payloads read-only. Patched undo performed exactly one blob operation (the intended text-file deletion), removed the ghost index entry, and left every other captured blob unchanged. Production writes: zero.

Backend runtime commit **`85fea49`** is pushed and deployed to Fly as **`registry.fly.io/tracksite-hub:restore-fix-85fea49`**, digest `sha256:d51f13850a47c31ed2e1d552f31f82f0a611c4f3e3071c36b1289d315866ee56`. All nine managed machines updated to version 1749: hub and one worker started, seven workers stopped. Hub health passes; the public health endpoint returned `ok=true` at **2026-10-14 01:04:16 UTC**. A pure smoke check inside the live hub confirms a stale index path is removed and genuine empty HTML still raises `HTML_FILE_EMPTY_BEFORE_PERSIST`. Edit queue, picked-up and working counts were all zero before rollout. No customer preview was restarted for a regression test.

Frontend behavior/report commit **`b5bb380`** is pushed to main. Vercel production rollout cannot be independently verified through the currently connected tools. A closing Slack read found no additional messages after the initial audit cutoff. An added conflict regression also passes: all three restore-safety tests are green, including refusing newer edits without file or preview writes. Subsequent commits only add this test and record release evidence; they do not change the deployed runtime.
