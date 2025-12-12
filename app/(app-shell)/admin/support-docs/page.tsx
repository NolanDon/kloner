// app/admin/support-docs/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, doc, getDocs, updateDoc, setDoc } from "firebase/firestore";

import { Loader2 } from "lucide-react";

type SupportDoc = {
    id: string;
    text: string;
    updatedAt?: string | null;
};

export default function AdminSupportDocsPage() {
    const [docs, setDocs] = useState<SupportDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [embedding, setEmbedding] = useState(false);

    // new section state
    const [newId, setNewId] = useState("");
    const [newText, setNewText] = useState("");
    const [creating, setCreating] = useState(false);

    // collapsed / expanded state per doc
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    // copy all state
    const [copyingAll, setCopyingAll] = useState(false);
    const [copiedAll, setCopiedAll] = useState(false);

    useEffect(() => {
        const loadDocs = async () => {
            try {
                const col = collection(db, "support_doc");
                const snap = await getDocs(col);

                const list: SupportDoc[] = [];
                snap.forEach((d) => {
                    const data = d.data() as any;
                    list.push({
                        id: d.id,
                        text: data.text ?? "",
                        updatedAt: data.updatedAt?.toDate?.().toISOString?.() ?? null,
                    });
                });

                list.sort((a, b) => a.id.localeCompare(b.id));
                setDocs(list);
            } finally {
                setLoading(false);
            }
        };

        void loadDocs();
    }, []);

    async function saveDoc(id: string, text: string) {
        setSavingId(id);
        try {
            await updateDoc(doc(db, "support_doc", id), {
                text,
                updatedAt: new Date(),
            });
        } finally {
            setSavingId(null);
        }
    }

    async function createDoc() {
        const id = newId.trim();
        const text = newText.trim();
        if (!id || !text) return;

        setCreating(true);
        try {
            const now = new Date();
            const ref = doc(db, "support_doc", id);

            await setDoc(ref, {
                text,
                embedding: [],
                updatedAt: now,
            });

            setDocs((prev) => {
                const next = [...prev, { id, text, updatedAt: now.toISOString() }];
                next.sort((a, b) => a.id.localeCompare(b.id));
                return next;
            });

            setNewId("");
            setNewText("");
        } finally {
            setCreating(false);
        }
    }

    async function runEmbedding() {
        setEmbedding(true);
        try {
            const res = await fetch("/api/support-docs/embed", { method: "POST" });
            const json = await res.json();
            console.log("Embedding output:", json);
        } finally {
            setEmbedding(false);
        }
    }

    const allDocsText = useMemo(() => {
        // Compact, LLM-friendly block. No JSON noise. Deterministic separators.
        return docs
            .map((d) => `### ${d.id}\n${(d.text ?? "").trim()}\n`)
            .join("\n");
    }, [docs]);

    async function copyAll() {
        setCopyingAll(true);
        setCopiedAll(false);
        try {
            await navigator.clipboard.writeText(allDocsText);
            setCopiedAll(true);
            window.setTimeout(() => setCopiedAll(false), 1200);
        } catch (err) {
            console.error("[SupportDocs] copy all failed", err);
        } finally {
            setCopyingAll(false);
        }
    }

    if (loading) {
        return (
            <div className="p-6 text-sm text-neutral-600 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading support docs…
            </div>
        );
    }

    return (
        <div className="p-6 space-y-8">
            <div className="flex items-center justify-between gap-4">
                {/* Hero */}
                <section className="mb-10 flex-1">
                    <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                        <span>Kloner · Support Docs</span>
                    </div>

                    <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-8 sm:px-8 sm:py-10 shadow-sm">
                        <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                            Support Documentation
                        </h1>
                        <p className="mt-1 text-xs text-neutral-600">
                            Context for AI assistance. Run embedding after saving to refresh vector data.
                        </p>

                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={copyAll}
                                disabled={copyingAll || docs.length === 0}
                                className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 disabled:opacity-50"
                                title="Copies every section (title + text) into one block"
                            >
                                {copyingAll ? "Copying…" : copiedAll ? "Copied" : "Copy all"}
                            </button>

                            <button
                                onClick={runEmbedding}
                                disabled={embedding}
                                className="rounded-full bg-accent text-white px-4 py-2 text-sm font-semibold disabled:opacity-50 whitespace-nowrap"
                            >
                                {embedding ? "Embedding…" : "Run Embedding"}
                            </button>
                        </div>
                    </div>
                </section>
            </div>

            {/* Create new section */}
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50/80 p-4 space-y-3">
                <div className="text-sm font-semibold text-neutral-800">Add new section</div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                        type="text"
                        value={newId}
                        onChange={(e) => setNewId(e.target.value)}
                        placeholder="section key (e.g. product_overview)"
                        className="w-full sm:w-64 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black"
                    />
                    <button
                        onClick={createDoc}
                        disabled={creating || !newId.trim() || !newText.trim()}
                        className="rounded-lg bg-emerald-500 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    >
                        {creating ? "Creating…" : "Create section"}
                    </button>
                </div>
                <textarea
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    placeholder="Write the support doc content for this section…"
                    className="w-full min-h-[120px] rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black"
                />
            </div>

            {/* Existing docs */}
            {docs.map((d) => {
                const isOpen = !!expanded[d.id];
                const snippet = d.text.length > 160 ? d.text.slice(0, 160) + "..." : d.text;

                return (
                    <div
                        key={d.id}
                        className="rounded-xl border border-neutral-200 p-4 bg-white shadow-sm space-y-3"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold text-neutral-800">{d.id}</div>
                                <p className="mt-1 text-[11px] text-neutral-500">{snippet}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() =>
                                    setExpanded((prev) => ({
                                        ...prev,
                                        [d.id]: !prev[d.id],
                                    }))
                                }
                                className="rounded-full border border-neutral-200 px-3 py-1 text-[11px] text-neutral-700 hover:bg-neutral-50"
                            >
                                {isOpen ? "Hide" : "Edit"}
                            </button>
                        </div>

                        {d.updatedAt && (
                            <p className="text-[11px] text-neutral-400">
                                Last updated: {new Date(d.updatedAt).toLocaleString()}
                            </p>
                        )}

                        {isOpen && (
                            <div className="space-y-2 pt-2 border-t border-neutral-100">
                                <textarea
                                    value={d.text}
                                    onChange={(e) => {
                                        const next = [...docs];
                                        const idx = next.findIndex((x) => x.id === d.id);
                                        if (idx !== -1) {
                                            next[idx] = { ...next[idx], text: e.target.value };
                                            setDocs(next);
                                        }
                                    }}
                                    className="w-full min-h-[180px] rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black"
                                />

                                <button
                                    onClick={() => saveDoc(d.id, d.text)}
                                    disabled={savingId === d.id}
                                    className="rounded-lg bg-emerald-500 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                                >
                                    {savingId === d.id ? "Saving…" : "Save changes"}
                                </button>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
