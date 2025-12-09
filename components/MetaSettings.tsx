import { useState, useRef, useEffect, ChangeEvent } from "react";
import { SeoMeta } from "./PreviewEditor";

type MetaWithJsonLd = SeoMeta & {
    jsonLd?: unknown;
};

export type UploadedAsset = {
    url: string;
    path: string;
};

type MetaSettingsProps = {
    draftId?: string;
    meta: MetaWithJsonLd;
    uploadFileToUserBlob: (file: File, draftId: string) => Promise<UploadedAsset>;
    onSaveMeta?: (meta: MetaWithJsonLd) => Promise<void> | void;
};

export function MetaSettings({
    draftId,
    meta,
    uploadFileToUserBlob,
    onSaveMeta,
}: MetaSettingsProps) {
    const [uploading, setUploading] = useState(false);

    // save state + hard debounce guard
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [justSaved, setJustSaved] = useState(false);

    // AI generation state
    const [generating, setGenerating] = useState(false);

    // local meta copy
    const [draftMeta, setDraftMeta] = useState<MetaWithJsonLd>(meta);

    // JSON-LD text version for editing
    const [jsonText, setJsonText] = useState<string>(() =>
        meta.jsonLd ? JSON.stringify(meta.jsonLd, null, 2) : ""
    );

    // when page / meta changes, re-seed form + JSON editor
    useEffect(() => {
        setDraftMeta(meta);
        setJsonText(meta.jsonLd ? JSON.stringify(meta.jsonLd, null, 2) : "");
    }, [meta]);

    const isEmptyObject = (val: unknown): boolean =>
        !!val && typeof val === "object" && Object.keys(val as any).length === 0;

    const isMetaEmpty =
        !draftMeta ||
        (!draftMeta.title?.trim() &&
            !draftMeta.description?.trim() &&
            (!draftMeta.jsonLd || isEmptyObject(draftMeta.jsonLd)));

    const handleMetaChange = (key: keyof MetaWithJsonLd, value: string) => {
        setDraftMeta((prev) => ({ ...prev, [key]: value }));
    };

    const handleMetaSaveClick = async () => {
        if (!onSaveMeta) return;
        if (savingRef.current) return;

        savingRef.current = true;
        setSaving(true);
        setJustSaved(false);

        try {
            let parsedJsonLd: unknown | undefined = draftMeta.jsonLd;

            const trimmed = jsonText.trim();
            if (trimmed.length > 0) {
                try {
                    parsedJsonLd = JSON.parse(trimmed);
                } catch (err) {
                    alert("JSON-LD is not valid JSON. Fix it or clear the field.");
                    savingRef.current = false;
                    setSaving(false);
                    return;
                }
            } else {
                parsedJsonLd = undefined;
            }

            const metaToSave: MetaWithJsonLd = {
                ...draftMeta,
                jsonLd: parsedJsonLd,
            };

            await onSaveMeta(metaToSave);
            setJustSaved(true);
            setTimeout(() => setJustSaved(false), 1500);
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    // Pick the meta block for this page from seoMetaByPage
    function pickMetaFromSeoMetaByPage(seoMetaByPage: any): MetaWithJsonLd | null {
        if (!seoMetaByPage || typeof seoMetaByPage !== "object") return null;

        // Prefer “single” / “__single__” if present
        if (seoMetaByPage.single) {
            return {
                title: seoMetaByPage.single.title ?? "",
                description: seoMetaByPage.single.description ?? "",
                jsonLd: seoMetaByPage.single.jsonLd ?? undefined,
            };
        }
        if (seoMetaByPage.__single__) {
            return {
                title: seoMetaByPage.__single__.title ?? "",
                description: seoMetaByPage.__single__.description ?? "",
                jsonLd: seoMetaByPage.__single__.jsonLd ?? undefined,
            };
        }
        // Then try homepage route
        if (seoMetaByPage["/"]) {
            return {
                title: seoMetaByPage["/"].title ?? "",
                description: seoMetaByPage["/"].description ?? "",
                jsonLd: seoMetaByPage["/"].jsonLd ?? undefined,
            };
        }

        const keys = Object.keys(seoMetaByPage);
        if (!keys.length) return null;

        const k = keys[0];
        const block = seoMetaByPage[k];
        if (!block || typeof block !== "object") return null;

        return {
            title: block.title ?? "",
            description: block.description ?? "",
            jsonLd: block.jsonLd ?? undefined,
        };
    }

    const handleGenerateMetaClick = async () => {
        if (!draftId) {
            alert("Missing renderId for this draft.");
            return;
        }
        if (generating) return;

        setGenerating(true);
        try {
            const res = await fetch("/api/render-meta", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ renderId: draftId }),
            });

            if (!res.ok) {
                const errJson = await res.json().catch(() => null);
                const msg =
                    errJson?.error ||
                    `Failed to generate SEO meta (status ${res.status})`;
                alert(msg);
                return;
            }

            const data = await res.json();
            const metaBlock = pickMetaFromSeoMetaByPage(data?.seoMetaByPage);
            if (!metaBlock) {
                alert("SEO meta generation returned no usable data.");
                return;
            }

            // Update local state
            setDraftMeta(metaBlock);
            setJsonText(
                metaBlock.jsonLd ? JSON.stringify(metaBlock.jsonLd, null, 2) : ""
            );

            // Persist immediately via onSaveMeta
            if (onSaveMeta) {
                await onSaveMeta(metaBlock);
                setJustSaved(true);
                setTimeout(() => setJustSaved(false), 1500);
            }
        } catch (err: any) {
            alert(err?.message || "Failed to generate SEO meta.");
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            {isMetaEmpty ? (
                <div className="flex flex-1 items-center justify-center pt-[150px]">
                    <div className="inline-flex min-h-[120px] max-w-sm flex-col items-center justify-center rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-center text-xs text-amber-900">
                        <div className="mb-2 font-medium">
                            No SEO metadata found for this page.
                        </div>
                        <button
                            type="button"
                            onClick={handleGenerateMetaClick}
                            disabled={generating}
                            className="mt-1 inline-flex items-center rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                        >
                            {generating ? "Generating meta…" : "Generate Meta with AI"}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="mt-2 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleMetaSaveClick}
                        disabled={saving}
                        className="inline-flex items-center rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                    >
                        {saving ? "Saving…" : "Save meta"}
                    </button>
                    {justSaved && (
                        <span className="text-[11px] text-emerald-600">
                            Saved
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

