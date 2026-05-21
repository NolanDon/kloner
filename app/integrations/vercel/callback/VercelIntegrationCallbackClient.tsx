// app/integrations/vercel/callback/VercelIntegrationCallbackClient.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

const ACCENT = "#f55f2a";

function getCookieValue(name: string): string | null {
    if (typeof document === "undefined") return null;
    const parts = document.cookie.split(";");
    for (const part of parts) {
        const [k, ...rest] = part.trim().split("=");
        if (k === name) {
            return rest.join("=") || "";
        }
    }
    return null;
}

function safeReturnPath(raw: string | null): string | null {
    if (!raw) return null;
    let decoded = raw;
    try {
        decoded = decodeURIComponent(raw);
    } catch {
        decoded = raw;
    }

    const path = decoded.trim();
    if (!path) return null;
    // Only allow same-origin relative paths.
    if (!path.startsWith("/")) return null;
    if (path.startsWith("//")) return null;
    if (path.includes("://")) return null;
    return path;
}

function inferReturnPathFromLocalStorage(): string | null {
    if (typeof window === "undefined") return null;
    try {
        // Prefer more specific flows first.
        const pendingAppShare = window.localStorage.getItem("kloner_vercel_pending_app_share");
        if (pendingAppShare) {
            try {
                const parsed = JSON.parse(pendingAppShare) as any;
                const appId = typeof parsed?.appId === "string" ? parsed.appId.trim() : "";
                const returnTo = typeof parsed?.returnTo === "string" ? parsed.returnTo.trim() : "";

                const startedAt = Number(parsed?.startedAt || 0);
                const MAX_AGE_MS = 15 * 60 * 1000;
                if (startedAt && Number.isFinite(startedAt) && Date.now() - startedAt > MAX_AGE_MS) {
                    try {
                        window.localStorage.removeItem("kloner_vercel_pending_app_share");
                    } catch {
                        // ignore
                    }
                    return null;
                }

                if (appId && returnTo) return returnTo;
                if (returnTo) return returnTo;
                return "/dashboard/view";
            } catch {
                return "/dashboard/view";
            }
        }

        const pendingAppDeploy = window.localStorage.getItem("kloner_vercel_pending_app_deploy");
        if (pendingAppDeploy) {
            try {
                const parsed = JSON.parse(pendingAppDeploy) as any;
                const appId = typeof parsed?.appId === "string" ? parsed.appId.trim() : "";

                const startedAt = Number(parsed?.startedAt || 0);
                const MAX_AGE_MS = 15 * 60 * 1000;
                if (startedAt && Number.isFinite(startedAt) && Date.now() - startedAt > MAX_AGE_MS) {
                    try {
                        window.localStorage.removeItem("kloner_vercel_pending_app_deploy");
                    } catch {
                        // ignore
                    }
                    return null;
                }

                return appId
                    ? `/dashboard/view?appVercel=connected&flow=appDeploy&appId=${encodeURIComponent(appId)}`
                    : "/dashboard/view?appVercel=connected&flow=appDeploy";
            } catch {
                return "/dashboard/view?appVercel=connected&flow=appDeploy";
            }
        }

        const pendingAppPreview = window.localStorage.getItem("kloner_vercel_pending_app_preview");
        if (pendingAppPreview) {
            try {
                const parsed = JSON.parse(pendingAppPreview) as any;
                const appId = typeof parsed?.appId === "string" ? parsed.appId.trim() : "";
                if (appId) {
                    return `/dashboard/view?appVercel=connected&flow=appDeploy&appId=${encodeURIComponent(appId)}`;
                }
            } catch {
                // fall through to the generic deploy resume path
            }

            return "/dashboard/view?appVercel=connected&flow=appDeploy";
        }

        const pendingAiImages = window.localStorage.getItem("kloner_vercel_pending_ai_images");
        if (pendingAiImages) {
            try {
                const parsed = JSON.parse(pendingAiImages) as any;
                const returnTo = typeof parsed?.returnTo === "string" ? parsed.returnTo.trim() : "";
                if (returnTo) return returnTo;
            } catch {
                return "/dashboard/view?vercel=connected&flow=images";
            }
            return "/dashboard/view?vercel=connected&flow=images";
        }

        const pendingDeploy = window.localStorage.getItem("kloner_vercel_pending_deploy");
        if (pendingDeploy) {
            return "/dashboard/view?vercel=connected";
        }
    } catch {
        // ignore
    }
    return null;
}

export function VercelIntegrationCallbackClient() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [returnTo, setReturnTo] = useState<string>("/dashboard/view");
    const reportedErrorKeyRef = useRef<string>("");

    const oauthCode = searchParams.get("code");
    const oauthState = searchParams.get("state");
    const statusParam = searchParams.get("status");
    const reasonParam = searchParams.get("reason");

    const status = statusParam ?? "success";
    const reason = reasonParam;
    const isSuccess = status === "success";

    useEffect(() => {
        if (isSuccess) return;

        const dedupeKey = `${status}:${reason || "unknown"}:${searchParams.toString()}`;
        if (reportedErrorKeyRef.current === dedupeKey) return;
        reportedErrorKeyRef.current = dedupeKey;

        const severity = reason === "state" || reason === "auth" ? "error" : "critical";
        const payload = {
            source: "frontend" as const,
            severity,
            route: "/integrations/vercel/callback",
            method: "GET",
            action: "vercel.oauth.callback.error",
            statusCode: reason === "state" || reason === "auth" ? 400 : 500,
            message: "vercel_oauth_callback_failed",
            errorName: "VercelOAuthCallbackFailed",
            service: "vercel-oauth-callback",
            extra: {
                status,
                reason: reason || null,
                returnTo: getCookieValue("vercel_oauth_return") || null,
                search: searchParams.toString(),
            },
        };

        void fetch("/api/internal/observability/ingest", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify(payload),
            keepalive: true,
            credentials: "include",
        }).catch(() => {
            // best effort only
        });
    }, [isSuccess, reason, searchParams, status]);

    useEffect(() => {
        if (!isSuccess) return;

        if (oauthCode && oauthState) {
            const qs = searchParams.toString();
            window.location.replace(`/api/vercel/oauth/callback?${qs}`);
            return;
        }

        try {
            window.localStorage.setItem("kloner_vercel_connected", "1");
        } catch {
            // ignore
        }

        const returnCookie = getCookieValue("vercel_oauth_return");
        const cookieReturn = safeReturnPath(returnCookie);
        const inferredReturn = inferReturnPathFromLocalStorage();
        const nextReturnTo = cookieReturn || inferredReturn || "/dashboard/view?vercel=connected";
        setReturnTo(nextReturnTo);

        // Best-effort cleanup.
        try {
            document.cookie = [
                `vercel_oauth_return=`,
                "Path=/",
                "Max-Age=0",
                "SameSite=Lax",
            ].join("; ");
        } catch {
            // ignore
        }

        const t = window.setTimeout(() => {
            router.replace(nextReturnTo);
        }, 2400);

        return () => window.clearTimeout(t);
    }, [isSuccess, oauthCode, oauthState, searchParams, router]);

    if (isSuccess) {
        return (
            <main className="min-h-screen bg-white text-neutral-900 px-4">
                <div className="mx-auto w-full max-w-xl pt-10">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                                    <path
                                        fill="currentColor"
                                        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 14-4-4 1.4-1.4L11 13.2l5.6-5.6L18 9l-7 7Z"
                                    />
                                </svg>
                            </div>

                            <div className="flex-1">
                                <div className="text-sm font-semibold text-emerald-900">
                                    Vercel successfully connected
                                </div>
                                <div className="mt-0.5 text-sm text-emerald-800/90">
                                    You’ll be moved in a moment…
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 text-center">
                        <Link
                            href={returnTo}
                            className="text-sm font-semibold underline underline-offset-4"
                            style={{ color: ACCENT }}
                        >
                            Continue now
                        </Link>
                    </div>
                </div>
            </main>
        );
    }

    const title = "We couldn’t finish connecting Vercel";

    const message =
        reason === "state"
            ? "The security check for this OAuth request failed. This usually happens if the link was reused or the session expired. Try connecting Vercel again from Kloner."
            : reason === "token"
                ? "Vercel returned an error while exchanging the authorization code. Try again from Kloner; if it keeps failing, check your Vercel OAuth app configuration."
                : reason === "auth"
                    ? "We couldn’t confirm your Kloner session while handling the Vercel callback. Sign in again on Kloner, then reconnect Vercel from the dashboard."
                    : reason === "db"
                        ? "We connected to Vercel but couldn’t save the integration in your Kloner account. Nothing was linked. Try again in a moment."
                        : "Something went wrong while talking to Vercel. Try reconnecting from Kloner.";

    return (
        <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
            <div className="max-w-lg w-full">
                <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-900 to-black/60 px-6 sm:px-8 py-8 sm:py-10 shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
                    <div className="flex justify-center mb-6">
                        <div className="relative h-32 w-32 sm:h-36 sm:w-36 flex items-center justify-center">
                            <span
                                className="relative inline-flex h-16 w-16 items-center justify-center rounded-full shadow-lg"
                                style={{
                                    backgroundColor: "#ef4444",
                                    boxShadow: "0 12px 30px rgba(239,68,68,0.5)",
                                }}
                            >
                                <svg viewBox="0 0 24 24" className="h-8 w-8 text-white" aria-hidden="true">
                                    <path
                                        fill="currentColor"
                                        d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm0 5a1 1 0 0 1 .993.883L13 8v6a1 1 0 0 1-1.993.117L11 14V8a1 1 0 0 1 1-1Zm0 10a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z"
                                    />
                                </svg>
                            </span>
                        </div>
                    </div>

                    <div className="space-y-3 text-center">
                        <p className="text-[11px] font-semibold tracking-[0.25em] uppercase text-zinc-400">
                            Vercel integration
                        </p>
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                            {title}
                        </h1>
                        <p className="text-sm sm:text-[15px] text-zinc-300/90 leading-relaxed">
                            {message}
                        </p>
                    </div>

                    <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                        <Link
                            href="/dashboard/view"
                            className="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60 transition-transform hover:-translate-y-0.5"
                            style={{
                                backgroundColor: ACCENT,
                                boxShadow: `0 12px 30px ${ACCENT}55`,
                            }}
                        >
                            Return to Kloner dashboard
                        </Link>
                        <a
                            href="/integrations/vercel"
                            className="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold text-white/90 border border-white/15 bg-white/5 hover:bg-white/10 transition-transform hover:-translate-y-0.5"
                        >
                            Open integration page
                        </a>
                        <Link
                            href="/"
                            className="text-xs sm:text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                        >
                            Go to homepage
                        </Link>
                    </div>

                    <div className="mt-5 border-t border-white/5 pt-4 text-[11px] text-zinc-500 text-center">
                        <p>If this window was opened automatically by Vercel, you can now close it.</p>
                    </div>
                </div>
            </div>
        </main>
    );
}
