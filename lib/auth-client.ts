"use client";

import { getIdToken } from "firebase/auth";
import { auth } from "@/lib/firebase";

type SessionBootstrapOptions = {
    forceRefresh?: boolean;
    minIntervalMs?: number;
    timeoutMs?: number;
    reason?: string;
};

type GlobalAuthClientState = {
    session: {
        inflight: Promise<boolean> | null;
        lastOkAtMs: number;
        lastUid: string | null;
    };
    csrf: {
        inflight: Promise<string | null> | null;
        token: string | null;
        expiryMs: number;
    };
};

function getState(): GlobalAuthClientState {
    const g = globalThis as any;
    if (!g.__klonerAuthClientState) {
        g.__klonerAuthClientState = {
            session: {
                inflight: null,
                lastOkAtMs: 0,
                lastUid: null,
            },
            csrf: {
                inflight: null,
                token: null,
                expiryMs: 0,
            },
        } satisfies GlobalAuthClientState;
    }
    return g.__klonerAuthClientState as GlobalAuthClientState;
}

async function fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMs: number,
): Promise<Response> {
    const controller = new AbortController();
    const t = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } finally {
        globalThis.clearTimeout(t);
    }
}

export async function bootstrapServerSession(
    opts: SessionBootstrapOptions = {},
): Promise<boolean> {
    const {
        forceRefresh = false,
        minIntervalMs = 10 * 60 * 1000,
        timeoutMs = 12_000,
    } = opts;

    const state = getState();

    const u = auth?.currentUser ?? null;
    if (!u) return false;

    // If user changed, always re-bootstrap once.
    const uidChanged = state.session.lastUid && state.session.lastUid !== u.uid;
    if (uidChanged) {
        state.session.lastOkAtMs = 0;
    }

    const now = Date.now();
    if (!forceRefresh && !uidChanged) {
        if (state.session.lastOkAtMs && now - state.session.lastOkAtMs < minIntervalMs) {
            return true;
        }
    }

    if (state.session.inflight) return state.session.inflight;

    state.session.inflight = (async () => {
        try {
            const idToken = await getIdToken(u, forceRefresh);

            const res = await fetchWithTimeout(
                "/api/auth/session",
                {
                    method: "POST",
                    credentials: "include",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ idToken }),
                    cache: "no-store",
                },
                timeoutMs,
            );

            if (!res.ok) {
                return false;
            }

            state.session.lastOkAtMs = Date.now();
            state.session.lastUid = u.uid;
            return true;
        } catch {
            return false;
        } finally {
            state.session.inflight = null;
        }
    })();

    return state.session.inflight;
}

async function fetchCsrfWithStatus(): Promise<{ token: string | null; status: number | null }> {
    try {
        const res = await fetch("/api/auth/csrf", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            cache: "no-store",
        });
        if (!res.ok) return { token: null, status: res.status };
        const data = await res.json().catch(() => null);
        return { token: (data && (data as any).csrf) || null, status: res.status };
    } catch {
        return { token: null, status: null };
    }
}

export async function ensureSessionAndCsrf(): Promise<string | null> {
    const state = getState();
    const now = Date.now();

    // Cache CSRF for 30 minutes to reduce chatter.
    if (state.csrf.token && state.csrf.expiryMs > now) {
        return state.csrf.token;
    }

    if (state.csrf.inflight) return state.csrf.inflight;

    state.csrf.inflight = (async () => {
        try {
            let r = await fetchCsrfWithStatus();
            if (r.token) return r.token;

            // If unauthorized, we likely don't have the server session cookie yet.
            if (r.status === 401 && auth?.currentUser) {
                const ok = await bootstrapServerSession({
                    forceRefresh: false,
                    minIntervalMs: 10 * 60_000,
                    timeoutMs: 12_000,
                    reason: "csrf_401",
                });

                if (ok) {
                    r = await fetchCsrfWithStatus();
                    if (r.token) return r.token;
                }
            }

            return null;
        } finally {
            // Clear inflight *after* updating cache.
        }
    })();

    const token = await state.csrf.inflight;
    state.csrf.inflight = null;

    if (token) {
        state.csrf.token = token;
        state.csrf.expiryMs = Date.now() + 30 * 60 * 1000;
    }

    return token;
}

export function resetAuthClientCaches(): void {
    const state = getState();
    state.session.inflight = null;
    state.session.lastOkAtMs = 0;
    state.session.lastUid = null;
    state.csrf.inflight = null;
    state.csrf.token = null;
    state.csrf.expiryMs = 0;
}
