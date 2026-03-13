"use client";

import mixpanel from "mixpanel-browser";

type MixpanelProps = Record<string, unknown>;

let hasInitAttempted = false;
let forcedOptOut = false;

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

export function initMixpanel() {
    if (hasInitAttempted) return;
    hasInitAttempted = true;

    if (forcedOptOut) return;
    if (isDisabled()) return;
    const token = getToken();
    if (!token) return;

    const recordSessionsPercent = getRecordSessionsPercent();

    mixpanel.init(token, {
        debug: process.env.NODE_ENV !== "production",
        persistence: "localStorage",
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
    });
}

export function trackMixpanel(eventName: string, props?: MixpanelProps) {
    if (forcedOptOut) return;
    if (isDisabled()) return;
    if (!getToken()) return;
    initMixpanel();
    mixpanel.track(eventName, props);
}

export function identifyMixpanel(distinctId: string, profileProps?: MixpanelProps) {
    if (forcedOptOut) return;
    if (isDisabled()) return;
    if (!getToken()) return;
    initMixpanel();
    mixpanel.identify(distinctId);
    mixpanel.register({ uid: distinctId });
    if (profileProps && Object.keys(profileProps).length > 0) {
        mixpanel.people.set(profileProps);
    }
}

export function resetMixpanel() {
    if (forcedOptOut) return;
    if (isDisabled()) return;
    if (!getToken()) return;
    initMixpanel();
    mixpanel.reset();
}

// Session Replay helpers
export function startMixpanelSessionRecording() {
    if (forcedOptOut) return;
    if (isDisabled()) return;
    if (!getToken()) return;
    initMixpanel();
    (mixpanel as any).start_session_recording?.();
}

export function stopMixpanelSessionRecording() {
    if (forcedOptOut) return;
    if (isDisabled()) return;
    if (!getToken()) return;
    initMixpanel();
    (mixpanel as any).stop_session_recording?.();
}

export function getMixpanelSessionRecordingProperties(): Record<string, unknown> {
    if (forcedOptOut) return {};
    if (isDisabled()) return {};
    if (!getToken()) return {};
    initMixpanel();
    try {
        const props = (mixpanel as any).get_session_recording_properties?.();
        return props && typeof props === "object" ? props : {};
    } catch {
        return {};
    }
}

export function getMixpanelSessionReplayUrl(): string | null {
    if (forcedOptOut) return null;
    if (isDisabled()) return null;
    if (!getToken()) return null;
    initMixpanel();
    try {
        const url = (mixpanel as any).get_session_replay_url?.();
        return typeof url === "string" && url.trim() ? url.trim() : null;
    } catch {
        return null;
    }
}
