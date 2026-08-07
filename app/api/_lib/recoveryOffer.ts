const RECOVERY_OFFER_MIN_INACTIVE_MS = 30 * 60 * 1000;

function toEpochMs(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === "string") {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === "object") {
        const maybeAny = value as any;
        if (typeof maybeAny.toMillis === "function") {
            const ms = maybeAny.toMillis();
            return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
        }
        if (typeof maybeAny.seconds === "number") {
            const ms = maybeAny.seconds * 1000 + (typeof maybeAny.nanoseconds === "number" ? Math.floor(maybeAny.nanoseconds / 1_000_000) : 0);
            return Number.isFinite(ms) ? ms : null;
        }
        if (typeof maybeAny._seconds === "number") {
            const ms = maybeAny._seconds * 1000 + (typeof maybeAny._nanoseconds === "number" ? Math.floor(maybeAny._nanoseconds / 1_000_000) : 0);
            return Number.isFinite(ms) ? ms : null;
        }
    }
    return null;
}

export function getUserLastAppActivityMs(userData: Record<string, any> | null | undefined): number | null {
    if (!userData || typeof userData !== "object") return null;

    const candidates = [
        userData.lastAppActivityAt,
        userData.lastActivityAt,
        userData.appActivityAt,
        userData.updatedAt,
        userData.createdAt,
    ];

    for (const value of candidates) {
        const ms = toEpochMs(value);
        if (ms !== null) return ms;
    }

    return null;
}

export function canSendRecoveryOfferEmail(
    userData: Record<string, any> | null | undefined,
    nowMs: number = Date.now(),
): { ok: boolean; reason?: "unsubscribed" | "active_recently"; lastActivityMs: number | null } {
    const prefs = (userData?.notificationPrefs || {}) as any;
    if (prefs?.journeyEmails === false) {
        return { ok: false, reason: "unsubscribed", lastActivityMs: getUserLastAppActivityMs(userData) };
    }

    const lastActivityMs = getUserLastAppActivityMs(userData);
    if (lastActivityMs !== null && nowMs - lastActivityMs < RECOVERY_OFFER_MIN_INACTIVE_MS) {
        return { ok: false, reason: "active_recently", lastActivityMs };
    }

    return { ok: true, lastActivityMs };
}
