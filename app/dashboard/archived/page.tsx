// app/dashboard/archived/page.tsx
"use client";

import { useEffect, useState } from "react";
import { getUserRenders, RenderRecord, unarchiveRender, useResolvedImg } from "@/src/lib/renders";

type ArchiveCardProps = {
    r: RenderRecord;
    onUnarchive: (id: string) => void;
};

function ArchiveCard({ r, onUnarchive }: ArchiveCardProps) {
    const { src: refImgUrl, onError: refImgErr } = useResolvedImg(r.key || "");
    const isDeployed = !!r.lastExportedAt;

    const name =
        r.nameHint ||
        (r.url ? new URL(r.url).hostname : "") ||
        "Untitled preview";

    return (
        <div className="relative flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="relative">
                {refImgUrl ? (
                    <img
                        src={refImgUrl}
                        alt={name}
                        loading="lazy"
                        onError={refImgErr}
                        className="h-40 w-full object-cover opacity-70"
                        draggable={false}
                    />
                ) : (
                    <div className="grid h-40 w-full place-items-center text-xs text-neutral-500">
                        No snapshot available
                    </div>
                )}

                <span
                    className="absolute left-2 top-2 rounded-md bg-amber-200/95 px-2 py-0.5 text-[10px] font-semibold text-amber-900 shadow"
                    title="Archived previews are hidden from the main dashboard"
                >
                    Archived
                </span>

                <span className="absolute right-2 bottom-2 rounded-md bg-white/95 px-2 py-0.5 text-[10px] font-medium text-neutral-700 shadow">
                    {isDeployed ? "Deployed" : "Not deployed"}
                </span>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-3 py-2.5">
                <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-neutral-900">
                        {name}
                    </div>
                    {r.url && (
                        <div className="truncate text-xs text-neutral-500">
                            {r.url}
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    onClick={() => onUnarchive(r.id)}
                    className="shrink-0 rounded-md border border-amber-500 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                    title="Move this preview back to your main dashboard"
                >
                    Unarchive
                </button>
            </div>
        </div>
    );
}

export default function ArchivedPage() {
    const [renders, setRenders] = useState<RenderRecord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            const all = await getUserRenders();
            if (cancelled) return;
            setRenders(all.filter((r) => r.archived));
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    async function handleUnarchive(id: string) {
        await unarchiveRender(id);
        setRenders((prev) => prev.filter((r) => r.id !== id));
    }

    return (
        <div className="min-h-screen bg-white pb-[30px]">
            <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-10 py-8">
                {/* Hero */}
                <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                    <span>Kloner · Your Archives</span>
                </div>

                <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-8 sm:px-8 sm:py-10 shadow-sm">
                    <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                        Archives
                    </h1>
                    <p className="mt-3 max-w-2xl text-sm sm:text-base text-neutral-600">
                        Archived previews are hidden from your dashboard and retained for 30 days before permanent deletion. Unarchive anytime to resume editing or deploy.
                    </p>

                    {loading ? (
                        <div className="mt-6 text-sm text-neutral-500">Loading…</div>
                    ) : renders.length === 0 ? (
                        <div className="mt-6 text-sm text-neutral-500">
                            No archived previews yet.
                        </div>
                    ) : (
                        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {renders.map((r) => {
                                const normalized = { ...r, html: r.html ?? undefined };
                                return (
                                    <ArchiveCard
                                        key={r.id}
                                        r={normalized}
                                        onUnarchive={handleUnarchive}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
