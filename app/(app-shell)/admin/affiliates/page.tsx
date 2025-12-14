"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";

type GateState = "loading" | "allowed" | "denied";

type AffiliateRow = {
    code: string;
    uid: string | null;
    status: string;
    createdAtMs: number | null;
    updatedAtMs: number | null;
};

type UserHit = {
    uid: string;
    email: string;
    displayName?: string | null;
};

function cleanCode(v: unknown) {
    return typeof v === "string" ? v.trim().toUpperCase() : "";
}

async function requireAdminToken(): Promise<string> {
    const u = auth.currentUser;
    if (!u) throw new Error("Not authenticated");

    const tok = await u.getIdTokenResult(true);
    const admin = (tok.claims as any)?.admin;
    const ok = admin === true || admin === "true" || admin === 1;
    if (!ok) throw new Error("Not admin");

    return await u.getIdToken(); // bearer token for server routes
}

export default function AdminAffiliateConsolePage() {
    const router = useRouter();

    const [gate, setGate] = useState<GateState>("loading");

    // create / reset
    const [code, setCode] = useState("");
    const [forceReset, setForceReset] = useState(false);
    const [creating, setCreating] = useState(false);

    // assign (resolved uid behind the scenes)
    const [forceAssign, setForceAssign] = useState(false);
    const [assigning, setAssigning] = useState(false);

    // email search dropdown
    const [emailQuery, setEmailQuery] = useState("");
    const [emailHits, setEmailHits] = useState<UserHit[]>([]);
    const [emailLoading, setEmailLoading] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserHit | null>(null);
    const [emailOpen, setEmailOpen] = useState(false);
    const emailBoxRef = useRef<HTMLDivElement | null>(null);

    // search / view
    const [lookup, setLookup] = useState("");
    const [loading, setLoading] = useState(false);
    const [row, setRow] = useState<AffiliateRow | null>(null);

    const [err, setErr] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        const off = onAuthStateChanged(auth, async (u) => {
            if (!u) return setGate("denied");
            try {
                const tok = await u.getIdTokenResult(true);
                const admin = (tok.claims as any)?.admin;
                const ok = admin === true || admin === "true" || admin === 1;
                setGate(ok ? "allowed" : "denied");
            } catch {
                setGate("denied");
            }
        });
        return () => off();
    }, []);

    useEffect(() => {
        if (gate === "denied") router.replace("/dashboard");
    }, [gate, router]);

    // close dropdown on outside click
    useEffect(() => {
        function onDown(e: MouseEvent) {
            const el = emailBoxRef.current;
            if (!el) return;
            if (!el.contains(e.target as any)) setEmailOpen(false);
        }
        window.addEventListener("mousedown", onDown);
        return () => window.removeEventListener("mousedown", onDown);
    }, []);

    // debounce email search
    useEffect(() => {
        const q = emailQuery.trim().toLowerCase();

        // reset if short
        if (q.length < 2) {
            setEmailHits([]);
            setEmailLoading(false);
            return;
        }

        // if user already selected and query matches, do nothing
        if (selectedUser?.email?.toLowerCase() === q) {
            setEmailHits([]);
            setEmailLoading(false);
            return;
        }

        const t = setTimeout(async () => {
            try {
                setEmailLoading(true);
                const token = await requireAdminToken();
                const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(q)}`, {
                    headers: { authorization: `Bearer ${token}` },
                    cache: "no-store",
                });

                const json = await res.json().catch(() => null);
                if (!res.ok || !json?.ok) {
                    setEmailHits([]);
                    return;
                }

                const hits: UserHit[] = Array.isArray(json.users) ? json.users : [];
                setEmailHits(hits);
                setEmailOpen(true);
            } finally {
                setEmailLoading(false);
            }
        }, 250);

        return () => clearTimeout(t);
    }, [emailQuery, selectedUser]);

    const canCreate = useMemo(() => cleanCode(code).length >= 2 && !creating, [code, creating]);
    const canLookup = useMemo(() => cleanCode(lookup).length >= 2 && !loading, [lookup, loading]);
    const canAssign = useMemo(() => !!row?.code && !!selectedUser?.uid && !assigning, [row, selectedUser, assigning]);

    async function apiPost(path: string, body: any) {
        const token = await requireAdminToken();
        const res = await fetch(path, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
            cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Request failed");
        return json;
    }

    async function apiGet(path: string) {
        const token = await requireAdminToken();
        const res = await fetch(path, {
            headers: { authorization: `Bearer ${token}` },
            cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Request failed");
        return json;
    }

    async function createOrReset() {
        const c = cleanCode(code);
        if (!c) return;

        setErr(null);
        setMsg(null);
        setCreating(true);

        try {
            await apiPost("/api/admin/affiliates/create-code", {
                code: c,
                force: forceReset,
            });

            setMsg(forceReset ? `Reset ${c} (uid cleared)` : `Created ${c}`);
            setLookup(c);
            await lookupCode(c);
        } catch (e: any) {
            setErr(e?.message || "Failed");
        } finally {
            setCreating(false);
        }
    }

    async function lookupCode(c?: string) {
        const q = cleanCode(c ?? lookup);
        if (!q) return;

        setErr(null);
        setMsg(null);
        setLoading(true);

        try {
            const json = await apiGet(`/api/admin/affiliates/get?code=${encodeURIComponent(q)}`);

            const r = json?.affiliate || null;
            if (!r?.code) {
                setRow(null);
                setMsg("No record found");
                return;
            }

            setRow({
                code: String(r.code || q),
                uid: typeof r.uid === "string" && r.uid.trim() ? r.uid.trim() : null,
                status: String(r.status || "active"),
                createdAtMs: typeof r.createdAtMs === "number" ? r.createdAtMs : null,
                updatedAtMs: typeof r.updatedAtMs === "number" ? r.updatedAtMs : null,
            });

            // if you load a new code, clear assignment selection to avoid accidental reassignment
            setSelectedUser(null);
            setEmailQuery("");
            setEmailHits([]);
            setEmailOpen(false);
        } catch (e: any) {
            setErr(e?.message || "Failed");
            setRow(null);
        } finally {
            setLoading(false);
        }
    }

    async function assignCodeToSelectedUser() {
        if (!row?.code || !selectedUser?.uid) return;

        setErr(null);
        setMsg(null);
        setAssigning(true);

        try {
            await apiPost("/api/admin/affiliates/assign-code", {
                code: row.code,
                uid: selectedUser.uid, // uid behind the scenes
                force: forceAssign,
            });

            setMsg(`Assigned ${row.code} to ${selectedUser.email}`);
            await lookupCode(row.code);
        } catch (e: any) {
            setErr(e?.message || "Failed");
        } finally {
            setAssigning(false);
        }
    }

    if (gate === "loading") return <div className="p-6 text-sm">Checking admin access…</div>;
    if (gate === "denied") return null;

    return (
        <div className="p-6 space-y-6">
            <header className="space-y-1">
                <h1 className="text-lg font-semibold">Admin · Affiliates</h1>
                <p className="text-xs text-neutral-500">Create codes, assign to users, and verify current ownership.</p>
            </header>

            {(err || msg) && (
                <div
                    className={[
                        "rounded border px-3 py-2 text-sm",
                        err ? "border-red-300 bg-red-50 text-red-700" : "border-green-300 bg-green-50 text-green-700",
                    ].join(" ")}
                >
                    {err ?? msg}
                </div>
            )}

            {/* Create / Reset */}
            <section className="rounded border bg-white p-4 space-y-3">
                <div className="text-sm whitespace-nowrap font-semibold">Create code</div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="e.g. BLUE"
                        className="w-full rounded border px-3 py-2 text-sm"
                    />

                    <button
                        disabled={!canCreate}
                        onClick={() => void createOrReset()}
                        className="rounded-full bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
                    >
                        {creating ? "Working…" : forceReset ? "Reset code" : "Create code"}
                    </button>
                </div>

                <label className="flex items-center gap-2 text-xs text-neutral-600">
                    <input type="checkbox" checked={forceReset} onChange={(e) => setForceReset(e.target.checked)} />
                    Force reset (clears uid if already assigned)
                </label>
            </section>

            {/* Lookup */}
            <section className="rounded border bg-white p-4 space-y-3">
                <div className="text-sm font-semibold">Lookup code</div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                        value={lookup}
                        onChange={(e) => setLookup(e.target.value)}
                        placeholder="e.g. BLUE"
                        className="w-full rounded border px-3 py-2 text-sm"
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && canLookup) void lookupCode();
                        }}
                    />

                    <button
                        disabled={!canLookup}
                        onClick={() => void lookupCode()}
                        className="rounded-full border px-4 py-2 text-sm disabled:opacity-60"
                    >
                        {loading ? "Loading…" : "Lookup"}
                    </button>
                </div>

                {row && (
                    <div className="rounded border p-3 text-sm space-y-1">
                        <div className="font-semibold">{row.code}</div>
                        <div className="text-xs text-neutral-500">
                            Status: {row.status} · UID: {row.uid ?? "unassigned"}
                        </div>
                        {(row.createdAtMs || row.updatedAtMs) && (
                            <div className="text-[11px] text-neutral-400">
                                Created: {row.createdAtMs ? new Date(row.createdAtMs).toLocaleString() : "—"} · Updated:{" "}
                                {row.updatedAtMs ? new Date(row.updatedAtMs).toLocaleString() : "—"}
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* Assign */}
            <section className="rounded border bg-white p-4 space-y-3">
                <div className="text-sm font-semibold">Assign code</div>

                <div className="text-xs text-neutral-500">Load a code first. Then search a user by email and assign.</div>

                <div ref={emailBoxRef} className="relative flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative w-full">
                        <input
                            value={emailQuery}
                            onChange={(e) => {
                                setEmailQuery(e.target.value);
                                setSelectedUser(null);
                                setEmailOpen(true);
                            }}
                            onFocus={() => {
                                if (emailHits.length > 0) setEmailOpen(true);
                            }}
                            placeholder="type email to search…"
                            className="w-full rounded border px-3 py-2 text-sm"
                            disabled={!row}
                            autoComplete="off"
                        />

                        {/* dropdown */}
                        {row && emailOpen && (emailLoading || emailHits.length > 0) && (
                            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded border bg-white shadow">
                                {emailLoading && (
                                    <div className="px-3 py-2 text-xs text-neutral-500">Searching…</div>
                                )}

                                {!emailLoading && emailHits.length === 0 && emailQuery.trim().length >= 2 && (
                                    <div className="px-3 py-2 text-xs text-neutral-500">No matches</div>
                                )}

                                {!emailLoading &&
                                    emailHits.map((u) => (
                                        <button
                                            key={u.uid}
                                            type="button"
                                            onClick={() => {
                                                setSelectedUser(u);
                                                setEmailQuery(u.email);
                                                setEmailHits([]);
                                                setEmailOpen(false);
                                            }}
                                            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100"
                                        >
                                            <div className="font-medium">{u.email}</div>
                                            <div className="text-[11px] text-neutral-500">
                                                {u.displayName ? `${u.displayName} · ` : ""}
                                                {u.uid}
                                            </div>
                                        </button>
                                    ))}
                            </div>
                        )}
                    </div>

                    <button
                        disabled={!canAssign}
                        onClick={() => void assignCodeToSelectedUser()}
                        className="rounded-full bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
                    >
                        {assigning ? "Assigning…" : "Assign"}
                    </button>
                </div>

                {row && selectedUser && (
                    <div className="rounded border bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
                        Selected: <span className="font-semibold">{selectedUser.email}</span>{" "}
                        <span className="text-neutral-400">({selectedUser.uid})</span>
                    </div>
                )}

                <label className="flex items-center gap-2 text-xs text-neutral-600">
                    <input
                        type="checkbox"
                        checked={forceAssign}
                        onChange={(e) => setForceAssign(e.target.checked)}
                        disabled={!row}
                    />
                    Force reassign (overwrites existing uid)
                </label>
            </section>
        </div>
    );
}
