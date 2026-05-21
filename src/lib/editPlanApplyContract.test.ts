import { resolveApplyState, hasWriteProof, buildApplyStateMessage, resolveCompletedApplyStateWithWriteFallback, type ApplyState } from "./editPlanApplyContract";

// ---------------------------------------------------------------------------
// hasWriteProof
// ---------------------------------------------------------------------------

describe("hasWriteProof", () => {
    it("returns true when saved=true", () => {
        expect(hasWriteProof({ saved: true })).toBe(true);
    });

    it("returns true when machine.wrote > 0", () => {
        expect(hasWriteProof({ machine: { wrote: 3, deleted: 0, replayed: false } })).toBe(true);
    });

    it("returns true when machine.deleted > 0", () => {
        expect(hasWriteProof({ machine: { wrote: 0, deleted: 1, replayed: false } })).toBe(true);
    });

    it("returns true when legacy flat wrote > 0", () => {
        expect(hasWriteProof({ wrote: 2, deleted: 0 })).toBe(true);
    });

    it("returns true when patchedFileCount > 0", () => {
        expect(hasWriteProof({ patchedFileCount: 5 })).toBe(true);
    });

    it("returns true when idempotentProof is present", () => {
        expect(hasWriteProof({ idempotentProof: "abc123" })).toBe(true);
    });

    it("returns false when no proof fields are set", () => {
        expect(hasWriteProof({ ok: false, saved: null })).toBe(false);
    });

    it("returns false when machine.wrote and machine.deleted are 0", () => {
        expect(hasWriteProof({ machine: { wrote: 0, deleted: 0, replayed: false } })).toBe(false);
    });

    it("returns false for empty object", () => {
        expect(hasWriteProof({})).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// resolveApplyState — confirmed_success
// ---------------------------------------------------------------------------

describe("resolveApplyState – confirmed_success", () => {
    it("returns confirmed_success when saved=true and no restart signals", () => {
        expect(resolveApplyState({ ok: true, saved: true })).toBe("confirmed_success");
    });

    it("returns confirmed_success when machine.wrote > 0 and no restart", () => {
        expect(resolveApplyState({
            ok: true,
            saved: null,
            machine: { wrote: 2, deleted: 0, replayed: false },
        })).toBe("confirmed_success");
    });

    it("returns confirmed_success when patchedFileCount > 0 and restartPending=false", () => {
        expect(resolveApplyState({
            ok: true,
            patchedFileCount: 3,
            restartPending: false,
            restartConfirmed: false,
        })).toBe("confirmed_success");
    });

    it("returns confirmed_success when idempotentProof present and no restart pending", () => {
        expect(resolveApplyState({
            ok: true,
            idempotentProof: "proof-xyz",
            restartPending: false,
            restartConfirmed: false,
        })).toBe("confirmed_success");
    });
});

// ---------------------------------------------------------------------------
// resolveApplyState — restart_pending
// ---------------------------------------------------------------------------

describe("resolveApplyState – restart_pending", () => {
    it("returns restart_pending when write proof + restartPending=true and restartConfirmed=false", () => {
        expect(resolveApplyState({
            ok: true,
            saved: true,
            restartPending: true,
            restartConfirmed: false,
        })).toBe("restart_pending");
    });

    it("returns restart_pending when machine.wrote > 0 + restartPending=true", () => {
        expect(resolveApplyState({
            ok: true,
            machine: { wrote: 1, deleted: 0, replayed: false },
            restartPending: true,
            restartConfirmed: false,
        })).toBe("restart_pending");
    });

    it("returns restart_pending when patchedFileCount > 0 + restartPending=true", () => {
        expect(resolveApplyState({
            ok: true,
            patchedFileCount: 2,
            restartPending: true,
            restartConfirmed: false,
        })).toBe("restart_pending");
    });
});

// ---------------------------------------------------------------------------
// resolveApplyState — restart_confirmed
// ---------------------------------------------------------------------------

describe("resolveApplyState – restart_confirmed", () => {
    it("returns restart_confirmed when write proof + restartConfirmed=true", () => {
        expect(resolveApplyState({
            ok: true,
            saved: true,
            restartPending: false,
            restartConfirmed: true,
        })).toBe("restart_confirmed");
    });

    it("returns restart_confirmed when restartPending and restartConfirmed are both true (confirmed takes priority)", () => {
        expect(resolveApplyState({
            ok: true,
            patchedFileCount: 1,
            restartPending: true,
            restartConfirmed: true,
        })).toBe("restart_confirmed");
    });
});

// ---------------------------------------------------------------------------
// resolveApplyState — uncertain
// ---------------------------------------------------------------------------

describe("resolveApplyState – uncertain", () => {
    it("returns uncertain when saved=null and no write proof", () => {
        expect(resolveApplyState({ ok: true, saved: null })).toBe("uncertain");
    });

    it("returns uncertain when saved is undefined", () => {
        expect(resolveApplyState({ ok: true })).toBe("uncertain");
    });

    it("returns uncertain when code=APPLY_STATE_UNCERTAIN", () => {
        expect(resolveApplyState({ ok: true, saved: null, code: "APPLY_STATE_UNCERTAIN" })).toBe("uncertain");
    });

    it("returns uncertain when uncertain=true flag is set", () => {
        expect(resolveApplyState({ ok: true, saved: null, uncertain: true })).toBe("uncertain");
    });

    it("returns uncertain when outcome=apply_uncertain", () => {
        expect(resolveApplyState({ ok: true, saved: null, outcome: "apply_uncertain" })).toBe("uncertain");
    });

    it("returns uncertain when outcome=saved_source_machine_uncertain", () => {
        expect(resolveApplyState({ ok: true, saved: null, outcome: "saved_source_machine_uncertain" })).toBe("uncertain");
    });

    it("returns uncertain for null input", () => {
        expect(resolveApplyState(null)).toBe("uncertain");
    });

    it("returns uncertain for empty object", () => {
        expect(resolveApplyState({})).toBe("uncertain");
    });
});

// ---------------------------------------------------------------------------
// resolveApplyState — failed
// ---------------------------------------------------------------------------

describe("resolveApplyState – failed", () => {
    it("returns failed when ok=false and no write proof", () => {
        expect(resolveApplyState({ ok: false, saved: false })).toBe("failed");
    });

    it("returns failed when ok=false and saved=null", () => {
        expect(resolveApplyState({ ok: false, saved: null })).toBe("failed");
    });

    it("does NOT return failed when ok=false but machine.wrote > 0 (write proof exists)", () => {
        // write proof overrides ok=false for failure classification
        const state = resolveApplyState({
            ok: false,
            saved: null,
            machine: { wrote: 1, deleted: 0, replayed: false },
        });
        expect(state).not.toBe("failed");
    });
});

// ---------------------------------------------------------------------------
// buildApplyStateMessage
// ---------------------------------------------------------------------------

describe("buildApplyStateMessage", () => {
    it("returns backend userMessage when present for confirmed_success", () => {
        const msg = buildApplyStateMessage("confirmed_success", { userMessage: "Done!" });
        expect(msg).toBe("Done!");
    });

    it("returns default confirmed_success message when no userMessage", () => {
        const msg = buildApplyStateMessage("confirmed_success", {});
        expect(msg).toContain("applied successfully");
    });

    it("returns restart_pending default message", () => {
        const msg = buildApplyStateMessage("restart_pending", {});
        expect(msg).toContain("restart is still in progress");
    });

    it("returns restart_confirmed default message", () => {
        const msg = buildApplyStateMessage("restart_confirmed", {});
        expect(msg).toContain("restarted");
    });

    it("returns uncertain message with recommendation when present", () => {
        const msg = buildApplyStateMessage("uncertain", { recommendedAction: "rebuild_preview" });
        expect(msg).toContain("rebuild_preview");
    });

    it("returns failed message with reason and code", () => {
        const msg = buildApplyStateMessage("failed", { reason: "Disk full", code: "MACHINE_WRITE_ERROR" });
        expect(msg).toContain("Disk full");
        expect(msg).toContain("MACHINE_WRITE_ERROR");
    });
});

// ---------------------------------------------------------------------------
// resolveCompletedApplyStateWithWriteFallback
// ---------------------------------------------------------------------------

describe("resolveCompletedApplyStateWithWriteFallback", () => {
    it("keeps confirmed_success when backend apply is missing but the job clearly wrote files", () => {
        expect(resolveCompletedApplyStateWithWriteFallback(null, true)).toBe("confirmed_success");
    });

    it("upgrades a failed legacy apply payload to confirmed_success when completed write proof exists", () => {
        expect(resolveCompletedApplyStateWithWriteFallback({ ok: false, saved: null }, true)).toBe("confirmed_success");
    });

    it("does not override a successful backend apply result", () => {
        expect(resolveCompletedApplyStateWithWriteFallback({ ok: true, saved: true }, true)).toBe("confirmed_success");
    });

    it("preserves failed when there is no completed write proof", () => {
        expect(resolveCompletedApplyStateWithWriteFallback({ ok: false, saved: false }, false)).toBe("failed");
    });
});
