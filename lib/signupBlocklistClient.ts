"use client";

export async function checkSignupBlocklist(email?: string | null): Promise<{ blocked: boolean; reason: string | null }> {
    try {
        const res = await fetch("/api/private/signup-blocklist", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({ email: email || null }),
            credentials: "include",
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            return { blocked: false, reason: null };
        }

        return {
            blocked: !!data?.blocked,
            reason: typeof data?.reason === "string" && data.reason.trim() ? data.reason.trim() : null,
        };
    } catch {
        return { blocked: false, reason: null };
    }
}
