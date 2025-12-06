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

    const uploadFavicon = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";

        if (!file || !draftId) return;
        if (!file.type.startsWith("image/")) {
            alert("Please upload a valid image file for the favicon.");
            return;
        }

        setUploading(true);
        try {
            const { url } = await uploadFileToUserBlob(file, draftId);

            const nextMeta: MetaWithJsonLd = {
                ...draftMeta,
                faviconUrl: url,
            };

            setDraftMeta(nextMeta);

            if (onSaveMeta) {
                await onSaveMeta(nextMeta);
            }

            alert("Favicon uploaded successfully.");
        } catch (error) {
            console.error("Favicon upload failed:", error);
            alert("Favicon upload failed. See console for details.");
        } finally {
            setUploading(false);
        }
    };


    return (
        <div className="space-y-4">
            <h3 className="text-lg font-bold">SEO &amp; Site Metadata</h3>

            {/* Page title */}
            <div>
                <label
                    htmlFor="meta-title"
                    className="block text-sm font-semibold text-gray-700"
                >
                    Page Title
                </label>
                <input
                    id="meta-title"
                    name="meta-title"
                    type="text"
                    value={draftMeta.title ?? ""}
                    onChange={(e) => handleMetaChange("title", e.target.value)}
                    placeholder="E.g. Cookie Gifts & Holiday Boxes"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border"
                    maxLength={60}
                    autoComplete="off"
                />
                <p className="text-md text-gray-500 mt-1">
                    Used in browser tabs and search results. Max 60 characters.
                </p>
            </div>

            {/* Meta description */}
            <div>
                <label
                    htmlFor="meta-description"
                    className="block text-sm font-semibold text-gray-700"
                >
                    Meta Description
                </label>
                <textarea
                    id="meta-description"
                    name="meta-description"
                    value={draftMeta.description ?? ""}
                    onChange={(e) =>
                        handleMetaChange("description", e.target.value)
                    }
                    placeholder="A short, search-friendly summary of this page..."
                    rows={3}
                    className="mt-1 min-h-[100px] block w-full rounded-md border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border"
                    maxLength={160}
                    autoComplete="off"
                />
                <p className="text-md text-gray-500 mt-1">
                    Used for search snippets. Max 160 characters.
                </p>
            </div>

            {/* OG image URL */}
            <div>
                <label
                    htmlFor="meta-og-image"
                    className="block text-sm font-semibold text-gray-700"
                >
                    Social Share Image URL (OpenGraph)
                </label>
                <input
                    id="meta-og-image"
                    name="meta-og-image"
                    type="url"
                    value={draftMeta.ogImageUrl ?? ""}
                    onChange={(e) =>
                        handleMetaChange("ogImageUrl", e.target.value)
                    }
                    placeholder="https://example.com/share.png"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border"
                    autoComplete="off"
                />
                <p className="text-md text-gray-500 mt-1">
                    Image shown when this page is shared on social platforms.
                </p>
            </div>

            {/* Favicon upload */}
            <div>
                <label
                    htmlFor="meta-favicon"
                    className="block text-sm font-semibold text-gray-700"
                >
                    Favicon
                </label>
                <div className="flex items-center space-x-3 mt-1">
                    {draftMeta.faviconUrl ? (
                        <span className="inline-block w-6 h-6 border rounded-sm flex items-center justify-center overflow-hidden">
                            <img
                                src={draftMeta.faviconUrl}
                                alt="Favicon preview"
                                className="object-cover w-full h-full"
                            />
                        </span>
                    ) : (
                        <span className="text-sm text-gray-500">
                            No favicon uploaded
                        </span>
                    )}
                    <label
                        className={`cursor-pointer inline-flex items-center px-3 py-1 border border-transparent text-sm font-semibold rounded-md shadow-sm text-white ${uploading
                            ? "bg-gray-400"
                            : "bg-orange-600 hover:bg-orange-700"
                            } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent`}
                    >
                        {uploading ? "Uploading..." : "Upload Favicon"}
                        <input
                            id="meta-favicon"
                            name="meta-favicon"
                            type="file"
                            accept="image/*"
                            onChange={uploadFavicon}
                            disabled={uploading}
                            className="sr-only"
                        />
                    </label>
                </div>
            </div>

            {/* JSON-LD editor */}
            <div>
                <label
                    htmlFor="meta-jsonld"
                    className="block text-sm font-semibold text-gray-700"
                >
                    JSON-LD (advanced)
                </label>
                <textarea
                    id="meta-jsonld"
                    name="meta-jsonld"
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
                    placeholder={`{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "The Basic Website — Sample Brand",
  "url": "https://example.com/"
}`}
                    rows={10}
                    className="mt-1 block w-full rounded-md border-gray-300 font-mono text-md leading-5 shadow-sm focus:border-accent focus:ring-accent p-2 border"
                    spellCheck={false}
                />
                <p className="text-md text-gray-500 mt-1">
                    Must be valid JSON. This content will be rendered inside a{" "}
                    {`<script type="application/ld+json">`} tag for this page.
                </p>
            </div>

            {/* Save meta button with debounce */}
            <button
                type="button"
                onClick={handleMetaSaveClick}
                disabled={saving}
                className={`inline-flex items-center rounded-md px-3 py-2 text-sm font-semibold transition ${saving
                    ? "bg-accent/50 text-white cursor-not-allowed"
                    : justSaved
                        ? "bg-accent/50 text-white"
                        : "bg-accent text-white hover:brightness-95"
                    }`}
            >
                {saving
                    ? "Saving..."
                    : justSaved
                        ? "Saved Changes"
                        : "Save Changes"}
            </button>
        </div>
    );
}
