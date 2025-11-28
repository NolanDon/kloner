// app/dashboard/archived/page.tsx
"use client";

import { getUserRenders, RenderRecord, unarchiveRender } from "@/src/lib/renders";
import { useEffect, useState } from "react";
import { RenderCard } from "../view/page";

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
        <div className="px-4 pb-10 pt-6">
            <h1 className="text-xl font-semibold text-neutral-900">
                Archived previews
            </h1>
            <p className="mt-1 text-sm text-neutral-600 max-w-xl">
                Archived previews are hidden from your main dashboard. They are
                automatically deleted after 30 days. Unarchive a preview if you
                want to resume editing or deploy it.
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
                            <RenderCard
                                key={r.id}
                                r={normalized as any}
                                isDeleting={false}
                                isOpening={false}
                                hardLocked={false}
                                isDeploying={false}
                                deployLocked={false}
                                urlHash={null}
                                continueRender={() => { }}
                                discardRender={() => { }}
                                startDeployWizard={() => { }}
                                archiveRender={() => { }}
                                unarchiveRender={handleUnarchive} setShowCreditsPaywall={function (mode: "deploy" | null): void {
                                    throw new Error("Function not implemented.");
                                }} push={function (message: string, level?: string): void {
                                    throw new Error("Function not implemented.");
                                }} />
                        );
                    })}
                </div>
            )}
        </div>
    );
}
