// app/settings/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, deleteUser, reauthenticateWithPopup, GoogleAuthProvider, type User } from "firebase/auth";
import { CheckCircle2, Shield, Bell, Rocket, Plug, AlertTriangle, Trash2, Gauge } from "lucide-react";
import NavBar from "@/components/NavBar";

const ACCENT = "#f55f2a";

export default function SettingsPage(): JSX.Element {
    const [user, setUser] = useState<User | null>(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string>("");

    useEffect(() => {
        const off = onAuthStateChanged(auth, (u) => setUser(u));
        return () => off();
    }, []);

    const initials = useMemo(() => {
        if (!user) return "ME";
        const base = user.displayName || user.email || "Me";
        return base.slice(0, 2).toUpperCase();
    }, [user]);

    async function handleDelete() {
        if (!user) return;
        const ok = window.confirm("Delete your account and all associated data? This cannot be undone.");
        if (!ok) return;
        setBusy(true);
        setMsg("");
        try {
            // Firebase requires recent login; attempt reauth via Google as a sane default.
            try {
                const provider = new GoogleAuthProvider();
                await reauthenticateWithPopup(user, provider);
            } catch {
                // ignore; if not Google user, delete may still throw and surface a clear error
            }
            await deleteUser(user);
            setMsg("Account deleted.");
            window.location.href = "/goodbye";
        } catch (e: any) {
            setMsg(e?.message || "Delete failed. Re-login required.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <NavBar />
            <div className="mx-auto max-w-3xl px-4 py-[120px]">
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-900">Settings</h1>
                <p className="mt-1 text-sm text-neutral-600">Manage account, connections, and notifications.</p>

                {/* Profile */}
                <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4">
                    <div className="flex items-center gap-3">
                        <div className="h-12 w-12 grid place-items-center rounded-full text-white font-semibold" style={{ background: ACCENT }}>
                            {initials}
                        </div>
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-neutral-900 truncate">{user?.displayName || user?.email || "Signed in"}</div>
                            <div className="text-xs text-neutral-500">User ID: {user?.uid.slice(0, 8)}…</div>
                        </div>
                    </div>
                </section>

                {/* Connections */}
                <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4">
                    <div className="flex items-center gap-2">
                        <Plug className="h-4 w-4 text-neutral-700" />
                        <h2 className="text-sm font-semibold text-neutral-900">Connections</h2>
                    </div>

                    <div className="mt-3 grid sm:grid-cols-2 gap-3">
                        <div className="rounded-xl border border-neutral-200 p-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Rocket className="h-4 w-4 text-neutral-700" />
                                    <div className="text-sm font-medium text-neutral-900">Vercel</div>
                                </div>
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                                    connected?
                                </span>
                            </div>
                            <p className="mt-1 text-xs text-neutral-600">Deploy previews directly from Kloner.</p>
                            <div className="mt-2 flex gap-2">
                                <a
                                    href="/api/vercel/oauth/start"
                                    className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
                                >
                                    Connect
                                </a>
                                <button
                                    disabled
                                    className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-semibold text-neutral-500"
                                    title="Coming soon"
                                >
                                    Disconnect
                                </button>
                            </div>
                        </div>

                        <div className="rounded-xl border border-neutral-200 p-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Bell className="h-4 w-4 text-neutral-700" />
                                    <div className="text-sm font-medium text-neutral-900">Email Alerts</div>
                                </div>
                                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500 border border-neutral-200">
                                    coming soon
                                </span>
                            </div>
                            <p className="mt-1 text-xs text-neutral-600">Notify on render completion and deploy status.</p>
                            <button
                                disabled
                                className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-semibold text-neutral-500"
                            >
                                Manage
                            </button>
                        </div>
                    </div>
                </section>

                {/* Security */}
                <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4">
                    <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-neutral-700" />
                        <h2 className="text-sm font-semibold text-neutral-900">Security</h2>
                    </div>

                    <div className="mt-3 grid sm:grid-cols-2 gap-3">
                        <div className="rounded-xl border border-neutral-200 p-3">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-medium text-neutral-900">Two-Factor Auth</div>
                                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500 border border-neutral-200">
                                    not available yet
                                </span>
                            </div>
                            <p className="mt-1 text-xs text-neutral-600">Add an extra layer of protection to your account.</p>
                            <button disabled className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-semibold text-neutral-500">
                                Enable
                            </button>
                        </div>

                        <div className="rounded-xl border border-neutral-200 p-3">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-medium text-neutral-900">API Keys</div>
                                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500 border border-neutral-200">
                                    coming soon
                                </span>
                            </div>
                            <p className="mt-1 text-xs text-neutral-600">Generate API keys for advanced automation.</p>
                            <button disabled className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-semibold text-neutral-500">
                                View Keys
                            </button>
                        </div>
                    </div>
                </section>

                {/* Danger */}
                <section className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4">
                    <div className="flex items-center gap-2 text-red-700">
                        <AlertTriangle className="h-4 w-4" />
                        <h2 className="text-sm font-semibold">Danger Zone</h2>
                    </div>

                    <p className="mt-2 text-xs text-red-700/90">
                        Deleting your account is permanent. All screenshots and previews will be removed.
                    </p>

                    <div className="mt-3 flex items-center gap-2">
                        <button
                            onClick={handleDelete}
                            disabled={busy}
                            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                        >
                            <Trash2 className="h-4 w-4" />
                            {busy ? "Deleting…" : "Delete Account"}
                        </button>
                        {msg && <span className="text-xs text-red-700">{msg}</span>}
                    </div>
                </section>

                {/* System status (optional simple badge) */}
                <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700">
                    <Gauge className="h-3.5 w-3.5" />
                    System status: <span className="font-semibold text-emerald-700">OK</span>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                </div>
            </div>
        </>
    );
}
