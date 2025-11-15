// app/settings/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import {
    onAuthStateChanged,
    type User,
} from "firebase/auth";
import {
    CheckCircle2,
    Shield,
    Bell,
    Rocket,
    Plug,
    Gauge,
} from "lucide-react";
import NavBar from "@/components/NavBar";
import { useVercelIntegration } from "@/src/hooks/useVercelIntegration";

const ACCENT = "#f55f2a";
const VERCEL_INTEGRATION_SLUG =
    process.env.NEXT_PUBLIC_VERCEL_INTEGRATION_SLUG || "kloner";

export default function SettingsPage(): JSX.Element {
    const [user, setUser] = useState<User | null>(null);
    const [disconnectBusy, setDisconnectBusy] = useState(false);

    const {
        status: vercelStatus,
        checking: vercelChecking,
        refresh: refreshVercelStatus,
    } = useVercelIntegration();

    useEffect(() => {
        const off = onAuthStateChanged(auth, (u) => setUser(u));
        return () => off();
    }, []);

    const initials = useMemo(() => {
        if (!user) return "ME";
        const base = user.displayName || user.email || "Me";
        return base.slice(0, 2).toUpperCase();
    }, [user]);

    function handleConnectVercel() {
        if (!VERCEL_INTEGRATION_SLUG || !user) {
            console.error("Missing integration slug or user not signed in");
            return;
        }

        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        const state = Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

        localStorage.setItem("kloner_vercel_latest_csrf", state);

        document.cookie = [
            `vercel_oauth_state=${state}`,
            "Path=/",
            "Max-Age=600",
            "SameSite=Lax",
        ].join("; ");

        const link = `https://vercel.com/integrations/${VERCEL_INTEGRATION_SLUG}/new?state=${state}`;
        window.location.assign(link);
    }

    async function handleDisconnectVercel() {
        setDisconnectBusy(true);
        try {
            const res = await fetch("/api/vercel/disconnect", {
                method: "POST",
                credentials: "include",
            });
            if (res.ok) {
                await refreshVercelStatus();
            } else {
                console.error("Failed to disconnect Vercel");
            }
        } catch (e) {
            console.error("Disconnect error", e);
        } finally {
            setDisconnectBusy(false);
        }
    }

    const vercelBadgeLabel =
        vercelStatus === "connected"
            ? "connected"
            : vercelStatus === "loading" || vercelChecking
                ? "checking…"
                : vercelStatus === "error"
                    ? "error"
                    : "not connected";

    const vercelBadgeClasses =
        vercelStatus === "connected"
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-neutral-100 text-neutral-600 border-neutral-200";

    return (
        <>
            <NavBar />
            <main className="min-h-screen bg-white py-[80px]">
                <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-10 py-16">
                    <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-800">
                        Settings
                    </h1>
                    <p className="mt-1 text-sm text-neutral-600">
                        Manage account, connections, and notifications.
                    </p>

                    {/* subtle divider */}
                    <div className="mt-4 mb-4 flex items-center gap-2">
                        <div className="h-px flex-1 bg-neutral-200/80" />
                        <div className="h-px flex-1 bg-neutral-200/80" />
                    </div>

                    {/* Profile */}
                    <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-3">
                            <div
                                className="h-12 w-12 grid place-items-center rounded-full text-white font-semibold"
                                style={{ background: ACCENT }}
                            >
                                {initials}
                            </div>
                            <div className="min-w-0">
                                <div className="text-sm font-medium text-neutral-800 truncate">
                                    {user?.displayName || user?.email || "Signed in"}
                                </div>
                                <div className="text-xs text-neutral-500">
                                    User ID: {user?.uid.slice(0, 8)}…
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Connections */}
                    <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-2">
                            <Plug className="h-4 w-4 text-neutral-700" />
                            <h2 className="text-sm font-semibold text-neutral-800">
                                Connections
                            </h2>
                        </div>

                        <div className="mt-3 grid sm:grid-cols-2 gap-3">
                            {/* Vercel connection card */}
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Rocket className="h-4 w-4 text-neutral-700" />
                                        <div className="text-sm font-medium text-neutral-800">
                                            Vercel
                                        </div>
                                    </div>
                                    <span
                                        className={
                                            "rounded-full px-2 py-0.5 text-[10px] font-semibold border " +
                                            vercelBadgeClasses
                                        }
                                    >
                                        {vercelBadgeLabel}
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-neutral-600">
                                    Deploy previews directly from Kloner.
                                </p>
                                <div className="mt-2 flex gap-2">
                                    <button
                                        type="button"
                                        onClick={handleConnectVercel}
                                        disabled={
                                            vercelStatus === "connected" ||
                                            vercelStatus === "loading"
                                        }
                                        className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
                                    >
                                        Connect
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleDisconnectVercel}
                                        disabled={
                                            vercelStatus !== "connected" || disconnectBusy
                                        }
                                        className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                                    >
                                        {disconnectBusy ? "Disconnecting…" : "Disconnect"}
                                    </button>
                                </div>
                            </div>

                            {/* Email alerts placeholder */}
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Bell className="h-4 w-4 text-neutral-700" />
                                        <div className="text-sm font-medium text-neutral-800">
                                            Email Alerts
                                        </div>
                                    </div>
                                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-500 border border-neutral-200">
                                        coming soon
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-neutral-600">
                                    Notify on render completion and deploy status.
                                </p>
                                <button
                                    disabled
                                    className="mt-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-500"
                                >
                                    Manage
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Security */}
                    <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-2">
                            <Shield className="h-4 w-4 text-neutral-700" />
                            <h2 className="text-sm font-semibold text-neutral-800">
                                Security
                            </h2>
                        </div>

                        <div className="mt-3 grid sm:grid-cols-2 gap-3">
                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-medium text-neutral-800">
                                        Two-Factor Auth
                                    </div>
                                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-500 border border-neutral-200">
                                        not available yet
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-neutral-600">
                                    Add an extra layer of protection to your account.
                                </p>
                                <button
                                    disabled
                                    className="mt-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-500"
                                >
                                    Enable
                                </button>
                            </div>

                            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-medium text-neutral-800">
                                        API Keys
                                    </div>
                                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-500 border border-neutral-200">
                                        coming soon
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-neutral-600">
                                    Generate API keys for advanced automation.
                                </p>
                                <button
                                    disabled
                                    className="mt-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-500"
                                >
                                    View Keys
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Account & data (no self-serve hard delete) */}
                    <section className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                        <div className="flex items-center gap-2 text-neutral-800">
                            <h2 className="text-sm font-semibold">
                                Account and data
                            </h2>
                        </div>

                        <p className="mt-2 text-xs text-neutral-600">
                            If you want to close your Kloner account or request data deletion,
                            contact our team. We&apos;ll help export your data, review any active
                            deployments, and process deletion safely.
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <a
                                href="mailto:support@kloner.app?subject=Kloner%20account%20closure%20or%20data%20deletion%20request"
                                className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-neutral-800 border border-neutral-200 hover:bg-neutral-50"
                            >
                                Contact support about my account
                            </a>
                            <span className="text-[11px] text-neutral-500">
                                Support: support@kloner.app
                            </span>
                        </div>
                    </section>

                    {/* System status */}
                    <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-700">
                        <Gauge className="h-3.5 w-3.5" />
                        System status:{" "}
                        <span className="font-semibold text-emerald-600">OK</span>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    </div>
                </div>
            </main>
        </>
    );
}
