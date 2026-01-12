import { useState, useRef, useEffect, ChangeEvent } from "react";
import Image from 'next/image'
import { useModal } from "@/components/ui/ModalContext";

// meta-settings.ts

// Exposed so PreviewEditor can import it
export interface UploadedAsset {
    url: string;
    path?: string | null;
}

export interface MetaWithJsonLd {
    title?: string;
    description?: string;
    faviconUrl?: string;
    jsonLd?: unknown | null;
}

export interface MetaSettingsProps {
    draftId?: string;
    meta: MetaWithJsonLd;
    uploadFileToUserBlob?: (
        file: File
    ) => Promise<{ url: string; path?: string }>;
    onSaveMeta?: (meta: MetaWithJsonLd) => Promise<void> | void;
}

export function MetaSettings({
    draftId,
    meta,
    uploadFileToUserBlob,
    onSaveMeta,
}: MetaSettingsProps) {
    const { showAlert, showConfirm } = useModal();
    const [uploading, setUploading] = useState(false);

    // save state + hard debounce guard
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [justSaved, setJustSaved] = useState(false);

    // track last successful save time
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

    // AI generation state
    const [generating, setGenerating] = useState(false);

    // local meta copy
    const [draftMeta, setDraftMeta] = useState<MetaWithJsonLd>(meta);

    // JSON-LD text version for editing
    const [jsonText, setJsonText] = useState<string>(() =>
        meta.jsonLd ? JSON.stringify(meta.jsonLd, null, 2) : ""
    );

    const faviconInputRef = useRef<HTMLInputElement | null>(null);

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

    function sanitizeMetaForSave(metaIn: MetaWithJsonLd): MetaWithJsonLd {
        const out: MetaWithJsonLd = {};

        if (metaIn.title !== undefined) out.title = metaIn.title;
        if (metaIn.description !== undefined) out.description = metaIn.description;
        if (metaIn.faviconUrl !== undefined) out.faviconUrl = metaIn.faviconUrl;

        // Critical part: never let jsonLd be undefined
        if (metaIn.jsonLd === undefined) {
            out.jsonLd = null; // explicit clear instead of undefined
        } else {
            out.jsonLd = metaIn.jsonLd ?? null;
        }

        return out;
    }

    const handleMetaSaveClick = async () => {
        if (!onSaveMeta) return;
        if (savingRef.current) return;

        savingRef.current = true;
        setSaving(true);
        setJustSaved(false);

        try {
            let parsedJsonLd: unknown | null = draftMeta.jsonLd ?? null;

            const trimmed = jsonText.trim();
            if (trimmed.length > 0) {
                try {
                    parsedJsonLd = JSON.parse(trimmed);
                } catch (err) {
                    await showAlert("JSON-LD is not valid JSON. Fix it or clear the field.", "Invalid JSON-LD");
                    savingRef.current = false;
                    setSaving(false);
                    return;
                }
            } else {
                // user cleared the textarea -> explicitly clear jsonLd
                parsedJsonLd = null;
            }

            const metaToSaveRaw: MetaWithJsonLd = {
                ...draftMeta,
                jsonLd: parsedJsonLd,
            };

            const metaToSave = sanitizeMetaForSave(metaToSaveRaw);

            await onSaveMeta(metaToSave);
            const now = new Date();
            setLastSavedAt(now);
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
                jsonLd:
                    seoMetaByPage.single.jsonLd !== undefined
                        ? seoMetaByPage.single.jsonLd
                        : null,
            };
        }
        if (seoMetaByPage.__single__) {
            return {
                title: seoMetaByPage.__single__.title ?? "",
                description: seoMetaByPage.__single__.description ?? "",
                jsonLd:
                    seoMetaByPage.__single__.jsonLd !== undefined
                        ? seoMetaByPage.__single__.jsonLd
                        : null,
            };
        }
        // Then try homepage route
        if (seoMetaByPage["/"]) {
            return {
                title: seoMetaByPage["/"].title ?? "",
                description: seoMetaByPage["/"].description ?? "",
                jsonLd:
                    seoMetaByPage["/"].jsonLd !== undefined
                        ? seoMetaByPage["/"].jsonLd
                        : null,
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
            jsonLd: block.jsonLd !== undefined ? block.jsonLd : null,
        };
    }

    const handleGenerateMetaClick = async () => {
        if (!draftId) {
            await showAlert("Missing renderId for this draft.", "Error");
            return;
        }
        if (generating) return;

        if (!isMetaEmpty) {
            const ok = await showConfirm(
                "Regenerating meta will replace the current title, description, and JSON-LD for this page. Continue?",
                "Regenerate Meta"
            );
            if (!ok) return;
        }

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
            const metaBlockRaw = pickMetaFromSeoMetaByPage(data?.seoMetaByPage);
            if (!metaBlockRaw) {
                await showAlert("SEO meta generation returned no usable data.", "Generation Failed");
                return;
            }

            const metaBlock = sanitizeMetaForSave(metaBlockRaw);

            // Update local state
            setDraftMeta(metaBlock);
            setJsonText(
                metaBlock.jsonLd
                    ? JSON.stringify(metaBlock.jsonLd, null, 2)
                    : ""
            );

            // Persist immediately via onSaveMeta
            if (onSaveMeta) {
                await onSaveMeta(metaBlock);
                const now = new Date();
                setLastSavedAt(now);
                setJustSaved(true);
                setTimeout(() => setJustSaved(false), 1500);
            }
        } catch (err: any) {
            await showAlert(err?.message || "Failed to generate SEO meta.", "Generation Error");
        } finally {
            setGenerating(false);
        }
    };

    const hasFavicon = !!draftMeta.faviconUrl?.trim();

    const handlePickFavicon = () => {
        if (uploading) return;
        faviconInputRef.current?.click();
    };

    const handleFaviconFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!uploadFileToUserBlob) {
            await showAlert("Upload handler is not wired up.", "Upload Error");
            e.target.value = "";
            return;
        }

        try {
            setUploading(true);
            const { url } = await uploadFileToUserBlob(file);
            setDraftMeta((prev) => ({
                ...prev,
                faviconUrl: url,
            }));
        } catch (err: any) {
            console.error("Favicon upload failed", err);
            await showAlert("Failed to upload favicon. Try again.", "Upload Failed");
        } finally {
            setUploading(false);
            e.target.value = "";
        }
    };

    const generateLabel = isMetaEmpty ? "Generate meta" : "Regenerate meta";

    return (
        <div className="flex h-full flex-col bg-white/90">
            <div className="flex-1 overflow-y-auto px-4 pt-6 pb-4">
                {/* {isMetaEmpty && (
                    <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                        <div className="mb-1 font-medium">
                            No SEO metadata found for this page.
                        </div>
                        <div className="text-[11px] text-amber-800">
                            Generate a starting point with AI or fill the fields
                            below.
                        </div>
                    </div>
                )} */}

                {/* Favicon block */}

                <div className="flex h-14 w-14 my-2 items-center justify-center overflow-hidden rounded-md border border-neutral-200 bg-neutral-50">
                    {hasFavicon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <Image
                            src={draftMeta.faviconUrl as any}
                            alt="Current favicon"
                            width={20}
                            height={20}
                            className="h-full w-full object-contain"
                        />

                    ) : (
                        <span className="px-2 text-center text-xs text-neutral-400">
                            No favicon
                        </span>
                    )}
                </div>
                {draftMeta.faviconUrl && (
                    <span className="max-w-[200px] truncate text-xs text-neutral-700">
                        {draftMeta.faviconUrl?.slice(0, 50) + '...'}
                    </span>
                )}

                <div className="mb-6 rounded-lg border border-neutral-200 bg-white/80 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-4">

                            <div className="flex flex-col gap-1">
                                <span className="text-xs text-neutral-500">
                                    Square PNG, SVG, or ICO. At least 64×64
                                    recommended.
                                </span>
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-1">
                            <button
                                type="button"
                                onClick={handlePickFavicon}
                                disabled={uploading}
                                className="inline-flex items-center rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                            >
                                {uploading
                                    ? "Uploading…"
                                    : hasFavicon
                                        ? "Replace favicon"
                                        : "Upload favicon"}
                            </button>

                        </div>
                    </div>

                    <input
                        ref={faviconInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFaviconFileChange}
                    />
                </div>

                {/* Main form fields */}
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-neutral-700">
                            Page title
                        </label>
                        <input
                            type="text"
                            value={draftMeta.title ?? ""}
                            onChange={(e) =>
                                handleMetaChange("title", e.target.value)
                            }
                            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
                            placeholder="SEO title for this page"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-neutral-700">
                            Meta description
                        </label>
                        <textarea
                            value={draftMeta.description ?? ""}
                            onChange={(e) =>
                                handleMetaChange("description", e.target.value)
                            }
                            rows={4}
                            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
                            placeholder="Concise, benefit-driven summary for search results"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-neutral-700">
                            JSON-LD (optional)
                        </label>
                        <textarea
                            value={jsonText}
                            onChange={(e) => setJsonText(e.target.value)}
                            rows={10}
                            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-[11px] leading-[1.4] text-neutral-900 outline-none focus:border-neutral-400"
                            placeholder='{"@context": "https://schema.org", "@type": "WebPage", ...}'
                        />
                    </div>
                </div>

                {/* Buttons + disclaimer directly under the last block */}
                <div className="mt-5 flex flex-col gap-2 border-t border-neutral-200 pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={handleMetaSaveClick}
                                disabled={saving}
                                className="inline-flex items-center rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                            >
                                {saving ? "Saving…" : "Save meta"}
                            </button>
                            <div className="flex flex-col text-[11px] text-neutral-500">
                                {justSaved && (
                                    <span className="text-emerald-600">
                                        Saved
                                        {lastSavedAt && (
                                            <>
                                                {" "}
                                                at{" "}
                                                {lastSavedAt.toLocaleTimeString(
                                                    [],
                                                    {
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                        second: "2-digit",
                                                    }
                                                )}
                                            </>
                                        )}
                                    </span>
                                )}
                                {!justSaved && lastSavedAt && (
                                    <span>
                                        Last saved at{" "}
                                        {lastSavedAt.toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                            second: "2-digit",
                                        })}
                                    </span>
                                )}
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={handleGenerateMetaClick}
                            disabled={generating}
                            className="inline-flex items-center rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                        >
                            {generating
                                ? "Generating meta…"
                                : `${generateLabel} with AI`}
                        </button>
                    </div>

                    <p className="text-[11px] leading-snug text-neutral-500">
                        Note: Search engines can take time to pick up updated
                        titles, descriptions, and JSON-LD. Changes here update your
                        site immediately, but you need to check back in search
                        results later to see them reflected.
                    </p>
                </div>
            </div>
        </div>
    );
}
