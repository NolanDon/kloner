"use client";

import mixpanel from "mixpanel-browser";

type MixpanelProps = Record<string, unknown>;

let forcedOptOut = false;
const DEFAULT_CONTEXT = "default";
const MIXPANEL_WARN_THROTTLE_MS = 30_000;

type MixpanelContextName = string;
type InitState = "never" | "initialized" | "failed";

type MixpanelLike = {
    init?: (...args: any[]) => unknown;
    track?: (eventName: string, props?: MixpanelProps) => void;
    identify?: (distinctId: string) => void;
    register?: (props: Record<string, unknown>) => void;
    get_distinct_id?: () => string;
    reset?: () => void;
    people?: { set?: (props: MixpanelProps) => void };
    start_session_recording?: () => void;
    stop_session_recording?: () => void;
    get_session_recording_properties?: () => Record<string, unknown>;
    get_session_replay_url?: () => string | null;
    __loaded?: boolean;
};

const initStates = new Map<MixpanelContextName, InitState>();
const initInFlight = new Set<MixpanelContextName>();
const lastWarnAt = new Map<string, number>();

export const PREVIEW_LOADER_MIXPANEL_INSTANCE = "preview_loader";

function getToken(): string | undefined {
    const token = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
    return typeof token === "string" && token.trim().length > 0 ? token.trim() : undefined;
}

function isDisabled(): boolean {
    if (process.env.NEXT_PUBLIC_MIXPANEL_DISABLED === "1") return true;

    // Never run Mixpanel on local dev servers.
    // (Avoids polluting analytics and recording local session replays.)
    try {
        const host = typeof window !== "undefined" ? window.location.hostname : "";
        if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    } catch {
        // ignore
    }

    return false;
}

function getBlockedUids(): string[] {
    const raw = process.env.NEXT_PUBLIC_MIXPANEL_BLOCK_UIDS;
    if (typeof raw !== "string") return [];
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

export function applyMixpanelPrivacyForUid(uid?: string | null): boolean {
    const blockedUids = getBlockedUids();
    const isBlocked = !!uid && blockedUids.includes(uid);

    if (isBlocked) {
        forcedOptOut = true;
        try {
            (mixpanel as any).stop_session_recording?.();
        } catch {
            // ignore
        }
        try {
            (mixpanel as any).opt_out_tracking?.({ clear_persistence: true });
        } catch {
            try {
                (mixpanel as any).opt_out_tracking?.();
            } catch {
                // ignore
            }
        }
        try {
            mixpanel.reset();
        } catch {
            // ignore
        }
        return true;
    }

    // If we previously forced opt-out for a blocked uid, allow tracking again for other users.
    if (forcedOptOut) {
        forcedOptOut = false;
        try {
            (mixpanel as any).opt_in_tracking?.();
        } catch {
            // ignore
        }
    }

    return false;
}

function getRecordSessionsPercent(): number {
    const raw = process.env.NEXT_PUBLIC_MIXPANEL_RECORD_SESSIONS_PERCENT;
    const n = typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
}

function getRecordHeatmapData(): boolean {
    return process.env.NEXT_PUBLIC_MIXPANEL_RECORD_HEATMAP_DATA === "1";
}

function throttleWarn(key: string, message: string, err?: unknown) {
    try {
        const now = Date.now();
        const last = lastWarnAt.get(key) || 0;
        if (now - last < MIXPANEL_WARN_THROTTLE_MS) return;
        lastWarnAt.set(key, now);
        if (err) {
            console.warn(message, err);
        } else {
            console.warn(message);
        }
    } catch {
        // ignore console issues
    }
}

function getContextName(contextName?: string): MixpanelContextName {
    return contextName && contextName.trim() ? contextName.trim() : DEFAULT_CONTEXT;
}

function getHostMixpanel(): any | null {
    try {
        if (typeof window === "undefined") return null;
        return (window as any).mixpanel || null;
    } catch {
        return null;
    }
}

function resolveContextInstance(contextName?: string): MixpanelLike | null {
    const ctx = getContextName(contextName);
    if (ctx === DEFAULT_CONTEXT) return mixpanel as any;

    const hostMixpanel = getHostMixpanel();
    const named = hostMixpanel?.[ctx];
    if (!named || typeof named !== "object") return null;
    return named as MixpanelLike;
}

function isInstanceReady(instance: MixpanelLike | null): boolean {
    if (!instance || typeof instance.track !== "function") return false;
    if (instance.__loaded === false) return false;
    return true;
}

function buildInitOptions() {
    const recordSessionsPercent = getRecordSessionsPercent();
    return {
        debug: process.env.NODE_ENV !== "production",
        persistence: "localStorage" as const,
        ignore_dnt: false,
        track_pageview: false,
        // Session Replay (rrweb) is disabled unless explicitly enabled.
        // Set NEXT_PUBLIC_MIXPANEL_RECORD_SESSIONS_PERCENT to a value 1-100.
        record_sessions_percent: recordSessionsPercent,
        record_heatmap_data: recordSessionsPercent > 0 ? getRecordHeatmapData() : false,
        // Uncensor Session Replay recordings (shows text + inputs).
        // Note: rrweb/Mixpanel will still avoid recording password fields.
        record_mask_all_text: false,
        record_mask_all_inputs: false,
    };
}

function ensureMixpanelInit(contextName?: string): MixpanelLike | null {
    if (forcedOptOut) return null;
    if (isDisabled()) return null;

    const token = getToken();
    if (!token) return null;

    const ctx = getContextName(contextName);
    const existing = resolveContextInstance(ctx);
    if (isInstanceReady(existing)) {
        initStates.set(ctx, "initialized");
        return existing;
    }

    if (initInFlight.has(ctx)) {
        return isInstanceReady(existing) ? existing : null;
    }

    const state = initStates.get(ctx);
    if (state === "initialized") {
        return isInstanceReady(existing) ? existing : null;
    }

    initInFlight.add(ctx);
    try {
        const options = buildInitOptions();
        if (ctx === DEFAULT_CONTEXT) {
            (mixpanel as any).init?.(token, options);
        } else {
            // Preview/iframe contexts should use a named instance to avoid clobbering the main app instance.
            (mixpanel as any).init?.(token, options, ctx);
        }

        const initialized = resolveContextInstance(ctx);
        if (!isInstanceReady(initialized)) {
            initStates.set(ctx, "failed");
            throttleWarn(
                `mixpanel-init-not-ready:${ctx}`,
                `[mixpanel] ${ctx} instance unavailable after init; analytics calls will no-op.`,
            );
            return null;
        }

        initStates.set(ctx, "initialized");
        return initialized;
    } catch (err) {
        initStates.set(ctx, "failed");
        throttleWarn(
            `mixpanel-init-failed:${ctx}`,
            `[mixpanel] Failed to initialize ${ctx} instance; analytics calls will no-op.`,
            err,
        );
        return null;
    } finally {
        initInFlight.delete(ctx);
    }
}

export function initMixpanel(contextName?: string) {
    void ensureMixpanelInit(contextName);
}

export function getMixpanelInstance(contextName?: string): MixpanelLike | null {
    const ctx = getContextName(contextName);
    const initialized = ensureMixpanelInit(ctx);
    if (isInstanceReady(initialized)) return initialized;
    if (initStates.get(ctx) !== "initialized") return null;

    const resolved = resolveContextInstance(ctx);
    return isInstanceReady(resolved) ? resolved : null;
}

export function trackMixpanel(eventName: string, props?: MixpanelProps, contextName?: string) {
    const instance = getMixpanelInstance(contextName);
    if (!instance?.track) return;
    try {
        instance.track(eventName, props);
    } catch (err) {
        throttleWarn(
            `mixpanel-track-failed:${getContextName(contextName)}`,
            "[mixpanel] track() failed; dropping event.",
            err,
        );
    }
}

export function identifyMixpanel(distinctId: string, profileProps?: MixpanelProps, contextName?: string) {
    const instance = getMixpanelInstance(contextName);
    if (!instance) return;

    try {
        instance.identify?.(distinctId);
        instance.register?.({ uid: distinctId });
        if (profileProps && Object.keys(profileProps).length > 0) {
            instance.people?.set?.(profileProps);
        }
    } catch (err) {
        throttleWarn(
            `mixpanel-identify-failed:${getContextName(contextName)}`,
            "[mixpanel] identify() failed.",
            err,
        );
    }
}

export function resetMixpanel(contextName?: string) {
    const instance = getMixpanelInstance(contextName);
    if (!instance?.reset) return;
    try {
        instance.reset();
    } catch (err) {
        throttleWarn(
            `mixpanel-reset-failed:${getContextName(contextName)}`,
            "[mixpanel] reset() failed.",
            err,
        );
    }
}

// Session Replay helpers
export function startMixpanelSessionRecording(contextName?: string) {
    const instance = getMixpanelInstance(contextName);
    if (!instance?.start_session_recording) return;
    try {
        instance.start_session_recording?.();
    } catch (err) {
        throttleWarn(
            `mixpanel-replay-start-failed:${getContextName(contextName)}`,
            "[mixpanel] start_session_recording() failed.",
            err,
        );
    }
}

export function stopMixpanelSessionRecording(contextName?: string) {
    const instance = getMixpanelInstance(contextName);
    if (!instance?.stop_session_recording) return;
    try {
        instance.stop_session_recording?.();
    } catch (err) {
        throttleWarn(
            `mixpanel-replay-stop-failed:${getContextName(contextName)}`,
            "[mixpanel] stop_session_recording() failed.",
            err,
        );
    }
}

export function getMixpanelSessionRecordingProperties(contextName?: string): Record<string, unknown> {
    const instance = getMixpanelInstance(contextName);
    if (!instance?.get_session_recording_properties) return {};
    try {
        const props = instance.get_session_recording_properties?.();
        return props && typeof props === "object" ? props : {};
    } catch {
        return {};
    }
}

export function getMixpanelSessionReplayUrl(contextName?: string): string | null {
    const instance = getMixpanelInstance(contextName);
    if (!instance?.get_session_replay_url) return null;
    try {
        const url = instance.get_session_replay_url?.();
        return typeof url === "string" && url.trim() ? url.trim() : null;
    } catch {
        return null;
    }
}
