"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAuth, getIdToken, getIdTokenResult, onAuthStateChanged } from "firebase/auth";
import { Loader2, Plus, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";

type RuleType = "email" | "name" | "cardCountry" | "cardFingerprint" | "ip" | "uid";
type Entry = {
    id: string;
    type: RuleType;
    value: string;
    source: "config" | "entry";
};

const RULE_TYPES: Array<{ value: RuleType; label: string; placeholder: string }> = [
    { value: "email", label: "Email address", placeholder: "person@example.com" },
    { value: "name", label: "Billing name", placeholder: "Name on card" },
    { value: "cardCountry", label: "Card country", placeholder: "Two-letter code, e.g. MA" },
    { value: "cardFingerprint", label: "Card fingerprint", placeholder: "Stripe card fingerprint" },
    { value: "ip", label: "IP address", placeholder: "203.0.113.42" },
    { value: "uid", label: "Firebase UID", placeholder: "Firebase user ID" },
];

async function adminFetch(path: string, init?: RequestInit) {
    const user = getAuth().currentUser;
    if (!user) throw new Error("Sign in with an admin account to continue.");
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${await getIdToken(user, true)}`);
    if (init?.body) headers.set("content-type", "application/json");
    const response = await fetch(path, { ...init, headers, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || `Request failed (${response.status})`);
    }
    return payload;
}

export default function AbuseBlocklistClient() {
    const [authReady, setAuthReady] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [entries, setEntries] = useState<Entry[]>([]);
    const [type, setType] = useState<RuleType>("email");
    const [value, setValue] = useState("");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const payload = await adminFetch("/api/admin/abuse-blocklist");
            setEntries(Array.isArray(payload.entries) ? payload.entries : []);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not load the blocklist.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => onAuthStateChanged(getAuth(), async (user) => {
        setAuthReady(true);
        setIsAdmin(false);
        if (!user) return;
        try {
            const token = await getIdTokenResult(user, true);
            setIsAdmin(token.claims.admin === true);
        } catch {
            setIsAdmin(false);
        }
    }), []);

    useEffect(() => {
        if (authReady && isAdmin) void load();
    }, [authReady, isAdmin, load]);

    const sortedEntries = useMemo(() => [...entries].sort((a, b) =>
        a.type.localeCompare(b.type) || a.value.localeCompare(b.value)), [entries]);
    const selectedType = RULE_TYPES.find((item) => item.value === type)!;

    const addRule = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!value.trim()) return;
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            await adminFetch("/api/admin/abuse-blocklist", {
                method: "POST",
                body: JSON.stringify({ type, value }),
            });
            setValue("");
            setNotice("Rule added. It applies to relevant checks immediately.");
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not add this rule.");
        } finally {
            setSaving(false);
        }
    };

    const removeRule = async (entry: Entry) => {
        setRemovingId(entry.id);
        setError(null);
        setNotice(null);
        try {
            await adminFetch("/api/admin/abuse-blocklist", {
                method: "DELETE",
                body: JSON.stringify(entry.source === "config"
                    ? { source: "config", type: entry.type, value: entry.value }
                    : { id: entry.id }),
            });
            setEntries((current) => current.filter((item) => item.id !== entry.id));
            setNotice("Rule removed.");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not remove this rule.");
        } finally {
            setRemovingId(null);
        }
    };

    if (!authReady) return <div className="py-12 text-sm text-gray-500">Checking admin access…</div>;
    if (!isAdmin) return <div className="rounded-xl border border-gray-200 p-6 text-sm text-gray-600">Admin access is required to manage checkout protection.</div>;

    return (
        <div className="space-y-7">
            <header>
                <div className="flex items-center gap-3">
                    <ShieldAlert className="h-7 w-7 text-orange-500" />
                    <h1 className="text-2xl font-semibold">Checkout abuse blocklist</h1>
                </div>
                <p className="mt-2 max-w-2xl text-sm text-gray-600">
                    Add an email, billing name, card country, card fingerprint, IP address, or Firebase UID. Stripe screening checks payment and identity rules; IP and UID rules also restrict support chat access.
                </p>
            </header>

            <form onSubmit={addRule} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-base font-semibold">Add a rule</h2>
                <div className="grid gap-3 sm:grid-cols-[190px_1fr_auto]">
                    <label className="sr-only" htmlFor="abuse-rule-type">Rule type</label>
                    <select
                        id="abuse-rule-type"
                        value={type}
                        onChange={(event) => setType(event.target.value as RuleType)}
                        className="h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm"
                    >
                        {RULE_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                    <label className="sr-only" htmlFor="abuse-rule-value">Value to block</label>
                    <input
                        id="abuse-rule-value"
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        placeholder={selectedType.placeholder}
                        maxLength={320}
                        required
                        className="h-11 min-w-0 rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    />
                    <button
                        type="submit"
                        disabled={saving || !value.trim()}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 text-sm font-medium text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Add
                    </button>
                </div>
            </form>

            {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
            {notice && <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}

            <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                    <div>
                        <h2 className="font-semibold">Blocked values</h2>
                        <p className="mt-1 text-xs text-gray-500">{entries.length} {entries.length === 1 ? "rule" : "rules"}</p>
                    </div>
                    <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
                    </button>
                </div>
                {loading && !entries.length ? (
                    <div className="flex items-center gap-2 px-5 py-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading rules…</div>
                ) : sortedEntries.length === 0 ? (
                    <p className="px-5 py-8 text-sm text-gray-500">No blocked values are configured.</p>
                ) : (
                    <ul className="divide-y divide-gray-100">
                        {sortedEntries.map((entry) => {
                            const label = RULE_TYPES.find((item) => item.value === entry.type)?.label || entry.type;
                            const busy = removingId === entry.id;
                            return (
                                <li key={entry.id} className="flex items-center gap-4 px-5 py-3">
                                    <span className="w-36 shrink-0 text-xs font-medium text-gray-500">{label}</span>
                                    <span className="min-w-0 flex-1 break-all text-sm text-gray-900">{entry.value}</span>
                                    <button type="button" onClick={() => void removeRule(entry)} disabled={busy} aria-label={`Remove ${label} rule ${entry.value}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
                                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                        <span className="hidden sm:inline">Remove</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
        </div>
    );
}
