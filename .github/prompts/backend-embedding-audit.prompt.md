---
description: "Backend agent prompt to audit embedding search misses, index coverage, and fallback behavior"
agent: "agent"
---

You are the backend agent for Kloner.

Goal:
- Audit why the embedding/search pipeline failed to locate text that clearly exists in many `index.html` files.
- Determine whether the failure is caused by stale embeddings, incomplete backfill, file filtering, chunking, ranking, fallback behavior, or request shaping.
- Identify the exact control point that should be changed in backend code or data.
- Also audit whether a no-hit search is still allowed to produce a generic placeholder file edit that then triggers a preview restart or fake cold boot state.

Task:
- Inspect the current embedding backfill state for `kloner_apps`.
- Verify whether the target files are actually indexed, and whether the relevant text exists in the indexed chunks.
- Check whether the current planner/search flow is using the right file set, current file anchor, and quoted text signals.
- Check whether the search path is falling back too early or returning too few candidates.
- Check whether the edit-plan path is receiving enough retrieved chunks and whether it is discarding them.
- Check whether Slack or observability logs already record the selected paths, retrieved chunks, and fallback reason.
- Recommend the smallest backend change needed to fix the miss.
- Inspect the live-apply path (`/api/previews/apply`) and confirm whether a placeholder response from edit planning can lead to a restart request, a stale preview code, or a booting UI state even when no machine is actually building.
- Check whether `usedFallback: true` or `candidates: 0` should be treated as a hard no-op instead of producing a generated replacement for `app/page.tsx` or similar placeholder content.

What to inspect:
- Embedding backfill job/state for apps and files.
- Chunk storage schema and source hash / updatedAt handling.
- Search endpoint request shape, especially `appId`, `query`, `currentPath`, `requestText`, and `maxChunks`.
- Planner behavior for quoted copy/banner edits and visible text edits.
- Fallback behavior when no embedding hits are returned.
- Any lexical fallback, exact phrase matching, or path scoring logic.
- Slack alerts / audit events / observability payloads for zero-hit searches and no-op edit plans.
- Apply/restart orchestration after AI edits, including whether `needsRebuild`, `requiresRestart`, or a stale preview code causes the editor to show "Project still booting" when the machine is actually absent.

Specific questions to answer:
1. Is the banner text present in the embedding index for at least one `index.html` file?
2. If not, is the backfill missing those files or skipping them by extension/path rules?
3. If yes, why did the search return `candidates: 0` and `returned: 0`?
4. Did the request include the wrong `currentFile` or an unhelpful anchor that biased the planner?
5. Is the planner requiring an exact path hint when it should broaden on quoted copy/banner requests?
6. Is the backend throwing away retrieved chunks before edit-plan generation?
7. Does the Slack/observability payload clearly show what was searched, what matched, and why the fallback happened?
8. Did the backend generate a placeholder `app/page.tsx` edit because the search missed, and if so, what guard should stop that from being applied?
9. Did the live-apply path restart or reconnect a preview based on that placeholder edit even though no actual machine/build existed?

Desired output format:
- Brief summary of the root cause.
- Exact files / functions / routes that are responsible.
- Whether this is an indexing, search, planner, or fallback bug.
- The smallest recommended backend fix.
- Any data/backfill repair that should run before code changes.
- Whether the frontend should show a no-op/clarification state instead of a booting/rebuild state when the backend returns a zero-hit fallback.

Constraints:
- Do not propose frontend-only fixes unless the backend is already correct.
- Do not guess. If evidence is missing, say exactly what data or log entry is needed.
- Prefer concrete line-level findings and minimal corrective changes.
- If the issue is in logging/observability, specify the exact payload fields that should be added.
