---
description: "Backend agent prompt to audit edit-plan apply contract mismatches and false negatives"
agent: "agent"
---

You are the backend agent for Kloner.

Goal:
- Audit why the frontend can emit `EDIT_PLAN_APPLY_FAILURE_LEGACY_SHAPE_MISMATCH` even when the edit-plan job completed, files were written, and the preview visibly updated.
- Determine whether the backend is completing jobs before `result.apply` is fully assembled, serializing the wrong result shape, or trimming fields during normalization.
- Identify the exact backend control point that should be changed so completed edit-plan jobs reliably expose the canonical apply contract.

Observed symptom:
- The frontend treats a completed job with meaningful write evidence but no `job.result.apply` as a contract failure.
- In the current code path, the UI syncs files from the server first, then emits a failure only because `result.apply` is missing.
- That means the backend may have actually applied the changes while still returning a shape the frontend interprets as legacy or incomplete.

Backend contract to verify:
- The canonical completed-job payload should include `job.result.apply` for edit-plan jobs that wrote files.
- The frontend expects `result.apply` to carry authoritative apply outcome fields such as write proof, restart state, retry state, and user-facing messaging.

What to inspect:
1. Find the worker, route, or service that marks edit-plan jobs `completed`.
2. Verify exactly when `result.apply` is created relative to the status transition to `completed`.
3. Check whether any serializer, normalizer, or persistence layer removes `result.apply` after it is produced.
4. Check whether the backend writes a different canonical field instead of `result.apply`, such as a flat `result` payload, `proposal`, `applyResult`, or another nested wrapper.
5. Check whether the completed status can be emitted before the apply payload is fully persisted, creating a race where the poller sees `completed` first and `result.apply` later or never.
6. Check whether the job status API returns a sanitized or partial view of the job record that drops apply information.
7. Check whether restart-related fields such as `restartPending`, `restartConfirmed`, `saved`, `outcome`, `retryable`, or `applyRetryState` are being returned in a shape that the frontend does not recognize.

Files and routes that are likely relevant:
- `app/api/previews/apply/route.ts`
- The worker or job store backing the edit-plan status endpoint
- The route that serves `GET /api/v1/app-embeddings/jobs/:jobId`
- Any normalization helpers that reshape job status or apply results before they reach the client
- `src/lib/appEmbeddingsClient.ts`
- `src/lib/editPlanApplyContract.ts`

Specific questions to answer:
1. Is `completed` ever written before `result.apply` exists?
2. Does the backend persist a completed job with `result` present but `result.apply` missing?
3. Is the apply payload stored under a different key than the frontend expects?
4. Is any field pruning or response shaping removing `result.apply` from the status endpoint?
5. Does a successful write with restart pending get serialized as a terminal completed job without the nested apply contract?
6. Is there a race between file write completion, restart orchestration, and final job serialization?
7. If the backend already has enough evidence to confirm a successful write, should it emit a populated `result.apply` even when restart confirmation is still pending?

What to return:
- The exact root cause, if one is found.
- The file(s), function(s), or route(s) responsible.
- Whether the bug is in job finalization, persistence, serialization, or API normalization.
- The smallest backend fix to make the contract stable.
- Any data repair or replay needed for jobs already written with the wrong shape.
- If the payload shape is intentionally different, the exact frontend-facing canonical contract that should be documented instead.

Constraints:
- Do not propose frontend-only fixes unless the backend contract is proven correct.
- Do not guess. If evidence is missing, say exactly which job record, log line, or status payload is needed.
- Prefer concrete line-level findings and minimal corrective changes.
- Focus on preventing false negatives: a job that truly wrote files should not be reported as a contract failure just because `result.apply` was omitted or delayed.