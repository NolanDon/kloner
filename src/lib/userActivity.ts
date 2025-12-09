// src/lib/userActivity.ts
"use client";

import {
    doc,
    setDoc,
    serverTimestamp,
    increment,
} from "firebase/firestore";
import { db } from "@/src/lib/firebase"; // adjust if your firebase path differs

export type UserActivityEvent =
    | "login"
    | "edit"
    | "preview_open"
    | "seen"
    | "custom";

export type LoginMethod =
    | "password"
    | "google"
    | "github"
    | "magic_link"
    | "anonymous"
    | "other";

type BaseActivityPayload = {
    // optional place to dump extra data you care about
    meta?: Record<string, unknown>;
};

type LoginPayload = BaseActivityPayload & {
    method?: LoginMethod;
};

type EditPayload = BaseActivityPayload & {
    renderId?: string;
    pageId?: string;
};

type PreviewOpenPayload = BaseActivityPayload & {
    renderId?: string;
};

type CustomPayload = BaseActivityPayload & {
    key: string;
};

/**
 * Internal helper: summary doc ref for a user.
 * Path: kloner_users/{uid}/meta/activity_summary
 */
function activitySummaryRef(uid: string) {
    return doc(db, "kloner_users", uid, "meta", "activity_summary");
}

/**
 * Lightweight "heart-beat" / last seen.
 * Call this from a global place (e.g. layout effect) when the app mounts with a logged-in user.
 */
export async function trackUserSeen(uid: string) {
    if (!uid) return;
    const ref = activitySummaryRef(uid);

    await setDoc(
        ref,
        {
            lastSeenAt: serverTimestamp(),
        },
        { merge: true }
    );
}

/**
 * Track a login event.
 * Call this right after you detect a successful login.
 */
export async function trackUserLogin(uid: string, payload: LoginPayload = {}) {
    if (!uid) return;
    const ref = activitySummaryRef(uid);

    const updates: Record<string, unknown> = {
        lastSeenAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
        loginCount: increment(1),
    };

    if (payload.method) {
        updates.lastLoginMethod = payload.method;
    }
    if (payload.meta) {
        updates.loginMeta = payload.meta;
    }

    await setDoc(ref, updates, { merge: true });
}

/**
 * Track an edit event (e.g. when user commits/saves an edit in PreviewEditor).
 */
export async function trackUserEdit(uid: string, payload: EditPayload = {}) {
    if (!uid) return;
    const ref = activitySummaryRef(uid);

    const updates: Record<string, unknown> = {
        lastSeenAt: serverTimestamp(),
        lastEditAt: serverTimestamp(),
        totalEdits: increment(1),
    };

    if (payload.renderId) {
        updates.lastEditRenderId = payload.renderId;
    }
    if (payload.pageId) {
        updates.lastEditPageId = payload.pageId;
    }
    if (payload.meta) {
        updates.lastEditMeta = payload.meta;
    }

    await setDoc(ref, updates, { merge: true });
}

/**
 * Track when the user opens an editor / preview.
 */
export async function trackPreviewOpen(
    uid: string,
    payload: PreviewOpenPayload = {}
) {
    if (!uid) return;
    const ref = activitySummaryRef(uid);

    const updates: Record<string, unknown> = {
        lastSeenAt: serverTimestamp(),
        lastPreviewOpenAt: serverTimestamp(),
        previewOpens: increment(1),
    };

    if (payload.renderId) {
        updates.lastPreviewRenderId = payload.renderId;
    }
    if (payload.meta) {
        updates.lastPreviewMeta = payload.meta;
    }

    await setDoc(ref, updates, { merge: true });
}

/**
 * Generic metric/counter you can reuse for anything:
 * e.g. "ai_edit_used", "deployed_to_vercel", "snapshot_taken", etc.
 *
 * Usage:
 *   await trackCustomMetric(uid, { key: "ai_edit_used" });
 */
export async function trackCustomMetric(
    uid: string,
    payload: CustomPayload
) {
    if (!uid || !payload?.key) return;
    const ref = activitySummaryRef(uid);

    const fieldBase = `custom.${payload.key}`;

    const updates: Record<string, unknown> = {
        lastSeenAt: serverTimestamp(),
        [`${fieldBase}.count`]: increment(1),
        [`${fieldBase}.lastAt`]: serverTimestamp(),
    };

    if (payload.meta) {
        updates[`${fieldBase}.meta`] = payload.meta;
    }

    await setDoc(ref, updates, { merge: true });
}

/**
 * Thin generic entry point if you prefer a single function.
 * You can call this directly if you like event-style APIs.
 */
export async function trackUserActivity(
    uid: string,
    event: UserActivityEvent,
    payload: BaseActivityPayload | LoginPayload | EditPayload | PreviewOpenPayload | CustomPayload = {}
) {
    switch (event) {
        case "login":
            return trackUserLogin(uid, payload as LoginPayload);
        case "edit":
            return trackUserEdit(uid, payload as EditPayload);
        case "preview_open":
            return trackPreviewOpen(uid, payload as PreviewOpenPayload);
        case "seen":
            return trackUserSeen(uid);
        case "custom":
            return trackCustomMetric(uid, payload as CustomPayload);
        default:
            return;
    }
}
