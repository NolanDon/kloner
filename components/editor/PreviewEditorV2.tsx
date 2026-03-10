// src/components/PreviewEditor.tsx
"use client";

import { ensureSessionAndCsrf } from "@/lib/auth-client";
import { useEffect, useMemo, useRef, useState, useCallback, ChangeEvent } from "react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import Image from 'next/image'

export type Device = "desktop" | "tablet" | "mobile";
export type ViewMode = "code" | "preview" | "screenshot";

export interface SeoMeta {
    title?: string;
    description?: string;
    ogImageUrl?: string;
    faviconUrl?: string;
    jsonLd?: unknown;
}

// Fire-and-forget request to delete assets by their storage paths.
// The dashboard host listens for "kloner:delete-assets" messages.
function requestDeleteAssetsByPaths(paths: string[]) {
    if (!paths.length) return;

    window.postMessage(
        {
            type: "kloner:delete-assets",
            paths,
        },
        "*"
    );
}

type Props = {
    initialHtml: string;
    sourceImage?: string;
    initialArchivedPageIds?: string[];
    onArchivedPageIdsChange?: (ids: string[]) => void;
    onClose: () => Promise<void> | void;
    onExport: (html: string, name?: string, skipBuildFinalExport?: boolean) => Promise<void>;
    draftId?: string;
    isAdmin?: boolean;
    saveDraft?: (payload: {
        draftId?: string;
        html: string;
        meta: {
            nameHint?: string;
            device: Device;
            mode: ViewMode;
            pageId?: string;
            archivedPageIds?: any;
        };
        version: number;
    }) => Promise<void>;
    onLiveHtml?: (html: string) => void;

    // optional single-page fallback
    initialSeoMeta?: SeoMeta;

    // full per-page map, keyed by route / page id
    initialSeoMetaByPage?: Record<string, SeoMeta> | null;

    // notify parent with pageId + meta + full map
    onSaveMeta?: (
        pageId: string | null,
        meta: SeoMeta,
        fullMap: Record<string, SeoMeta>
    ) => Promise<void> | void;

    pages?: EditorPage[];
    initialPageId?: string;
    onPageHtmlChange?: (pageId: string, html: string) => void;
};

const ACCENT = "#f55f2a";
const SAVE_NUDGE_KEY = "kloner_save_nudge_seen";

export type SelectionMeta = {
    has: boolean;
    tagName?: string;
    path?: string | null;
    rect?: any;
};

export type EditorPage = {
    id: string; // should match data-route when possible
    label: string;
    html: string;
    screenshotUrl?: string;
};

const FONT_OPTIONS = [
    {
        id: "system-sans",
        label: "System Sans",
        css: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "system-serif",
        label: "System Serif",
        css: 'Georgia, "Times New Roman", Times, serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "inter",
        label: "Inter",
        css: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "roboto",
        label: "Roboto",
        css: '"Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "poppins",
        label: "Poppins",
        css: '"Poppins", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "space-grotesk",
        label: "Space Grotesk",
        css: '"Space Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "playfair",
        label: "Playfair Display",
        css: '"Playfair Display", Georgia, "Times New Roman", Times, serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "mono",
        label: "Monospace",
        css: '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        sample: "Inter – The quick brown fox",

    },

    // Modern Sans – primary choices
    {
        id: "plus-jakarta-sans",
        label: "Plus Jakarta Sans",
        css: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "manrope",
        label: "Manrope",
        css: '"Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "dm-sans",
        label: "DM Sans",
        css: '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "nunito-sans",
        label: "Nunito Sans",
        css: '"Nunito Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "work-sans",
        label: "Work Sans",
        css: '"Work Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "urbanist",
        label: "Urbanist",
        css: '"Urbanist", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "outfit",
        label: "Outfit",
        css: '"Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "sora",
        label: "Sora",
        css: '"Sora", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "lexend",
        label: "Lexend",
        css: '"Lexend", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "rubik",
        label: "Rubik",
        css: '"Rubik", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "archivo",
        label: "Archivo",
        css: '"Archivo", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "mulish",
        label: "Mulish",
        css: '"Mulish", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "source-sans-3",
        label: "Source Sans 3",
        css: '"Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "ibm-plex-sans",
        label: "IBM Plex Sans",
        css: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "open-sans",
        label: "Open Sans",
        css: '"Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "lato",
        label: "Lato",
        css: '"Lato", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "montserrat",
        label: "Montserrat",
        css: '"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "raleway",
        label: "Raleway",
        css: '"Raleway", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },

    // Modern Serif / Display
    {
        id: "dm-serif-display",
        label: "DM Serif Display",
        css: '"DM Serif Display", Georgia, "Times New Roman", Times, serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "lora",
        label: "Lora",
        css: '"Lora", Georgia, "Times New Roman", Times, serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "merriweather",
        label: "Merriweather",
        css: '"Merriweather", Georgia, "Times New Roman", Times, serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "fraunces",
        label: "Fraunces",
        css: '"Fraunces", Georgia, "Times New Roman", Times, serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "cormorant-garamond",
        label: "Cormorant Garamond",
        css: '"Cormorant Garamond", Georgia, "Times New Roman", Times, serif',
        sample: "Inter – The quick brown fox",

    },

    // Extra modern sans options
    {
        id: "barlow",
        label: "Barlow",
        css: '"Barlow", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "karla",
        label: "Karla",
        css: '"Karla", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
    {
        id: "cabin",
        label: "Cabin",
        css: '"Cabin", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        sample: "Inter – The quick brown fox",

    },
];

const TEXT_COLOR_SWATCHES = [
    "#020617",
    "#0f172a",
    "#111827",
    "#1f2937",
    "#27272a",
    "#334155",
    "#4b5563",
    "#6b7280",
    "#9ca3af",
    "#e5e7eb",
    "#f55f2a",
    "#f97316",
    "#ea580c",
    "#ef4444",
    "#dc2626",
    "#e11d48",
    "#db2777",
    "#16a34a",
    "#22c55e",
    "#10b981",
    "#2563eb",
    "#3b82f6",
    "#0ea5e9",
    "#4f46e5",
    "#6366f1",
    "#8b5cf6",
    "#a855f7",
    "#f59e0b",
    "#d97706",
    "#ffffff",
];

const BG_COLOR_SWATCHES = [
    "#ffffff",
    "#f9fafb",
    "#f3f4f6",
    "#e5e7eb",
    "#d1d5db",
    "#111827",
    "#020617",
    "#0b1120",
    "#1f2937",
    "#fef3c7",
    "#ffedd5",
    "#fee2e2",
    "#e0f2fe",
    "#dbeafe",
    "#dcfce7",
    "#f3e8ff",
];

// update your presets
const FONT_SIZE_PRESETS = [
    // body / small text
    { id: "xs", label: "XS", px: 12 },
    { id: "sm", label: "Body S", px: 14 },
    { id: "md", label: "Body", px: 16 },
    { id: "lg", label: "Body L", px: 18 },

    // heading-style presets
    { id: "h6", label: "H6", px: 20 },
    { id: "h5", label: "H5", px: 24 },
    { id: "h4", label: "H4", px: 28 },
    { id: "h3", label: "H3", px: 32 },
    { id: "h2", label: "H2", px: 40 },
    { id: "h1", label: "H1", px: 48 },
];

// 1) strip all runtime <script> tags EXCEPT SEO JSON-LD
export function stripScripts(html: string) {
    if (!html) return html;

    // remove any <script> that is NOT type="application/ld+json"
    return html.replace(
        /<script\b(?![^>]*type\s*=\s*["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi,
        ""
    );
}

export function applySeoMetaToHtml(html: string, meta: SeoMetaMap): string {
    if (!html) return html;

    let out = html;

    // Helper: escape double quotes for HTML attribute
    const escapeAttr = (value: string) =>
        value.replace(/"/g, "&quot;").replace(/\s+/g, " ").trim();

    // Regex to find <main ... class="...page-root..." ...>
    out = out.replace(
        /<main([^>]*class="[^"]*page-root[^"]*"[^>]*)>/g,
        (fullMatch, attrs) => {
            // Extract data-route if present
            const routeMatch = attrs.match(/data-route="([^"]*)"/);
            const route = routeMatch ? routeMatch[1] || "/" : "__single__";

            const key = meta[route] ? route : meta["__single__"] ? "__single__" : null;
            if (!key) return fullMatch; // nothing to attach

            const m = meta[key];

            // Remove any existing data-meta-* to avoid duplicates
            let newAttrs = attrs
                .replace(/\sdata-meta-title="[^"]*"/g, "")
                .replace(/\sdata-meta-description="[^"]*"/g, "");

            newAttrs += ` data-meta-title="${escapeAttr(m.title)}"`;
            newAttrs += ` data-meta-description="${escapeAttr(m.description)}"`;

            return `<main${newAttrs}>`;
        }
    );

    return out;
}


export function injectJsonLdGraph(html: string, meta: SeoMetaMap): string {
    if (!html) return html;

    const graph = Object.values(meta)
        .map((m) => m.jsonLd)
        .filter(Boolean);

    if (!graph.length) return html;

    const jsonLd = JSON.stringify(
        {
            "@context": "https://schema.org",
            "@graph": graph,
        },
        null,
        0
    );

    const scriptTag = `<script type="application/ld+json">${jsonLd}</script>`;

    if (html.includes("</head>")) {
        return html.replace("</head>", scriptTag + "\n</head>");
    }

    return scriptTag + "\n" + html;
}


// 2) strip editor/runtime artifacts + localhost origins + unsafe attrs
export function stripEditorArtifacts(html: string): string {
    if (!html) return html;
    let out = html;

    // 1) remove ONLY the route style block by id (quoted id)
    out = out.replace(
        /<style\b[^>]*\bid\s*=\s*(["'])kloner-active-route\1[^>]*>[\s\S]*?<\/style>/gi,
        ""
    );

    // 2) also catch unquoted id=kloner-active-route (defensive for minified HTML)
    out = out.replace(
        /<style\b[^>]*\bid\s*=\s*kloner-active-route\b[^>]*>[\s\S]*?<\/style>/gi,
        ""
    );

    // 3) extra safety: if a style tag contains the exact preview-only data-route rules,
    //    strip just that <style> as well (covers weird/minified variants)
    out = out.replace(
        /<style\b[^>]*>[\s\S]*?main\.page-root\s*\[\s*data-route\s*\][^{]*\{[^}]*display\s*:\s*none\s*!important[^}]*\}[\s\S]*?main\.page-root\s*\[\s*data-route\s*=\s*["']\/["']\s*\][^{]*\{[^}]*display\s*:\s*block\s*!important[^}]*\}[\s\S]*?<\/style>/gi,
        ""
    );

    // 4) remove only style tags that contain *our* editor markers;
    //    leave all other <style> tags (site CSS) intact
    out = out.replace(
        /<style[^>]*>[\s\S]*?<\/style>/gi,
        (match) => {
            const isEditorStyle = /\[data-kloner-sel\]|\.kloner-toolbar|\.kbtn\b|\.khint\b/.test(
                match
            );
            return isEditorStyle ? "" : match;
        }
    );

    // 5) remove hidden file inputs and their hint blocks
    out = out.replace(
        /<input[^>]+type=["']file["'][^>]*>\s*<div[^>]*class=["']khint["'][^>]*>[\s\S]*?<\/div>/gi,
        ""
    );

    // 6) strip ALL contenteditable attributes (any value) so nothing ships editable
    out = out.replace(
        /\scontenteditable\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
        ""
    );

    // 7) strip kloner toolbar markup entirely from export
    out = out.replace(
        /<div[^>]*\bclass=["'][^"']*kloner-toolbar[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
        ""
    );

    // 8) strip editor data attributes (paths, selection markers, etc.)
    //    e.g. data-kloner-sel, data-kloner-path, data-kloner-*
    out = out.replace(/\sdata-kloner-[a-z0-9_-]+\s*=\s*"[^"]*"/gi, "");
    out = out.replace(/\sdata-kloner-[a-z0-9_-]+\s*=\s*'[^']*'/gi, "");
    out = out.replace(/\sdata-kloner-[a-z0-9_-]+\s*=\s*[^\s>]+/gi, "");

    // 9) strip inline event handlers (onclick, onmouseover, etc.)
    //    static HTML doesn’t need these and they’re a security risk to ship.
    out = out.replace(
        /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
        ""
    );

    // 10) strip localhost / 127.0.0.1 origins from href/src, keep path only
    //     so <a href="http://localhost:3000/about"> => <a href="/about">
    out = out.replace(
        /\b(href|src)\s*=\s*(")(https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)(\/[^"']*)?(")/gi,
        (_match, attr, quote, _origin, path = "/", endQuote) =>
            `${attr}=${quote}${path || "/"}${endQuote}`
    );
    out = out.replace(
        /\b(href|src)\s*=\s*(')(https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)(\/[^"']*)?(')/gi,
        (_match, attr, quote, _origin, path = "/", endQuote) =>
            `${attr}=${quote}${path || "/"}${endQuote}`
    );

    // 11) optional: strip blob: and data: URLs from href/src (defensive)
    //     keep this narrow to avoid killing legitimate data-URI favicons if you ever want them
    out = out.replace(
        /\b(href|src)\s*=\s*(")(blob:|data:)[^"]*(")/gi,
        (_m, attr, quote, _scheme, endQuote) => `${attr}=${quote}#${endQuote}`
    );
    out = out.replace(
        /\b(href|src)\s*=\s*(')(blob:|data:)[^']*(')/gi,
        (_m, attr, quote, _scheme, endQuote) => `${attr}=${quote}#${endQuote}`
    );

    return out;
}



function applySeoToHtml(html: string, meta?: SeoMeta): string {
    if (!meta) return html;
    let out = html;

    // <title>
    if (meta.title && typeof meta.title === "string") {
        if (/<title>.*?<\/title>/i.test(out)) {
            out = out.replace(
                /<title>.*?<\/title>/i,
                `<title>${meta.title}</title>`
            );
        } else {
            out = out.replace(
                /<head([^>]*)>/i,
                `<head$1><title>${meta.title}</title>`
            );
        }
    }

    // <meta name="description">
    if (meta.description && typeof meta.description === "string") {
        if (/<meta[^>]+name=["']description["'][^>]*>/i.test(out)) {
            out = out.replace(
                /<meta[^>]+name=["']description["'][^>]*>/i,
                `<meta name="description" content="${meta.description}">`
            );
        } else {
            out = out.replace(
                /<head([^>]*)>/i,
                `<head$1><meta name="description" content="${meta.description}">`
            );
        }
    }

    // favicon
    if (meta.faviconUrl && typeof meta.faviconUrl === "string") {
        if (/<link[^>]+rel=["']icon["'][^>]*>/i.test(out)) {
            out = out.replace(
                /<link[^>]+rel=["']icon["'][^>]*>/i,
                `<link rel="icon" href="${meta.faviconUrl}">`
            );
        } else {
            out = out.replace(
                /<head([^>]*)>/i,
                `<head$1><link rel="icon" href="${meta.faviconUrl}">`
            );
        }
    }

    return out;
}

export function sanitizeExportHtml(html: string, meta?: SeoMeta): string {
    if (!html) return html;
    let out = html;

    out = stripScripts(out);
    out = stripEditorArtifacts(out);

    out = applySeoToHtml(out, meta);

    return out;
}

// imports you need somewhere near the top of the file
import { doc, getDocFromServer, serverTimestamp, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase"; // or wherever your db is
import type { User as FirebaseUser } from "firebase/auth";
import { RenderDoc } from "@/app/dashboard/view/DashboardView";
import { useAuth } from "@/src/hooks/useAuth";
import { Camera, Code2, Eye, EyeOff, FileText, Images, Loader2, Maximize2, MessageSquare, Minimize2, Monitor, Palette, Redo2, Rocket, RotateCcw, RotateCw, SlidersHorizontal, Smartphone, Tablet, Trash2Icon, Undo2 } from "lucide-react";
import { compressImageForUpload } from "@/src/lib/clientImageCompression";
import { EditorSessionCounters, EditorSessionMetrics, EditorSessionUser, ExportAnalyticsUser, recordEditorSessionAnalytics, recordExportAnalytics } from "../../components/analytics";
import AiEditPanelV2 from "../../components/editor/AiEditPanel";
import { PreviewEditorTour } from "../../components/PreviewEditorTour";
import { injectEditableOverlay } from "@/src/lib/klonerIframeRuntime";
import { MetaSettings, UploadedAsset } from "../../components/MetaSettings";
import { AiImageLibraryPanel } from "../../components/AiImageLibraryPanel";
import { IS_MOBILE, sanitizeImageName } from "../../components/helpers";
import MiniToolbar from "../../src/lib/miniToolbarV2";
import FloatingBlockToolbar from "../../src/lib/floatingToolbar";

function formatSnapshotTime(ts: number) {
    try {
        const d = new Date(ts);
        return d.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return "";
    }
}

function formatSnapshotLabel(snap: DraftSnapshot): string {
    const when = formatSnapshotTime(snap.createdAt);
    if (snap.source === "auto") return `${when} · Autosave`;
    if (snap.source === "apply") return `${when} · Applied`;
    return `${when} · Manual`;
}


function deriveRootMetaFromSeoMap(
    seo: SeoMetaByPage | null | undefined
): SeoMeta | undefined {
    if (!seo) return undefined;
    const keys = Object.keys(seo);
    if (!keys.length) return undefined;

    const preferredKey =
        keys.find((k) => k === "single" || k === "/" || k === "home") ?? keys[0];

    const base = seo[preferredKey];

    const anyFavicon = Object.values(seo)
        .map((m) => m.faviconUrl?.trim())
        .find((v) => v && v.length > 0);

    if (!anyFavicon || base.faviconUrl?.trim()) {
        return base;
    }

    return {
        ...base,
        faviconUrl: anyFavicon,
    };
}

export function buildSeoMetaMapForExport(
    byPage: SeoMetaByPage | null | undefined
): SeoMetaMap | undefined {
    if (!byPage || !Object.keys(byPage).length) return undefined;

    const out: SeoMetaMap = {};
    for (const [key, value] of Object.entries(byPage)) {
        out[key] = {
            title: value.title ?? "",
            description: value.description ?? "",
            jsonLd: (value as any).jsonLd ?? null,
        };
    }
    return out;
}

// ───────── NEW: buildFinalExport that fetches meta from Firestore ─────────

// same as before, just showing signature and call style

export async function buildFinalExport(opts: {
    html: string;
    user: FirebaseUser | null;
    draftId?: string | null;
    fallbackSeoMetaByPage?: SeoMetaByPage | null;
}): Promise<string> {
    const { html, user, draftId, fallbackSeoMetaByPage } = opts;

    if (!html) return html;

    let seoFromDb: SeoMetaByPage | null = null;

    if (user && draftId) {
        try {
            const ref = doc(db, "kloner_users", user.uid, "kloner_renders", draftId);
            const snap = await getDocFromServer(ref);

            if (snap.exists()) {
                const data = snap.data() as RenderDoc;
                const fromDb = data.seoMetaByPage as SeoMetaByPage | undefined;
                if (fromDb && Object.keys(fromDb).length > 0) {
                    seoFromDb = fromDb;
                }
            }
        } catch (e) {
            console.error(
                "buildFinalExport: failed to load seoMetaByPage from Firestore",
                { draftId, error: e }
            );
        }
    }

    const mergedSeo: SeoMetaByPage | null =
        seoFromDb && Object.keys(seoFromDb).length > 0
            ? seoFromDb
            : fallbackSeoMetaByPage && Object.keys(fallbackSeoMetaByPage).length > 0
                ? fallbackSeoMetaByPage
                : null;

    const rootMeta = deriveRootMetaFromSeoMap(mergedSeo);

    // Only build this if we actually have a map
    const metaByRoute: SeoMetaMap | undefined = mergedSeo
        ? buildSeoMetaMapForExport(mergedSeo)
        : undefined;

    // 1) scrub + apply base SEO (home/global meta + favicon)
    let out = sanitizeExportHtml(html, rootMeta);

    // 2) If we have per-route SEO, attach data-meta-* and JSON-LD
    if (metaByRoute) {
        out = applySeoMetaToHtml(out, metaByRoute);
        out = injectJsonLdGraph(out, metaByRoute);
    }

    // 3) detect multi-page & inject router
    const hasMultiPage =
        out.includes('class="page-root"') &&
        out.includes("data-route=");

    const withRouter = hasMultiPage ? injectClientRouter(out) : out;

    return withRouter;
}


function injectClientRouter(html: string): string {
    if (!html) return html;

    let out = html; // NO stripping here

    const routerCss = `
<style id="kloner-active-route">
  main.page-root { display: none !important; }
  main.page-root.is-active { display: block !important; }
</style>`.trim();

    const routerScript = `
<script>
(function () {
  function normalizePath(path) {
    if (!path) return "/";
    try {
      var url = new URL(path, window.location.origin);
      path = url.pathname;
    } catch (e) {}
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    return path || "/";
  }

  function updateHeadFromPage(pageEl) {
    if (!pageEl) return;

    var metaTitle = pageEl.getAttribute("data-meta-title");
    var metaDesc = pageEl.getAttribute("data-meta-description");

    // Title
    if (metaTitle && typeof metaTitle === "string") {
      document.title = metaTitle;
    }

    // Description
    if (metaDesc && typeof metaDesc === "string") {
      var descTag = document.querySelector('meta[name="description"]');
      if (!descTag) {
        descTag = document.createElement("meta");
        descTag.setAttribute("name", "description");
        document.head.appendChild(descTag);
      }
      descTag.setAttribute("content", metaDesc);
    }
  }

  function setActiveRoute(path) {
    path = normalizePath(path);
    var pages = document.querySelectorAll("main.page-root");
    var found = false;
    var activePage = null;

    pages.forEach(function (el) {
      var route = normalizePath(el.getAttribute("data-route") || "/");
      if (route === path) {
        el.classList.add("is-active");
        found = true;
        activePage = el;
      } else {
        el.classList.remove("is-active");
      }
    });

    if (!found) {
      pages.forEach(function (el) {
        var route = normalizePath(el.getAttribute("data-route") || "/");
        var isHome = route === "/";
        el.classList.toggle("is-active", isHome);
        if (isHome) activePage = el;
      });
    }

    updateHeadFromPage(activePage);
  }

  // Initial load
  setActiveRoute(window.location.pathname);

  document.addEventListener("click", function (e) {
    var link = e.target.closest("a[href]");
    if (!link) return;

    var href = link.getAttribute("href") || "";
    if (!href.startsWith("/")) return;
    if (href.startsWith("//")) return;
    if (href.startsWith("/api")) return;

    e.preventDefault();

    var url = new URL(href, window.location.origin);
    var pathname = normalizePath(url.pathname);
    window.history.pushState({}, "", pathname);
    setActiveRoute(pathname);
  });

  window.addEventListener("popstate", function () {
    setActiveRoute(window.location.pathname);
  });
})();
</script>`.trim();

    if (out.includes("</head>")) {
        out = out.replace("</head>", routerCss + "\n</head>");
    } else if (out.includes("<head>")) {
        out = out.replace("<head>", "<head>\n" + routerCss + "\n");
    } else {
        out = routerCss + "\n" + out;
    }

    if (out.includes("</body>")) {
        out = out.replace("</body>", routerScript + "\n</body>");
    } else {
        out = out + "\n" + routerScript;
    }

    return out;
}

export type SeoMetaMap = Record<
    string,
    {
        title: string;
        description: string;
        jsonLd: any;
    }
>;


type StyleCmd =
    | { kind: "fontFamily"; value: string }
    | { kind: "fontSizePx"; value: number }
    | { kind: "align"; value: "left" | "center" | "right" }
    | { kind: "textColor"; value: string }
    | { kind: "bgColor"; value: string }
    | { kind: "transform"; value: "none" | "uppercase" }
    | { kind: "weight"; value: string | number }
    | { kind: "letterSpacing"; value: string }
    | { kind: "widthPreset"; value: "auto" | "narrow" | "wide" | "full" }
    | { kind: "imageWidthPx"; value: number }          // NEW
    | { kind: "blockAlign"; value: "left" | "center" | "right" }
    | { kind: "marginTop"; value: "none" | "sm" | "md" | "lg" }
    | { kind: "marginBottom"; value: "none" | "sm" | "md" | "lg" }
    | { kind: "wrap"; value: "normal" | "nowrap" | "balance" };


// derive human label from route
function labelFromRoute(route: string): string {
    if (!route || route === "/") return "Home";

    const clean = route.replace(/^\//, "");
    if (!clean) return "Home";

    return clean
        .split(/[/-]/g)
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ");
}


// derive pages from a monolithic HTML with <main class="page-root" data-route="...">
function derivePagesFromHtml(html: string): EditorPage[] {
    if (typeof window === "undefined") return [];
    try {
        const cleaned = stripScripts(stripEditorArtifacts(html));
        const parser = new DOMParser();
        const doc = parser.parseFromString(cleaned, "text/html");
        const mains = Array.from(
            doc.querySelectorAll("main.page-root[data-route]")
        ) as HTMLElement[];

        if (!mains.length) return [];

        return mains.map((el) => {
            const route = el.getAttribute("data-route") || "/";
            const labelAttr = el.getAttribute("data-label") || "";
            const label = labelAttr || labelFromRoute(route);
            return {
                id: route,
                label,
                html,
            };
        });
    } catch {
        return [];
    }
}

type DerivedTheme = {
    textColors: string[];
    bgColors: string[];
    fontFamilies: string[];
};

type SidePanelMode = "style" | "meta" | "ai-library" | "code" | "revision-chat";


export type SeoMetaByPage = Record<string, SeoMeta>;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    let h = hex.replace("#", "").trim();
    if (h.length === 3) {
        h = h
            .split("")
            .map((ch) => ch + ch)
            .join("");
    }
    if (h.length !== 6) return null;
    const num = parseInt(h, 16);
    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255,
    };
}

function luminance(hex: string): number {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;
    const norm = ["r", "g", "b"].map((k) => {
        let v = (rgb as any)[k] / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    // relative luminance
    return 0.2126 * norm[0] + 0.7152 * norm[1] + 0.0722 * norm[2];
}

function deriveThemeFromInitialHtml(html: string | undefined | null): DerivedTheme {
    if (!html) return { textColors: [], bgColors: [], fontFamilies: [] };

    const hexRe = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
    const fontRe = /font-family\s*:\s*([^;]+);?/gi;

    const colorSet = new Set<string>();
    let m: RegExpExecArray | null;

    while ((m = hexRe.exec(html))) {
        const c = m[0].toLowerCase();
        colorSet.add(c);
    }

    const allColors = Array.from(colorSet);

    // classify: darker → text, lighter → background (rough cut)
    const textColors: string[] = [];
    const bgColors: string[] = [];

    for (const c of allColors) {
        const L = luminance(c);
        if (L <= 0.5) textColors.push(c);
        else bgColors.push(c);
    }

    // cap counts so the UI doesn’t explode
    const textColorsTrimmed = textColors.slice(0, 10);
    const bgColorsTrimmed = bgColors.slice(0, 10);

    // fonts
    const fontSet = new Set<string>();
    while ((m = fontRe.exec(html))) {
        const decl = m[1];
        const families = decl.split(",").map((p) =>
            p.trim().replace(/^["']|["']$/g, "")
        );
        for (const fam of families) {
            const lower = fam.toLowerCase();
            if (!fam) continue;
            if (
                lower === "sans-serif" ||
                lower === "serif" ||
                lower === "monospace" ||
                lower === "system-ui"
            ) {
                continue;
            }
            fontSet.add(fam);
        }
    }

    const fontFamilies = Array.from(fontSet).slice(0, 8);

    return {
        textColors: textColorsTrimmed,
        bgColors: bgColorsTrimmed,
        fontFamilies,
    };
}

interface AiEditSuggestion { createdAt: string, afterHtml: string, id: string; renderId: string; prompt: string; summary: string; beforeHtml: string; }

type DraftSnapshotSource = "manual" | "auto" | "before-ai" | "apply" | "ai-edit";

type DraftSnapshot = {
    id: string;
    createdAt: number;
    html: string;
    source: DraftSnapshotSource;
    summary?: string;
    prompt?: string;
};

const SINGLE_PAGE_KEY = "__single__";

export default function PreviewEditorV2({
    initialHtml,
    sourceImage,
    onClose,
    onExport,
    draftId,
    saveDraft,
    onLiveHtml,
    pages,
    initialPageId,
    onPageHtmlChange,
    initialArchivedPageIds,
    initialSeoMeta,
    onSaveMeta,
    initialSeoMetaByPage,
    onArchivedPageIdsChange,
    isAdmin = false,
}: Props) {
    const { user } = useAuth();
    const isDevCodeMode = process.env.NODE_ENV === "development";
    const [nameHint, setNameHint] = useState<string>("");
    const [version, setVersion] = useState<number>(1);
    const [mode, setMode] = useState<ViewMode>("preview");
    const [device, setDevice] = useState<Device>("desktop");
    const [dirty, setDirty] = useState(false);
    const [savingDraft, setSavingDraft] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [exportNote, setExportNote] = useState<string>("");
    const [applyingPreview, setApplyingPreview] = useState(false);
    const [closing, setClosing] = useState(false);
    const [closePrompt, setClosePrompt] = useState(false);
    const [exportPrompt, setExportPrompt] = useState(false);
    const [controlsCollapsed, setControlsCollapsed] = useState<boolean>(false);
    const [sidePanelMode, setSidePanelMode] = useState<
        "style" | "meta" | "code" | "ai-library" | "revision-chat"
    >("revision-chat");
    const [htmlDraft, setHtmlDraft] = useState<string>("");
    const [previewHtml, setPreviewHtml] = useState<string>("");
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [iframeKey, setIframeKey] = useState<number>(0);
    const [activePageId, setActivePageId] = useState<string>("");
    const [derivedPages, setDerivedPages] = useState<EditorPage[]>([]);
    const [pageSwitchConfirm, setPageSwitchConfirm] = useState<{ targetId: string } | null>(null);
    const [aiPreviewHtml, setAiPreviewHtml] = useState<string | null>(null);
    const [showSaveNudge, setShowSaveNudge] = useState(false);
    const [saveNudgeArmed, setSaveNudgeArmed] = useState(false);

    const [aiHistory, setAiHistory] = useState<AiEditSuggestion[]>([]);
    const [historyOpen, setHistoryOpen] = useState(true);
    const [sidebarHidden, setSidebarHidden] = useState(IS_MOBILE ? true : false);
    const [isCompactLayout, setIsCompactLayout] = useState(IS_MOBILE);
    const [mobileTab, setMobileTab] = useState<"preview" | "panel">("preview");
    const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
    // dragging iframe
    const previewDragControls = useDragControls();

    const [isDraggingPreview, setIsDraggingPreview] = useState(false);

    // 1) Per-session counters
    const sessionCountersRef = useRef<EditorSessionCounters>({
        save: 0,
        export: 0,
        autosave: 0,
        pageSwitch: 0,
        deviceSwitch: 0,
        modeSwitch: 0,
        archive: 0,
        restore: 0,
        historyRestore: 0,
        historyClear: 0,
        historyDelete: 0,
        aiEdit: 0,
        aiApply: 0,
        aiMiniToolbar: 0,
    });

    // Debug: see bumps in dev
    function bumpSessionCounter<K extends keyof EditorSessionCounters>(key: K) {
        const prev = sessionCountersRef.current[key] ?? 0;
        const next = prev + 1;
        sessionCountersRef.current[key] = next;

        if (process.env.NODE_ENV === "development") {
            // This should spam when you hit save / switch page / etc.
            console.log("[editor-analytics] bump", key, "->", next);
        }
    }

    // 2) Keep the latest user in a ref so we don't depend on [user]
    const sessionUserRef = useRef<EditorSessionUser>(user);
    useEffect(() => {
        sessionUserRef.current = user;
    }, [user]);

    // Tour message listener
    useEffect(() => {
        const handleTourMessage = (event: MessageEvent) => {
            if (event.data?.type === "kloner:tour-show-style-panel") {
                setSidePanelMode("style");
                setSidebarHidden(false);
                setMobileTab("panel");
            } else if (event.data?.type === "kloner:tour-show-ai-panel") {
                setSidePanelMode("revision-chat");
                setSidebarHidden(false);
                setMobileTab("panel");
            }
        };
        
        window.addEventListener("message", handleTourMessage);
        return () => window.removeEventListener("message", handleTourMessage);
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const mq = window.matchMedia("(max-width: 767px)");
        const update = () => setIsCompactLayout(Boolean(mq.matches));
        update();

        if (typeof mq.addEventListener === "function") {
            mq.addEventListener("change", update);
            return () => mq.removeEventListener("change", update);
        }

        const legacyMq = mq as MediaQueryList & {
            addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
            removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
        };
        legacyMq.addListener?.(update);
        return () => legacyMq.removeListener?.(update);
    }, []);

    useEffect(() => {
        if (!isCompactLayout) {
            setMobileControlsOpen(false);
            return;
        }
        setMobileTab("preview");
    }, [isCompactLayout]);

    // 3) Timing + flush guards
    const sessionStartRef = useRef<number | null>(null);
    const sessionFlushedRef = useRef(false);

    // 4) Session timing + flush effect (runs once per mount)
    useEffect(() => {
        // start timing when editor mounts
        sessionStartRef.current = Date.now();
        sessionFlushedRef.current = false;

        // reset counters each mount so this session is isolated
        sessionCountersRef.current = {
            save: 0,
            export: 0,
            autosave: 0,
            pageSwitch: 0,
            deviceSwitch: 0,
            modeSwitch: 0,
            archive: 0,
            restore: 0,

            historyRestore: 0,
            historyClear: 0,
            historyDelete: 0,

            aiEdit: 0,
            aiApply: 0,
            aiMiniToolbar: 0,
        };

        const flushSession = (reason: string) => {
            if (sessionFlushedRef.current) return;
            sessionFlushedRef.current = true;

            const start = sessionStartRef.current ?? Date.now();
            const durationMs = Date.now() - start;
            const counters = sessionCountersRef.current;
            const u = sessionUserRef.current;

            if (!u?.uid) {
                if (process.env.NODE_ENV === "development") {
                    console.log(
                        "[editor-analytics] flush skipped (no user)",
                        reason,
                        counters,
                        durationMs,
                    );
                }
                return;
            }

            if (process.env.NODE_ENV === "development") {
                console.log("[editor-analytics] flushing session", {
                    reason,
                    durationMs,
                    counters,
                });
            }

            // fire-and-forget; must not block navigation
            void recordEditorSessionAnalytics(u, durationMs, reason, counters);
        };

        const handleBeforeUnload = () => flushSession("beforeunload");

        const handleVisibilityChange = () => {
            if (document.visibilityState === "hidden") {
                flushSession("visibility_hidden");
            }
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
            document.removeEventListener("visibilitychange", handleVisibilityChange);

            // catch route change / modal close / unmount
            flushSession("unmount");
        };
    }, []); // IMPORTANT: run once per mount, not on [user]


    useEffect(() => {
        const handlePointerUp = () => {
            // Any pointer release ends drag and re-enables iframe events
            setIsDraggingPreview(false);
        };

        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);

        return () => {
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
        };
    }, []);

    useEffect(() => {
        if (!previewDragControls) return;

        const handlePointerUp = (event: PointerEvent | MouseEvent | TouchEvent) => {
            try {
                // Hard stop any active drag on pointer release anywhere
                // DragControls may not expose stop() in the TS type for some versions,
                // so call it dynamically via any to avoid a compile error.
                (previewDragControls as any).stop?.(event as any);
            } catch {
                // ignore – stop() is safe to call even if nothing is dragging
            }
        };

        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        window.addEventListener("mouseup", handlePointerUp);
        window.addEventListener("touchend", handlePointerUp);

        return () => {
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
            window.removeEventListener("mouseup", handlePointerUp);
            window.removeEventListener("touchend", handlePointerUp);
        };
    }, [previewDragControls]);


    // Custom colors
    const [customTextColor, setCustomTextColor] = useState<string>("#000000");
    const [customBgColor, setCustomBgColor] = useState<string>("#ffffff");
    const [selectionMeta, setSelectionMeta] = useState<SelectionMeta>({ has: false });
    const [lastSelectedPath, setLastSelectedPath] = useState(null);
    const [archivedPageIds, setArchivedPageIds] = useState<string[]>([]);
    const [showPageLayers, setShowPageLayers] = useState(false);

    // inside your component body
    const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);

    const togglePreviewFullscreen = () => {
        setIsPreviewFullscreen((prev) => !prev);
    };

    useEffect(() => {
        const win = iframeRef.current?.contentWindow as any;
        if (!win?.__klonerApi?.setDevice) return;
        try {
            win.__klonerApi.setDevice(device);
        } catch {
            // ignore
        }
    }, [device]);

    useEffect(() => {
        if (Array.isArray(initialArchivedPageIds)) {
            const next = initialArchivedPageIds.filter(
                (v) => typeof v === "string" && v.trim().length > 0
            );
            setArchivedPageIds(next);
        } else {
            setArchivedPageIds([]);
        }
    }, [initialArchivedPageIds]);

    function pushArchivedIds(updater: (prev: string[]) => string[]) {
        setArchivedPageIds((prev) => {
            const next = updater(prev);
            if (onArchivedPageIdsChange) {
                onArchivedPageIdsChange(next);
            }
            return next;
        });
        bumpSessionCounter("archive");
    }

    function archivePageInHtmlById(html: string, pageId: string): string {
        if (!html) return html;
        if (typeof window === "undefined" || typeof DOMParser === "undefined") return html;

        const normalizeRoute = (r: string) => {
            const s = (r || "").trim();
            if (!s) return s;
            return s.startsWith("/") ? s : `/${s}`;
        };

        const archivedRoute = normalizeRoute(pageId);

        const hrefTargetsArchivedRoute = (hrefRaw: string | null) => {
            const href = (hrefRaw || "").trim();
            if (!href) return false;

            if (href.startsWith("#")) return false;
            if (/^(mailto:|tel:|javascript:)/i.test(href)) return false;

            // absolute URL
            if (/^https?:\/\//i.test(href)) {
                try {
                    const u = new URL(href);
                    const p = normalizeRoute(u.pathname || "");
                    return p === archivedRoute || p.startsWith(archivedRoute + "/");
                } catch {
                    return false;
                }
            }

            // relative/path URL
            const clean = href.split(/[?#]/)[0] || href;
            const p = normalizeRoute(clean);
            return p === archivedRoute || p.startsWith(archivedRoute + "/");
        };

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            // Remove the route-filtering CSS that conflicts with archive display logic
            const routeStyle = doc.querySelector('style#kloner-active-route');
            if (routeStyle) routeStyle.remove();

            // Archive the page content node(s)
            const nodes = doc.querySelectorAll<HTMLElement>(`main.page-root[data-route="${archivedRoute}"]`);
            if (nodes.length === 0) {
                console.warn(`[archivePageInHtmlById] No page found with route: ${archivedRoute}`);
                return html;
            }

            nodes.forEach((node) => {
                node.setAttribute("data-kloner-archived", "1");
                node.style.setProperty("display", "none", "important");
            });

            // Block navigation to the archived route
            const anchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"));
            anchors.forEach((a) => {
                const href = a.getAttribute("href");
                if (!hrefTargetsArchivedRoute(href)) return;

                if (!a.hasAttribute("data-kloner-orig-href")) {
                    a.setAttribute("data-kloner-orig-href", href || "");
                }

                a.setAttribute("data-kloner-nav-blocked", "1");
                a.setAttribute("data-kloner-blocked-route", archivedRoute);

                a.setAttribute("aria-disabled", "true");
                a.setAttribute("tabindex", "-1");
                a.setAttribute("href", "#");

                a.style.setProperty("pointer-events", "none", "important");
                a.style.setProperty("cursor", "not-allowed", "important");
                a.style.setProperty("opacity", "0.6", "important");
            });

            return "<!doctype html>\n" + doc.documentElement.outerHTML;
        } catch (err) {
            console.warn("[archivePageInHtmlById] failed", err);
            return html;
        }
    }

    function restorePageInHtmlById(html: string, pageId: string): string {
        if (!html) return html;
        if (typeof window === "undefined" || typeof DOMParser === "undefined") return html;

        const normalizeRoute = (r: string) => {
            const s = (r || "").trim();
            if (!s) return s;
            return s.startsWith("/") ? s : `/${s}`;
        };

        const restoredRoute = normalizeRoute(pageId);

        const isLegacyDisabledLinkForRoute = (a: HTMLAnchorElement) => {
            const href = (a.getAttribute("href") || "").trim();
            const ariaDisabled = (a.getAttribute("aria-disabled") || "").trim() === "true";
            const tabindex = (a.getAttribute("tabindex") || "").trim() === "-1";
            const text = (a.textContent || "").trim().toLowerCase();

            // Your current HTML disables nav items by setting href="#" + aria-disabled/tabindex
            // Legacy fallback: only re-enable if it looks like the nav item for this route.
            if (!(href === "#" && ariaDisabled && tabindex)) return false;

            // If archive wrote a blocked-route marker, prefer that.
            const blockedRoute = (a.getAttribute("data-kloner-blocked-route") || "").trim();
            if (blockedRoute) return normalizeRoute(blockedRoute) === restoredRoute;

            // No marker present (your pasted HTML). Infer from label for common routes.
            const routeLabel = restoredRoute.replace(/^\//, "").trim().toLowerCase(); // "community"
            if (!routeLabel) return false;

            // Match exact word or includes (covers "Community", "Community Builds", etc.)
            return text === routeLabel || text.includes(routeLabel);
        };

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            // Remove the route-filtering CSS that conflicts with restore display logic
            const routeStyle = doc.querySelector('style#kloner-active-route');
            if (routeStyle) routeStyle.remove();

            // Restore the page content node(s)
            const nodes = doc.querySelectorAll<HTMLElement>(`main.page-root[data-route="${restoredRoute}"]`);
            if (nodes.length === 0) {
                console.warn(`[restorePageInHtmlById] No page found with route: ${restoredRoute}`);
                return html;
            }

            nodes.forEach((node) => {
                node.removeAttribute("data-kloner-archived");
                node.style.removeProperty("display");
            });

            // Unblock navigation (new marker-based)
            const blocked = Array.from(
                doc.querySelectorAll<HTMLAnchorElement>(`a[data-kloner-nav-blocked="1"][data-kloner-blocked-route="${restoredRoute}"]`)
            );

            blocked.forEach((a) => {
                const orig = a.getAttribute("data-kloner-orig-href");
                if (orig != null && orig.trim()) {
                    a.setAttribute("href", orig);
                } else {
                    a.setAttribute("href", restoredRoute);
                }

                a.removeAttribute("data-kloner-orig-href");
                a.removeAttribute("data-kloner-nav-blocked");
                a.removeAttribute("data-kloner-blocked-route");

                a.removeAttribute("aria-disabled");
                a.removeAttribute("tabindex");

                a.style.removeProperty("pointer-events");
                a.style.removeProperty("cursor");
                a.style.removeProperty("opacity");
            });

            // Legacy fallback (for HTML like you pasted: disabled links without kloner markers)
            const allAnchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"));
            allAnchors.forEach((a) => {
                if (!isLegacyDisabledLinkForRoute(a)) return;

                a.setAttribute("href", restoredRoute);

                a.removeAttribute("aria-disabled");
                a.removeAttribute("tabindex");

                a.style.removeProperty("pointer-events");
                a.style.removeProperty("cursor");
                a.style.removeProperty("opacity");
            });

            return "<!doctype html>\n" + doc.documentElement.outerHTML;
        } catch (err) {
            console.warn("[restorePageInHtmlById] failed", err);
            return html;
        }
    }

    function archivePage(pageId: string) {
        if (
            !window.confirm(
                "Archive this page? It will be removed from the preview and export, but you can restore it later."
            )
        ) {
            return;
        }

        // update in-editor + propagate up
        pushArchivedIds((prev) =>
            prev.includes(pageId) ? prev : [...prev, pageId]
        );

        setHtmlDraft((prev) => {
            if (!prev) return prev;

            // non-destructive: mark as archived + hide, don't delete
            const next = archivePageInHtmlById(prev, pageId);

            setPreviewHtml(next);
            if (onLiveHtml) onLiveHtml(next);
            setDirty(true);

            return next;
        });
    }


    const restorePage = (pageId: string) => {

        // drop from archive list + propagate up
        pushArchivedIds((prev) => prev.filter((id) => id !== pageId));
        bumpSessionCounter("restore");

        setHtmlDraft((prev) => {
            if (!prev) return prev;
            const next = restorePageInHtmlById(prev, pageId);
            setPreviewHtml(next);
            if (onLiveHtml) onLiveHtml(next);
            setDirty(true);
            return next;
        });
    };


    function aiSuggestionToSnapshot(s: AiEditSuggestion): DraftSnapshot {
        let createdMs: number | null = null;

        if (s.createdAt) {
            const t = new Date(s.createdAt as any).getTime();
            createdMs = Number.isNaN(t) ? null : t;
        }

        return {
            id: `ai-${s.id}`,
            html: s.afterHtml,
            createdAt: createdMs ?? 0, // or keep 0 so unknown ones sink to the bottom
            source: "ai-edit",
            summary: s.summary,
            prompt: s.prompt,
        };
    }


    function applySnapshotHtml(html: string) {
        let cleanedHtml = html;
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            cleanedHtml = snapshotCleanFromDocument(doc);
        } catch (err) {
            console.warn("[PreviewEditor] failed to clean snapshot HTML", err);
        }

        setHtmlDraft(cleanedHtml);
        setPreviewHtml(cleanedHtml);
        setDirty(true);
        if (onLiveHtml) onLiveHtml(cleanedHtml);
    }

    // Dont remove
    const localImageStore: Map<string, File> = new Map();

    // this is used as a “last known good” snapshot for export fallback
    const [activeSeoMetaByPage, setActiveSeoMetaByPage] = useState<
        Record<string, SeoMeta> | null
    >(null);

    function postToEditor(data: any) {
        const iframe = iframeRef.current;
        if (!iframe) return;
        iframe.contentWindow?.postMessage(data, "*");
    }

    function getSelectedBlockHtml(): string | null {
        const iframe = iframeRef.current;
        if (!iframe) return null;

        const doc = iframe.contentDocument;
        if (!doc) return null;

        // prefer live selection path; fall back to lastSelectedPath
        const path =
            (selectionMeta && selectionMeta.path) ||
            lastSelectedPath ||
            null;

        if (path) {
            const elByPath = doc.querySelector(
                `[data-kloner-path="${path}"]`
            ) as HTMLElement | null;
            if (elByPath) return elByPath.outerHTML;
        }

        // final fallback: any hard selection markers you still use
        const el =
            (doc.querySelector("[data-kloner-sel='1']") as HTMLElement | null) ||
            (doc.querySelector("[data-kloner-selected='true']") as HTMLElement | null);

        if (!el) return null;
        return el.outerHTML;
    }

    useEffect(() => {
        if (typeof window === "undefined") return;

        const seen = isDevCodeMode ? false : window.localStorage.getItem(SAVE_NUDGE_KEY) === "1";
        if (!seen) {
            setSaveNudgeArmed(true);
        }
    }, []);


    useEffect(() => {
        if (!saveNudgeArmed) return;
        if (!dirty) return; // no edits yet, nothing to remind

        const timer = window.setTimeout(() => {
            setShowSaveNudge(true);
            setSaveNudgeArmed(false);

            if (typeof window !== "undefined") {
                window.localStorage.setItem(SAVE_NUDGE_KEY, "1");
            }

            // auto-hide after 15s
            window.setTimeout(() => {
                setShowSaveNudge(false);
            }, 10_000); // show for 10 seconds
        }, 120_000); // 2 minutes of editing

        return () => window.clearTimeout(timer);
    }, [dirty, saveNudgeArmed]);


    /**
     * Apply updated block HTML to the currently selected element in the iframe
     * and optionally serialize the full document back to a string.
     *
     * If mutateIframeOnly = true:
     *   - mutate the iframe DOM for visual preview, but do not rely on it as source of truth
     *   - still returns the serialized full HTML so you can feed it into your preview mechanism
     *
     * If mutateIframeOnly = false:
     *   - mutate iframe DOM and use the serialized HTML as new draft + preview
     */
    function applyBlockHtmlToIframeAndSerialize(
        updatedBlockHtml: string,
        mutateIframeOnly: boolean
    ): string | null {
        const iframe = iframeRef.current;
        if (!iframe) return null;

        const doc = iframe.contentDocument;
        if (!doc) return null;

        const path =
            (selectionMeta && selectionMeta.path) ||
            lastSelectedPath ||
            null;

        let targetEl: Element | null = null;

        if (path) {
            targetEl = doc.querySelector(
                `[data-kloner-path="${path}"]`
            );
        }

        if (!targetEl) {
            targetEl =
                doc.querySelector("[data-kloner-selected='true']") ||
                doc.querySelector("[data-kloner-sel='1']");
        }

        if (!targetEl) {
            console.warn("[ai-edit] no selected block found in iframe for replacement");
            return null;
        }

        const range = doc.createRange();
        const fragment = range.createContextualFragment(updatedBlockHtml);
        targetEl.replaceWith(fragment);

        // Serialize full document for preview / commit
        const fullHtml = "<!doctype html>\n" + doc.documentElement.outerHTML;

        // `mutateIframeOnly` is kept for compatibility, but we always
        // return the full HTML so caller can decide what to do with it.
        return fullHtml;
    }



    // make mobile a bit wider
    const devicePx =
        device === "desktop" ? 1440 : device === "tablet" ? 1024 : 600;

    // inside PreviewEditor component

    const emptyMeta: SeoMeta = {
        title: "",
        description: "",
        ogImageUrl: "",
        faviconUrl: "",
    };
    // main SEO map stored for this render
    const [seoMetaByPage, setSeoMetaByPage] = useState<SeoMetaByPage>(() => {
        if (initialSeoMetaByPage && Object.keys(initialSeoMetaByPage).length > 0) {
            return { ...initialSeoMetaByPage };
        }

        const baseKey =
            (initialPageId && initialPageId !== "single" && initialPageId) ||
            SINGLE_PAGE_KEY;

        return {
            [baseKey]: initialSeoMeta ?? emptyMeta,
        };
    });

    const theme = useMemo(
        () => deriveThemeFromInitialHtml(initialHtml),
        [initialHtml],
    );

    const mergedThemeColors = useMemo(
        () => Array.from(new Set([...(theme.textColors || []), ...(theme.bgColors || [])])),
        [theme.textColors, theme.bgColors]
    );

    const [uiScale, setUiScale] = useState<number>(() => {
        if (typeof window === "undefined") return (IS_MOBILE ? 1.05 : 0.70)
        const v = Number(localStorage.getItem("kloner:uiScale"));
        return Number.isFinite(v) && v >= 0.5 && v <= 1.25 ? v : (IS_MOBILE ? 1.05 : 0.70)
    });

    useEffect(() => {
        if (typeof window === "undefined") return;
        localStorage.setItem("kloner:uiScale", String(uiScale));
    }, [uiScale]);


    // derive pages from initialHtml once
    useEffect(() => {
        if (pages && pages.length) {
            setDerivedPages([]);
            return;
        }
        const derived = derivePagesFromHtml(initialHtml);
        setDerivedPages(derived);
    }, [initialHtml, pages]);




    // keyboard zoom shortcuts
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            if (e.key === "-" || e.key === "_") {
                e.preventDefault();
                setUiScale((s) => Math.max(0.5, +(s - 0.05).toFixed(2)));
            } else if (e.key === "=" || e.key === "+") {
                e.preventDefault();
                setUiScale((s) => Math.min(1.25, +(s + 0.05).toFixed(2)));
            } else if (e.key === "0") {
                e.preventDefault();
                setUiScale(1);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);


    const tryClearIframeSelection = useCallback(() => {
        const win = iframeRef.current?.contentWindow as any;
        try {
            if (win?.__klonerApi?.clear) win.__klonerApi.clear();
            win?.getSelection?.()?.removeAllRanges?.();
            (win?.document?.activeElement as HTMLElement | null)?.blur?.();
        } catch {
            // ignore
        }
    }, []);

    const handleDeviceChange = useCallback(
        (next: Device) => {
            if (device === next) return;

            bumpSessionCounter("deviceSwitch");
            setDevice(next);
            tryClearIframeSelection();
        },
        [device, tryClearIframeSelection],
    );


    // ESC clears iframe selection
    useEffect(() => {
        const esc = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                (document.activeElement as HTMLElement | null)?.blur?.();
                containerRef.current?.focus?.();
                tryClearIframeSelection();
            }
        };
        window.addEventListener("keydown", esc);
        return () => window.removeEventListener("keydown", esc);
    }, [tryClearIframeSelection]);

    const emitLive = useCallback(
        (html: string) => onLiveHtml?.(html),
        [onLiveHtml]
    );


    // DRAFT & LOCAL STORAGE (render-scoped, timestamped, revert-focused)

    const MAX_HISTORY_SNAPSHOTS = 40;

    // v2 envelopes (so you never accidentally treat valid data as legacy)
    type V2CurrentDraft = { v: 2; html: string; updatedAt: number };
    type V2History = { v: 2; items: DraftSnapshot[]; updatedAt: number };

    const safeJsonParse = <T,>(s: string | null): T | null => {
        if (!s) return null;
        try {
            return JSON.parse(s) as T;
        } catch {
            return null;
        }
    };

    // Render-scoped keys so drafts/history never bleed across previews
    const CURRENT_DRAFT_KEY = (renderId?: string | null) =>
        `kloner:render:${renderId || "__anonymous"}:currentHtml`;

    const HISTORY_KEY = (renderId?: string | null) =>
        `kloner:render:${renderId || "__anonymous"}:history`;

    // --- state ---
    const [history, setHistory] = useState<DraftSnapshot[]>([]);
    const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

    // ✅ hydration gate so we NEVER overwrite stored history with [] on first mount
    const [lsReady, setLsReady] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (!draftId) return;

        setLsReady(false);

        const LEGACY_HISTORY_KEY = (id: string) => `kloner:draftHistory:${id}`;
        const LEGACY_CURRENT_KEY = (id: string) => `kloner:draft:${id}`;

        const makeId = (createdAt: number) =>
            typeof crypto !== "undefined" && "randomUUID" in crypto
                ? (crypto as any).randomUUID()
                : `${createdAt}-${Math.random().toString(36).slice(2, 8)}`;

        // 1) current html (v2)
        const currentKey = CURRENT_DRAFT_KEY(draftId);
        const current = safeJsonParse<V2CurrentDraft>(localStorage.getItem(currentKey));
        const baseHtml = stripScripts((current?.v === 2 ? current.html : null) || initialHtml || "");

        setHtmlDraft(baseHtml);
        setPreviewHtml(baseHtml);
        setDirty(false);

        // 2) history (v2)
        const hk = HISTORY_KEY(draftId);
        const h = safeJsonParse<V2History>(localStorage.getItem(hk));

        let restored: DraftSnapshot[] =
            h?.v === 2 && Array.isArray(h.items)
                ? h.items
                    .map((s: any) => ({
                        id: String(s?.id || ""),
                        createdAt: Number(s?.createdAt || 0),
                        source: s?.source,
                        html: typeof s?.html === "string" ? s.html : "",
                        summary: s?.summary,
                        prompt: s?.prompt,
                    }))
                    .filter((s) => s.id && s.createdAt && s.html && s.html.trim().length > 0)
                : [];

        // 3) MIGRATE legacy -> v2 (only if v2 history empty)
        if (restored.length === 0) {
            const legacyRaw = localStorage.getItem(LEGACY_HISTORY_KEY(draftId));
            const legacyParsed = safeJsonParse<any>(legacyRaw);

            if (Array.isArray(legacyParsed) && legacyParsed.length) {
                const normalized: DraftSnapshot[] = legacyParsed
                    .map((s: any) => {
                        const html =
                            (typeof s?.html === "string" && s.html) ||
                            (typeof s?.value === "string" && s.value) ||
                            (typeof s?.content === "string" && s.content) ||
                            "";

                        const createdAt =
                            Number(s?.createdAt) ||
                            Number(s?.updatedAt) ||
                            Number(s?.savedAt) ||
                            Number(s?.ts) ||
                            0;

                        const trimmed = (html || "").trim();
                        if (!trimmed) return null;

                        const id = typeof s?.id === "string" && s.id ? s.id : makeId(createdAt || Date.now());
                        const source = s?.source || "auto";

                        return {
                            id,
                            createdAt: createdAt || Date.now(),
                            source,
                            html: trimmed,
                            summary: s?.summary,
                            prompt: s?.prompt,
                        } as any;
                    })
                    .filter(Boolean) as DraftSnapshot[];

                normalized.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                restored = normalized.slice(0, MAX_HISTORY_SNAPSHOTS);

                setHistory(restored);
                setActiveHistoryId(restored[0]?.id || null);

                // persist as v2 immediately
                const payload: V2History = { v: 2, items: restored, updatedAt: Date.now() };
                try {
                    localStorage.setItem(hk, JSON.stringify(payload));
                    localStorage.removeItem(LEGACY_HISTORY_KEY(draftId));
                } catch { }

                setLsReady(true);
                return;
            }

            // 4) If there is no legacy history, but there is legacy current, seed from that
            const legacyCurrent = localStorage.getItem(LEGACY_CURRENT_KEY(draftId));
            const seedHtml = (legacyCurrent || baseHtml || "").trim();

            if (seedHtml) {
                const createdAt = Number(current?.updatedAt) || Date.now();
                const seedId = `seed-${createdAt}`;

                const seed: DraftSnapshot = {
                    id: seedId,
                    createdAt,
                    source: "auto",
                    html: seedHtml,
                    summary: undefined,
                    prompt: undefined,
                } as any;

                restored = [seed];

                setHistory(restored);
                setActiveHistoryId(seedId);

                const payload: V2History = { v: 2, items: restored, updatedAt: Date.now() };
                try {
                    localStorage.setItem(hk, JSON.stringify(payload));
                } catch { }

                setLsReady(true);
                return;
            }
        }

        restored.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const capped = restored.slice(0, MAX_HISTORY_SNAPSHOTS);

        setHistory(capped);
        setActiveHistoryId(capped[0]?.id || null);

        setLsReady(true);
    }, [draftId, initialHtml]);

    // persist monolithic draft (current) to localStorage (THIS render only) (v2)
    // ✅ gated so hydration never overwrites stored values
    useEffect(() => {
        if (typeof window === "undefined") return;
        if (!draftId) return;
        if (!lsReady) return;

        const currentKey = CURRENT_DRAFT_KEY(draftId);
        const payload: V2CurrentDraft = { v: 2, html: htmlDraft, updatedAt: Date.now() };

        try {
            localStorage.setItem(currentKey, JSON.stringify(payload));
        } catch { }

        setDirty(true);
    }, [htmlDraft, draftId, lsReady]);

    // persist history array to localStorage (THIS render only) (v2)
    // ✅ gated so hydration never overwrites stored values
    useEffect(() => {
        if (typeof window === "undefined") return;
        if (!draftId) return;
        if (!lsReady) return;

        const hk = HISTORY_KEY(draftId);
        const payload: V2History = {
            v: 2,
            items: history.slice(0, MAX_HISTORY_SNAPSHOTS),
            updatedAt: Date.now(),
        };

        try {
            localStorage.setItem(hk, JSON.stringify(payload));
        } catch { }
    }, [history, draftId, lsReady]);

    // ---------- snapshot helper for saving/exporting ----------
    const snapshotFromIframeOrDraft = useCallback(() => {
        if (mode === "code") return htmlDraft;

        const doc = iframeRef.current?.contentDocument;
        if (!doc) return htmlDraft;

        try {
            const htmlEl = doc.documentElement;
            if (!htmlEl) return htmlDraft;
            const raw = "<!doctype html>\n" + htmlEl.outerHTML;
            return stripEditorArtifacts(raw);
        } catch {
            return htmlDraft;
        }
    }, [htmlDraft, mode]);

    function addSnapshot(opts: { html: string; source: DraftSnapshotSource; createdAt?: number }) {
        const trimmed = (opts.html || "").trim();
        if (!trimmed) return;

        const createdAt = typeof opts.createdAt === "number" ? opts.createdAt : Date.now();
        const id =
            typeof crypto !== "undefined" && "randomUUID" in crypto
                ? (crypto as any).randomUUID()
                : `${createdAt}-${Math.random().toString(36).slice(2, 8)}`;

        setHistory((prev): DraftSnapshot[] => {
            const last = prev[0];
            if (last && last.html === trimmed) return prev;

            const next: DraftSnapshot[] = [
                {
                    id,
                    createdAt,
                    source: opts.source,
                    html: trimmed,
                    summary: undefined,
                    prompt: undefined,
                } as any,
                ...prev,
            ];

            const capped =
                next.length > MAX_HISTORY_SNAPSHOTS
                    ? next.slice(0, MAX_HISTORY_SNAPSHOTS)
                    : next;

            setActiveHistoryId(id);

            return capped;
        });
    }

    // ✅ NEW: delete one history item (and keep activeId sane)
    const deleteHistoryItem = useCallback(
        (id: string) => {
            if (!id) return;

            setHistory((prev) => {
                const next = prev.filter((s) => s.id !== id);

                // if you deleted the active one, fall back to newest remaining
                setActiveHistoryId((cur) => {
                    if (cur !== id) return cur;
                    return next[0]?.id || null;
                });

                bumpSessionCounter?.("historyDelete");
                return next;
            });
        },
        [bumpSessionCounter]
    );

    // ✅ NEW: clear all history for this render (optional, but useful)
    const clearHistory = useCallback(() => {
        setHistory([]);
        setActiveHistoryId(null);
        bumpSessionCounter?.("historyClear");
    }, [bumpSessionCounter]);

    // KEEP: snapshotDraft (wrapper that captures html then calls addSnapshot)
    const snapshotDraft = useCallback(
        (source: DraftSnapshotSource) => {
            const html = snapshotFromIframeOrDraft();
            if (!html) return;
            addSnapshot({ html, source });
        },
        [snapshotFromIframeOrDraft]
    );

    // autosave snapshots (fallback revert points)
    useEffect(() => {
        if (!draftId) return;
        if (typeof window === "undefined") return;
        if (!lsReady) return;

        const intervalMs = 60_000;
        const id = window.setInterval(() => {
            snapshotDraft("auto");
            bumpSessionCounter("autosave");
        }, intervalMs);

        return () => window.clearInterval(id);
    }, [draftId, snapshotDraft, lsReady]);

    // KEEP: restore behavior (this is the whole point of the fallback)
    const handleRestoreSnapshot = useCallback(
        (snap: DraftSnapshot) => {
            if (!snap?.html) return;

            setHtmlDraft(snap.html);
            setPreviewHtml(snap.html);
            emitLive(snap.html);

            setDirty(false);
            setActiveHistoryId(snap.id);

            bumpSessionCounter("historyRestore");
        },
        [emitLive]
    );

    // KEEP: applyDraftToPreview (and snapshot "apply" as a revert point)
    function applyDraftToPreview() {
        if (applyingPreview) return;

        setApplyingPreview(true);

        const nextHtml = htmlDraft;

        setPreviewHtml(nextHtml);
        emitLive(nextHtml);
        setDirty(false);

        snapshotDraft("apply");

        window.setTimeout(() => {
            setApplyingPreview(false);
        }, 450);
    }

    // merge local history only (AI suggestions are shown in the AI panel, not the main history list)
    const mergedHistory: DraftSnapshot[] = useMemo(() => {
        const merged: DraftSnapshot[] = [...history];
        merged.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return merged;
    }, [history]);

    function HistoryPanel(props: {
        snapshots: DraftSnapshot[];
        onRestore: (snap: DraftSnapshot) => void;
        activeId: string | null;
        onDelete: (id: string) => void;
        onClearAll?: () => void;
    }) {
        const { snapshots, onRestore, activeId, onDelete, onClearAll } = props;

        if (!snapshots.length) {
            return (
                <div className="text-sm text-gray-500 bg-white">
                    No history yet. Autosaves and applied versions will appear here.
                </div>
            );
        }

        const ordered = [...snapshots].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        return (
            <div className="flex flex-col gap-2 text-md bg-white">
                <div className="flex items-center justify-between px-2">
                    <span className="text-[13px] font-semibold tracking-widest text-gray-500 uppercase">
                        Click to Revert
                    </span>

                    {onClearAll ? (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onClearAll();
                            }}
                            className="text-[13px] font-semibold text-gray-500 hover:text-gray-800"
                            title="Clear history"
                        >
                            Clear
                        </button>
                    ) : null}
                </div>

                {/* Static-height scroll container */}
                <div className="rounded-md border border-gray-200 max-h-[620px] overflow-y-auto overscroll-contain">
                    {ordered.map((snap) => {
                        const isActive = !!activeId && snap.id === activeId;

                        return (
                            <div
                                key={snap.id}
                                className={["border-b px-3 border-gray-100", isActive ? "bg-[#C6F44D]/20" : ""].join(" ")}
                            >
                                <button
                                    type="button"
                                    onClick={() => onRestore(snap)}
                                    className={[
                                        "w-full text-left px-5 py-2 focus:outline-none",
                                        isActive ? "" : "hover:bg-gray-50 focus:bg-gray-100",
                                    ].join(" ")}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-semibold text-[13px] uppercase tracking-wide text-gray-600">
                                            {snap.source === "auto"
                                                ? "Autosave"
                                                : snap.source === "apply"
                                                    ? "Applied"
                                                    : snap.source === "ai-edit"
                                                        ? "AI change"
                                                        : "Manual save"}
                                        </span>

                                        <span className="text-[13px] text-gray-500">
                                            {formatSnapshotTime(snap.createdAt)}
                                        </span>
                                    </div>

                                    <p className="mt-0.5 line-clamp-2 text-[13px] text-gray-500">
                                        {formatSnapshotLabel(snap)}
                                    </p>
                                </button>

                                <div className="flex justify-end px-2 pb-2">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onDelete(snap.id);
                                        }}
                                        className="text-[13px] font-semibold text-gray-500 hover:text-red-600"
                                        title="Delete snapshot"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }


    const [aiEditing, setAiEditing] = useState(false);

    async function doSave(options?: { applyToPreview?: boolean }) {
        if (savingDraft) return;

        if (!draftId) {
            console.error("doSave called without draftId");
            return;
        }

        setSavingDraft(true);

        try {
            const doc = iframeRef.current?.contentDocument ?? document;

            // 1) Upload any local-only images and rewrite DOM src/src-path
            await flushPendingImagesBeforeSave({
                doc,
                draftId,
            });

            // 2) Capture HTML from iframe, without Kloner UI
            const rawHtml = doc
                ? snapshotCleanFromDocument(doc)
                : snapshotFromIframeOrDraft();

            // 3) Apply archive filter: strip all archived pages from the HTML string
            const currentArchivedIds = Array.isArray(archivedPageIds)
                ? archivedPageIds
                : [];

            let nextHtml = rawHtml;
            if (currentArchivedIds.length > 0) {
                for (const pageId of currentArchivedIds) {
                    nextHtml = removePageFromHtmlById(nextHtml, pageId);
                }
            }

            // 4) Update local draft state
            setHtmlDraft(nextHtml);

            // manual snapshot when user hits save
            snapshotDraft("manual");

            // Immediately persist the current draft and a manual-history snapshot
            // to localStorage so manual saves are durable even if the page unloads.
            try {
                const currentKey = CURRENT_DRAFT_KEY(draftId);
                const hk = HISTORY_KEY(draftId);

                const createdAt = Date.now();
                const manualId =
                    typeof crypto !== "undefined" && "randomUUID" in crypto
                        ? (crypto as any).randomUUID()
                        : `${createdAt}-${Math.random().toString(36).slice(2, 8)}`;

                const manualSnap = {
                    id: manualId,
                    createdAt,
                    source: "manual",
                    html: (nextHtml || "").trim(),
                } as any;

                // Persist current draft
                const currentPayload: V2CurrentDraft = {
                    v: 2,
                    html: (nextHtml || "").trim(),
                    updatedAt: Date.now(),
                };

                // Merge into history in localStorage (without waiting for React state)
                const raw = localStorage.getItem(hk);
                let existing: V2History | null = null;
                try {
                    existing = raw ? JSON.parse(raw) as V2History : null;
                } catch { existing = null; }

                const nextItems = [manualSnap].concat(Array.isArray(existing?.items) ? existing!.items : history);

                const nextHistory: V2History = {
                    v: 2,
                    items: nextItems.slice(0, MAX_HISTORY_SNAPSHOTS),
                    updatedAt: Date.now(),
                };

                try {
                    localStorage.setItem(currentKey, JSON.stringify(currentPayload));
                } catch (err: any) {
                    if (err && (err.name === "QuotaExceededError" || err.code === 22)) {
                        try { window.alert("Unable to persist current draft: localStorage quota exceeded."); } catch { }
                    }
                }

                try {
                    localStorage.setItem(hk, JSON.stringify(nextHistory));
                } catch (err: any) {
                    if (err && (err.name === "QuotaExceededError" || err.code === 22)) {
                        try { window.alert("Unable to persist history snapshot: localStorage quota exceeded."); } catch { }
                    }
                }
            } catch (err) {
                console.warn("[PreviewEditor] immediate manual persist failed", err);
            }

            if (!saveDraft) {
                setPreviewHtml(nextHtml);
                if (options?.applyToPreview) {
                    emitLive(nextHtml);
                }
                setDirty(false);
                return;
            }


            // ----- build safe meta (no undefined, correct types) -----
            type SaveDraftMeta = {
                nameHint?: string;
                device: Device;
                mode: ViewMode;
                pageId?: string;
                archivedPageIds?: string[];
            };

            const trimmedNameHint =
                typeof nameHint === "string" ? nameHint.trim() : "";

            const meta: SaveDraftMeta = {
                device: device as Device,
                mode: mode as ViewMode,
            };

            if (trimmedNameHint) {
                meta.nameHint = trimmedNameHint;
            }
            if (activePageId) {
                meta.pageId = activePageId;
            }
            if (currentArchivedIds.length > 0) {
                meta.archivedPageIds = currentArchivedIds;
            }
            // ---------------------------------------------------------

            // 5) Persist to Firestore (or whatever saveDraft does)
            const nextVersion = version + 1;


            await saveDraft({
                draftId,
                html: nextHtml,
                meta,
                version: nextVersion,
            });

            setVersion(nextVersion);
            setPreviewHtml(nextHtml);

            if (options?.applyToPreview) {
                emitLive(nextHtml);
            }

            if (onPageHtmlChange && activePageId) {
                onPageHtmlChange(activePageId, nextHtml);
            }

            setDirty(false);
        } finally {
            setSavingDraft(false);
        }
    }

    // ----------------------
    // NEW PAGE STATE + LOGIC (patched end-to-end)
    // - slug input (NO leading "/"), UI shows "/" prefix
    // - allow nested paths via "/" inside slug (ex: "blog/post")
    // - live validation error shown automatically under input (no infinite loop)
    // - Create button closes modal, sets aiEditing=true during AI work, then false when finished
    // - created pages injected where other route pages live (not after footer)
    // - prevents AI from adding page-level <header>/<footer>
    // - prevents route filtering from hiding global header/footer by hoisting them outside page-root blocks
    // ----------------------

    const [showNewPageModal, setShowNewPageModal] = useState(false);
    const [newPagePrompt, setNewPagePrompt] = useState("");
    const [newPageUrl, setNewPageUrl] = useState(""); // slug/path only (no leading "/"), allows "/" inside
    const [newPageUrlErr, setNewPageUrlErr] = useState<string | null>(null);
    const [creatingPage, setCreatingPage] = useState(false);
    const [createPageErr, setCreatePageErr] = useState<string | null>(null);
    const [createdPages, setCreatedPages] = useState<EditorPage[]>([]);
    const [aiHistoryRefreshNonce, setAiHistoryRefreshNonce] = useState(0);

    const handlePageSwitch = async (nextId: string) => {
        if (!nextId || nextId === activePageId) return;

        bumpSessionCounter("pageSwitch");

        const doc = iframeRef.current?.contentDocument;
        const hasPendingImages = !!doc?.querySelector("img[data-local-image-id]");

        if (hasPendingImages) {
            setPageSwitchConfirm({ targetId: nextId });
            return;
        }

        setActivePageId(nextId);
    };

    // Merge base pages (pages/derivedPages) + createdPages into one list used by UI
    const allPages = useMemo<EditorPage[] | null>(() => {
        const base =
            pages && pages.length
                ? (pages as EditorPage[])
                : derivedPages.length
                    ? (derivedPages as EditorPage[])
                    : null;

        if ((!base || !base.length) && createdPages.length === 0) return null;

        const seen = new Set<string>();
        const out: EditorPage[] = [];

        const push = (p: EditorPage) => {
            const id = String(p?.id || "").trim();
            if (!id || seen.has(id)) return;
            seen.add(id);
            out.push({ id, html: p?.html ?? null } as any);
        };

        (base || []).forEach(push);
        createdPages.forEach(push);

        return out;
    }, [pages, derivedPages, createdPages]);

    const currentPageKey = useMemo(() => {
        if (!allPages || !activePageId || activePageId === "single") {
            return SINGLE_PAGE_KEY;
        }
        return activePageId;
    }, [allPages, activePageId]);

    const currentSeoMeta: SeoMeta = useMemo(() => {
        const base = seoMetaByPage[currentPageKey] ?? emptyMeta;

        if (typeof base.faviconUrl === "string" && base.faviconUrl.trim() !== "") {
            return base;
        }

        const anyFavicon = Object.values(seoMetaByPage).find((m): m is SeoMeta => {
            if (!m || typeof m !== "object") return false;
            const v = (m as SeoMeta).faviconUrl;
            return typeof v === "string" && v.trim() !== "";
        });

        if (!anyFavicon || !anyFavicon.faviconUrl) return base;

        return { ...base, faviconUrl: anyFavicon.faviconUrl };
    }, [seoMetaByPage, currentPageKey]);

    // pick a single renderId to use for Firestore writes / reads
    const resolvedRenderId = draftId ?? null;

    // this now does BOTH: updates local state AND writes to Firestore
    const handleSaveMetaForCurrentPage = useCallback(
        async (meta: SeoMeta) => {
            const rawPageKey =
                currentPageKey && currentPageKey !== "single" ? currentPageKey : SINGLE_PAGE_KEY;

            const pageKey = rawPageKey === "__single__" ? "single" : rawPageKey || "single";

            const faviconUrl = meta.faviconUrl?.trim() || "";

            let next: SeoMetaByPage = {
                ...(seoMetaByPage || {}),
                [pageKey]: meta,
            };

            if (faviconUrl) {
                next = Object.fromEntries(
                    Object.entries(next).map(([key, val]) => [
                        key,
                        key === pageKey ? val : { ...val, faviconUrl },
                    ]),
                ) as SeoMetaByPage;
            }

            if ("__single__" in next) {
                const anyNext: any = next;
                const singleMeta = anyNext.__single__;
                delete anyNext.__single__;
                if (!anyNext.single && singleMeta) anyNext.single = singleMeta;
                next = anyNext;
            }

            setSeoMetaByPage(next);
            setActiveSeoMetaByPage(next);

            if (user && resolvedRenderId) {
                try {
                    const dref = doc(db, "kloner_users", user.uid, "kloner_renders", resolvedRenderId);

                    await updateDoc(dref, {
                        seoMetaByPage: next,
                        updatedAt: serverTimestamp(),
                        jsonLd: meta.jsonLd ?? null,
                    });
                } catch (err) {
                    console.error("[handleSaveMetaForCurrentPage] Failed to persist SEO meta to Firestore", {
                        err,
                        resolvedRenderId,
                    });
                }
            }

            if (onSaveMeta) {
                void onSaveMeta(pageKey === "single" ? null : pageKey, meta, next);
            }
        },
        [currentPageKey, seoMetaByPage, user, resolvedRenderId, onSaveMeta],
    );

    // inject created pages + route-specific CSS into the monolithic HTML for iframe preview
    const renderHtml = useMemo(() => {
        let base = stripScripts(stripEditorArtifacts(previewHtml || ""));
        if (!base) return base;

        // IMPORTANT: keep global header/footer always visible across routes
        base = hoistGlobalHeaderFooter(base);

        // (A) inject created pages into the document so they actually render (always updates)
        if (createdPages.length) {
            const markerStart = `<!-- kloner:created-pages:start -->`;
            const markerEnd = `<!-- kloner:created-pages:end -->`;
            const markerRe = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}\\s*`, "m");

            // strip previous injected block first
            base = base.replace(markerRe, "");

            // ensure we never inject AI header/footer into pages
            const blocks = createdPages
                .map((p) => stripHeaderFooterFromPageBlock((p?.html || "").trim()))
                .filter(Boolean);

            if (blocks.length) {
                const payload = `${markerStart}\n${blocks.join("\n\n")}\n${markerEnd}`;

                // insert payload after the last existing page-root block (where the other pages live)
                const pageBlockRe =
                    /<main\b[^>]*\bclass=["'][^"']*\bpage-root\b[^"']*["'][^>]*\bdata-route=["'][^"']+["'][^>]*>[\s\S]*?<\/main>/gi;

                let last: RegExpExecArray | null = null;
                let m: RegExpExecArray | null;
                while ((m = pageBlockRe.exec(base))) last = m;

                if (last) {
                    const at = (last.index ?? 0) + last[0].length;
                    base = base.slice(0, at) + `\n${payload}\n` + base.slice(at);
                } else {
                    // fallback: before footer if exists, otherwise before </body>
                    const footerIdx = base.search(/<footer\b/i);
                    if (footerIdx >= 0) {
                        base = base.slice(0, footerIdx) + `\n${payload}\n` + base.slice(footerIdx);
                    } else if (base.includes("</body>")) {
                        base = base.replace("</body>", `${payload}\n</body>`);
                    } else {
                        base = `${base}\n${payload}`;
                    }
                }
            }
        }

        // (B) page filtering behavior (unchanged)
        if (!allPages || !activePageId || activePageId === "single") return base;

        const styleTag =
            `<style id="kloner-active-route">` +
            `main.page-root[data-route]{display:none!important;}` +
            `main.page-root[data-route="${activePageId}"]{display:block!important;}` +
            `</style>`;

        if (base.includes("</head>")) return base.replace("</head>", `${styleTag}</head>`);
        if (base.includes("<head>")) return base.replace("<head>", `<head>${styleTag}`);
        return styleTag + base;
    }, [previewHtml, activePageId, allPages, createdPages]);

    useEffect(() => {
        if (mode === "screenshot") return;
        setIframeKey((k) => k + 1);
    }, [renderHtml, mode]);

    useEffect(() => {
        if (!allPages || allPages.length === 0) {
            if (!activePageId) setActivePageId("single");
            return;
        }

        const stillExists = activePageId && allPages.some((p) => p.id === activePageId);
        if (stillExists) return;

        if (initialPageId && allPages.some((p) => p.id === initialPageId)) {
            setActivePageId(initialPageId);
            return;
        }

        setActivePageId(allPages[0].id);
    }, [allPages, activePageId, initialPageId]);

    const activePage = useMemo(
        () => (allPages ? allPages.find((p) => p.id === activePageId) ?? null : null),
        [allPages, activePageId],
    );

    // Set of all IDs across base + created overlay
    const pageIds = useMemo(() => {
        const s = new Set<string>();
        (pages || []).forEach((p: any) => s.add(String(p.id)));
        (derivedPages || []).forEach((p: any) => s.add(String(p.id)));
        createdPages.forEach((p) => s.add(String(p.id)));
        return s;
    }, [pages, derivedPages, createdPages]);

    // Live validation (no loop): only set if value changed
    useEffect(() => {
        const raw = String(newPageUrl || "").trim();
        if (!raw) {
            // don't show an error when the field is empty
            setNewPageUrlErr(null);
            return;
        }

        const v = validatePageSlug(raw);
        const msg = v.ok ? null : v.msg || "Invalid URL.";
        setNewPageUrlErr((prev) => (prev === msg ? prev : msg));
    }, [newPageUrl]);

    const openNewPageModal = useCallback(() => {
        setCreatePageErr(null);
        setNewPagePrompt("");
        setNewPageUrl("");
        setShowNewPageModal(true);
    }, []);

    const closeNewPageModal = useCallback(() => {
        if (creatingPage || aiEditing) return;
        setShowNewPageModal(false);
        setNewPageUrlErr(null)
    }, [creatingPage, aiEditing]);

    const createNewPageWithAi = useCallback(async () => {
        if (creatingPage || aiEditing) return;

        setCreatePageErr(null);

        const promptRaw = (newPagePrompt || "").trim();
        const slugRaw = (newPageUrl || "").trim();


        const v = validatePageSlug(slugRaw);
        if (!v.ok) {
            setCreatePageErr(v.msg || "Invalid URL.");
            return;
        }

        if (!draftId) {
            setCreatePageErr("Missing renderId.");
            return;
        }

        const slug = sanitizePageSlug(slugRaw); // supports nested paths
        const baseId = `/${slug}`;
        const pageId = uniquePageId(baseId, pageIds);

        // required behavior: close modal immediately + aiEditing true
        setShowNewPageModal(false);
        setAiEditing(true);

        setCreatingPage(true);
        try {
            const starterHtml = baseNewPageBlockHtml(pageId);

            // 1) Add new page immediately (starter placeholder)
            setCreatedPages((prev) => [...prev, { id: pageId, html: starterHtml } as any]);

            const csrf = await ensureSessionAndCsrf();

            // 2) Server builds the full expanded prompt (routing + constraints) and generates only the new page block
            const res = await fetch("/api/ai-edit", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                credentials: "include",
                body: JSON.stringify({
                    renderId: draftId,
                    html: starterHtml,
                    mode: "code",
                    action: "create_page",
                    pageId,
                    slug,
                    userPrompt: promptRaw, // raw user prompt ONLY (server must store this, not the expanded prompt)
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.error || `AI failed (${res.status})`);
            }

            const data = await res.json().catch(() => ({}));

            setAiHistoryRefreshNonce((n) => n + 1);

            const suggestion = data?.suggestions && data.suggestions.length ? data.suggestions[0] : null;

            const afterHtml: string | undefined = suggestion?.afterHtml;
            if (!afterHtml || typeof afterHtml !== "string") throw new Error("AI returned no HTML.");

            // 3) Clean model output + hard-enforce same route block
            const cleaned = normalizeAiPageBlock(afterHtml, pageId);

            // 3.1) Enforce minimum structure if model returned hero-only
            // (server already tries to prevent this, but keep client enforcement as a final guard)
            const enforced = enforceMinimumSections(cleaned, pageId);

            // 4) Update only this created page’s HTML (local state)
            setCreatedPages((prev) => {
                const next = prev.slice();
                const idx = next.findIndex((p) => String(p.id) === String(pageId));
                if (idx >= 0) next[idx] = { ...next[idx], html: enforced };
                return next;
            });

            // 4.1) Persist new page into the canonical render doc so refresh works
            // This is the missing piece: without this, your refresh reloads the starter placeholder.
            try {
                // Adjust these imports/paths to match your app
                const [{ auth }, { db }] = await Promise.all([
                    import("@/lib/firebase"), // should export `auth`
                    import("@/lib/firebase"), // should export `db`
                ]);

                const { doc, getDoc, setDoc, updateDoc } = await import("firebase/firestore");

                const uid = auth.currentUser?.uid;
                if (uid) {
                    const renderRef = doc(db as any, "kloner_users", uid, "kloner_renders", draftId);

                    const snap = await getDoc(renderRef);
                    const existing = snap.exists() ? (snap.data() as any) : {};

                    // Canonical storage: pages array
                    const pages: Array<{ id: string; html: string }> = Array.isArray(existing.pages)
                        ? existing.pages
                        : [];

                    const idx = pages.findIndex((p) => String(p?.id) === String(pageId));
                    const nextPages = pages.slice();

                    if (idx >= 0) nextPages[idx] = { ...nextPages[idx], html: enforced };
                    else nextPages.push({ id: pageId, html: enforced });

                    const payload = {
                        pages: nextPages,
                        updatedAt: new Date(),
                    };

                    if (snap.exists()) {
                        await updateDoc(renderRef, payload as any);
                    } else {
                        await setDoc(
                            renderRef,
                            {
                                uid,
                                renderId: draftId,
                                ...payload,
                                createdAt: new Date(),
                            } as any,
                            { merge: true }
                        );
                    }
                }
            } catch (e) {
                // If this fails, UI still updates but refresh will revert to starter placeholder.
                console.error("[createNewPageWithAi] persist failed", e);
            }

            // 5) Navigate to it
            await handlePageSwitch(pageId);

            // 6) Optional save (keep if your app needs it for other state)
            try {
                await doSave?.();
            } catch { }

            // clear inputs for next time
            setNewPagePrompt("");
            setNewPageUrl("");
        } catch (e: any) {
            setCreatePageErr(e?.message || "Failed to create page.");
            // reopen modal so user can see the error + fix inputs
            setShowNewPageModal(true);
        } finally {
            setCreatingPage(false);
            setAiEditing(false);
        }

        function countSectionsInMain(html: string): number {
            const mainMatch = html.match(/<main\b[\s\S]*?<\/main>/i);
            const inside = mainMatch ? mainMatch[0] : html;
            const sections = inside.match(/<section\b/gi);
            return sections ? sections.length : 0;
        }

        function enforceMinimumSections(html: string, pageId: string): string {
            const n = countSectionsInMain(html);
            if (n >= 4) return html;

            const scoped = `main.page-root[data-route="${pageId}"]`;

            const padding = `
<style>
${scoped} .kl-np-wrap{max-width:1100px;margin:0 auto;padding:56px 24px;}
${scoped} .kl-np-hero{padding:48px 0 24px 0;}
${scoped} .kl-np-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px;}
${scoped} .kl-np-card{grid-column:span 6;border:1px solid rgba(0,0,0,.08);border-radius:16px;padding:16px;background:rgba(255,255,255,.7);}
${scoped} .kl-np-card h3{margin:0 0 8px 0;font-size:16px;line-height:1.2;}
${scoped} .kl-np-card p{margin:0;color:rgba(0,0,0,.65);font-size:13px;line-height:1.45;}
${scoped} .kl-np-cta{margin-top:22px;border:1px solid rgba(0,0,0,.10);border-radius:18px;padding:18px;background:rgba(255,255,255,.85);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
${scoped} .kl-np-btn{display:inline-flex;align-items:center;justify-content:center;border-radius:9999px;padding:10px 14px;font-size:13px;font-weight:700;border:1px solid rgba(0,0,0,.12);background:transparent;}
</style>

<div class="kl-np-wrap">
  <section class="kl-np-hero">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;">
      <div style="min-width:240px;">
        <h2 style="margin:0;font-size:34px;line-height:1.05;">New page</h2>
        <p style="margin:10px 0 0 0;color:rgba(0,0,0,.65);max-width:720px;font-size:14px;line-height:1.5;">
          A complete page layout with multiple sections, built to match the existing site theme.
        </p>
      </div>
      <div style="display:flex;gap:10px;align-items:center;">
        <a href="#" class="kl-np-btn" style="text-decoration:none;">Get started</a>
        <a href="#" class="kl-np-btn" style="text-decoration:none;">Learn more</a>
      </div>
    </div>
  </section>

  <section>
    <div class="kl-np-grid">
      <div class="kl-np-card">
        <h3>What you get</h3>
        <p>Clear structure, scannable content, and sections that fit the page type.</p>
      </div>
      <div class="kl-np-card">
        <h3>How it works</h3>
        <p>Organized blocks that can be edited, reordered, or expanded as needed.</p>
      </div>
      <div class="kl-np-card">
        <h3>Details</h3>
        <p>Space for your specifics: features, story, services, or FAQs.</p>
      </div>
      <div class="kl-np-card">
        <h3>Next step</h3>
        <p>A simple call-to-action that drives the user forward.</p>
      </div>
    </div>
  </section>

  <section>
    <div class="kl-np-cta">
      <div style="min-width:220px;">
        <div style="font-weight:800;font-size:14px;">Ready to ship this page?</div>
        <div style="color:rgba(0,0,0,.65);font-size:12px;margin-top:4px;">
          Edit the sections and replace placeholder copy with your specifics.
        </div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;">
        <a href="#" class="kl-np-btn" style="text-decoration:none;">Primary action</a>
        <a href="#" class="kl-np-btn" style="text-decoration:none;">Secondary</a>
      </div>
    </div>
  </section>
</div>
        `.trim();

            const re = new RegExp(
                `(<main\\b[^>]*\\bdata-route=["']${escapeRegExp(pageId)}["'][^>]*>)`,
                "i"
            );
            if (re.test(html)) return html.replace(re, `$1\n${padding}\n`);
            return html + "\n" + padding;
        }

        function escapeRegExp(s: string): string {
            return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }
    }, [
        creatingPage,
        aiEditing,
        newPagePrompt,
        newPageUrl,
        draftId,
        pageIds,
        handlePageSwitch,
        doSave,
    ]);

    const confirmPageSwitch = async () => {
        if (!pageSwitchConfirm) return;
        const nextId = pageSwitchConfirm.targetId;

        try {
            const doc = iframeRef.current?.contentDocument;
            const hasPendingImages = !!doc?.querySelector("img[data-local-image-id]");

            if (hasPendingImages) {
                await doSave({ applyToPreview: true });
            }
        } catch (err) {
            console.error("[confirmPageSwitch] save failed before page switch", err);
        } finally {
            setActivePageId(nextId);
            bumpSessionCounter("pageSwitch");
            setPageSwitchConfirm(null);
        }
    };

    const cancelPageSwitch = () => {
        setPageSwitchConfirm(null);
    };

    // ----------------------
    // helpers (bottom)
    // ----------------------

    function uniquePageId(baseId: string, pageIds: Set<string>): string {
        let id = baseId;
        let i = 2;
        while (pageIds.has(id)) id = `${baseId}-${i++}`;
        return id;
    }

    function baseNewPageBlockHtml(pageId: string): string {
        const safeRoute = String(pageId || "/new-page");
        // No page-level header/footer here. Keep as pure content.
        return `
            <main 
                class="page-root" 
                data-route="${safeRoute}" 
                data-kloner-root="1" 
                style="min-height:100vh;">
            </main>
        `.trim();
    }

    function sanitizePageSlug(input: string): string {
        // allows nested segments with "/"
        let s = String(input || "").trim().toLowerCase();

        // no leading/trailing slashes (input is slug-only)
        s = s.replace(/^\/+/, "").replace(/\/+$/g, "");

        // normalize separators
        s = s.replace(/[\s_]+/g, "-");

        // split by "/", sanitize each segment, then re-join
        const parts = s.split("/").filter(Boolean).map((seg) => {
            let x = seg;
            x = x.replace(/[^a-z0-9-]+/g, "-");
            x = x.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
            return x;
        });

        // drop empty segments
        return parts.filter(Boolean).join("/");
    }

    function validatePageSlug(input: string): { ok: boolean; msg?: string } {
        const raw = String(input || "").trim();

        if (!raw) return { ok: false, msg: "" };
        if (/^\//.test(raw)) return { ok: false, msg: `Do not include "/". Type only the slug.` };
        if (raw.length > 80) return { ok: false, msg: "Too long. Keep it under 80 characters." };

        // allow only letters/numbers/_/- and "/" — no spaces
        if (/[^a-zA-Z0-9\-_/]/.test(raw))
            return { ok: false, msg: "Only letters, numbers, '-', '_', and '/' are allowed." };

        // block spaces explicitly (covers pasted edge cases)
        if (/\s/.test(raw))
            return { ok: false, msg: "Spaces are not allowed." };

        // avoid consecutive slashes
        if (/\/{2,}/.test(raw))
            return { ok: false, msg: "Avoid consecutive '/'." };

        const sanitized = sanitizePageSlug(raw);
        if (!sanitized) return { ok: false, msg: "Invalid slug. Use letters/numbers with optional '-' and '/'." };
        if (sanitized.length < 2) return { ok: false, msg: "" };

        // prevent empty segments after sanitize
        if (sanitized.split("/").some((seg) => !seg)) return { ok: false, msg: "Invalid path segments." };
        if (sanitized.split("/").some((seg) => seg.startsWith("-") || seg.endsWith("-"))) {
            return { ok: false, msg: "Segments cannot start or end with '-'." };
        }

        return { ok: true };
    }

    function stripHeaderFooterFromPageBlock(html: string): string {
        let out = html || "";
        out = out.replace(/<header\b[\s\S]*?<\/header>\s*/gi, "");
        out = out.replace(/<footer\b[\s\S]*?<\/footer>\s*/gi, "");
        return out.trim();
    }

    function normalizeAiPageBlock(afterHtml: string, pageId: string): string {
        let out = (afterHtml || "").trim();

        // strip header/footer even if AI disobeys
        out = stripHeaderFooterFromPageBlock(out);

        // enforce correct wrapper if AI returned partial inner content
        const hasMain = /<main\b[^>]*\bpage-root\b[^>]*>/i.test(out) && /<\/main>/i.test(out);
        if (!hasMain) {
            // wrap the returned content
            const inner = out;
            out = `
<main class="page-root" data-route="${pageId}" data-kloner-root="1" style="min-height:100vh;">
  ${inner}
</main>
`.trim();
        }

        // enforce correct route attribute regardless
        out = out.replace(/data-route=["'][^"']*["']/i, `data-route="${pageId}"`);
        if (!/class=["'][^"']*\bpage-root\b[^"']*["']/i.test(out)) {
            // ensure page-root class exists on main
            out = out.replace(/<main\b([^>]*)>/i, (m, g1) => {
                if (/class=["']/.test(g1)) {
                    return `<main${g1.replace(/class=["']([^"']*)["']/, (mm: any, cls: any) => ` class="${cls} page-root"`)}>`;
                }
                return `<main class="page-root"${g1}>`;
            });
        }

        return out.trim();
    }

    function hoistGlobalHeaderFooter(docHtml: string): string {
        let base = docHtml || "";

        const HOIST_HEAD = `<!-- kloner:global-header:start -->`;
        const HOIST_HEAD_END = `<!-- kloner:global-header:end -->`;
        const HOIST_FOOT = `<!-- kloner:global-footer:start -->`;
        const HOIST_FOOT_END = `<!-- kloner:global-footer:end -->`;

        if (base.includes(HOIST_HEAD) || base.includes(HOIST_FOOT)) return base;

        const headerMatch = base.match(/<header\b[\s\S]*?<\/header>/i);
        const footerMatch = base.match(/<footer\b[\s\S]*?<\/footer>/i);

        if (!headerMatch && !footerMatch) return base;

        if (headerMatch) base = base.replace(headerMatch[0], "");
        if (footerMatch) base = base.replace(footerMatch[0], "");

        if (headerMatch) {
            const headerPayload = `${HOIST_HEAD}\n${headerMatch[0]}\n${HOIST_HEAD_END}\n`;
            if (base.includes("<body")) {
                base = base.replace(/<body([^>]*)>/i, (m, g1) => `<body${g1}>\n${headerPayload}`);
            } else {
                base = `${headerPayload}${base}`;
            }
        }

        if (footerMatch) {
            const footerPayload = `\n${HOIST_FOOT}\n${footerMatch[0]}\n${HOIST_FOOT_END}\n`;
            if (base.includes("</body>")) {
                base = base.replace("</body>", `${footerPayload}</body>`);
            } else {
                base = `${base}${footerPayload}`;
            }
        }

        return base;
    }

    async function doExport() {
        if (exporting) return;
        setExportNote("");
        setExporting(true);

        const exportStartMs = Date.now();

        try {
            await doSave({ applyToPreview: true });

            // IMPORTANT:
            // After restore/archive, React state has the newest HTML immediately,
            // but the iframe DOM can lag behind for a tick (or longer).
            // Export must prefer the latest in-memory HTML over iframe snapshot.
            const latestStateHtml = (htmlDraft || previewHtml || "").trim();

            const iframeHtmlRaw = snapshotFromIframeOrDraft();
            const iframeHtml = (iframeHtmlRaw || "").trim();

            const baseHtml = (latestStateHtml || iframeHtml).trim();

            if (!baseHtml) {
                const msg = "No HTML available to export";
                const durationMs = Date.now() - exportStartMs;

                await recordExportAnalytics(
                    user as ExportAnalyticsUser,
                    draftId,
                    { status: "error", error: msg, durationMs },
                );

                throw new Error(msg);
            }

            const cleanedForExport = cleanHtmlBeforeExport(baseHtml);

            const finalHtml = await buildFinalExport({
                html: cleanedForExport,
                user,
                draftId,
                fallbackSeoMetaByPage: seoMetaByPage || null,
            });

            await onExport(finalHtml, nameHint || undefined);

            const durationMs = Date.now() - exportStartMs;

            bumpSessionCounter("export");

            await recordExportAnalytics(
                user as ExportAnalyticsUser,
                draftId,
                { status: "success", error: null, durationMs },
            );
        } catch (e: any) {
            const msg = String(e?.message || "");
            const durationMs = Date.now() - exportStartMs;

            await recordExportAnalytics(
                user as ExportAnalyticsUser,
                draftId,
                { status: "error", error: msg, durationMs },
            );

            if (/401|403|unauth/i.test(msg)) {
                setExportNote("Export blocked. Connect your Vercel account in Settings, then retry.");
            } else {
                setExportNote("Export failed. Retry shortly.");
            }
            throw e;
        } finally {
            setExporting(false);
        }
    }


    /**
     * FINAL HTML SCRUB BEFORE EXPORT
     * Parse the raw HTML into a real Document, run snapshotCleanFromDocument,
     * and return a clean string.
     */
    function cleanHtmlBeforeExport(rawHtml: string): string {
        if (typeof window === "undefined" || typeof DOMParser === "undefined") {
            return rawHtml;
        }

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawHtml, "text/html");
            return snapshotCleanFromDocument(doc);
        } catch {
            return rawHtml;
        }
    }
    function snapshotCleanFromDocument(doc: Document): string {
        const root = doc.documentElement;
        if (!root) {
            const html = (doc as any).documentElement?.outerHTML || "";
            return "<!doctype html>\n" + html;
        }

        const docClone = root.cloneNode(true) as HTMLHtmlElement;
        const body = docClone.querySelector("body");

        if (body) {
            // Core Kloner UI + legacy toolbar selectors
            const uiSelectors = [
                ".kloner-toolbar",
                ".kloner-style-panel",
                ".khint",
                "[data-kloner-upload-input]",
                "[data-kloner-ui]",
                "[data-kloner-overlay]",
                "[data-kloner-toolbar]",
                "#kloner-toolbar",
                "[id^='kloner-toolbar']",
                "[class*='kloner-toolbar']",
                "[class*='kloner-ui']",

                // legacy image/link toolbar
                ".kgroup",
                ".kgroup-img",
                ".kgroup-link",
                ".kbtn",
                ".kbtn-img",
                ".kbtn-link",
            ];

            body.querySelectorAll(uiSelectors.join(",")).forEach((n) => n.remove());

            // Attribute-based cleanup for any remaining toolbar fragments
            body.querySelectorAll<HTMLElement>("[data-group],[data-act]").forEach((n) => {
                const group = n.getAttribute("data-group");
                const act = n.getAttribute("data-act") || "";
                if (
                    n.classList.contains("kgroup") ||
                    n.classList.contains("kbtn") ||
                    group === "img" ||
                    group === "link" ||
                    act === "link" ||
                    act.startsWith("img-")
                ) {
                    n.remove();
                }
            });

            // Strip selection/edit attributes
            body.querySelectorAll("[data-kloner-sel]").forEach((n) =>
                (n as HTMLElement).removeAttribute("data-kloner-sel"),
            );
            body.querySelectorAll("[contenteditable]").forEach((n) =>
                (n as HTMLElement).removeAttribute("contenteditable"),
            );
            body.querySelectorAll<HTMLElement>("[data-kloner]").forEach((n) =>
                n.removeAttribute("data-kloner"),
            );

            // Kill any <meta> / <title> that ended up inside <body>
            body.querySelectorAll("meta, title").forEach((n) => n.remove());
        }

        // IMPORTANT: do NOT touch <head> here.
        // We keep all styles/fonts/scripts so exported pages render correctly.

        return "<!doctype html>\n" + (docClone as any).outerHTML;
    }


    function sanitizeName(name: string) {
        const base = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
        return base.slice(-64) || "image";
    }

    async function uploadFileToUserBlob(
        file: File,
        draftId: string
    ): Promise<UploadedAsset> {
        if (process.env.NODE_ENV === "development") {
            console.log("[uploadFileToUserBlob] start", {
                draftId,
                originalName: file.name,
                originalBytes: file.size,
                originalType: file.type,
            });
        }

        // 1) compress on the client first (if helpful)
        let fileForUpload = file;
        try {
            const compressed = await compressImageForUpload(file);

            if (compressed !== file) {
                if (process.env.NODE_ENV === "development") {
                    console.log("[uploadFileToUserBlob] compression applied", {
                        originalName: file.name,
                        originalBytes: file.size,
                        compressedName: compressed.name,
                        compressedBytes: compressed.size,
                        bytesSaved: file.size - compressed.size,
                        ratio: compressed.size / file.size,
                        originalType: file.type,
                        compressedType: compressed.type,
                    });
                }
                fileForUpload = compressed;
            } else {
                if (process.env.NODE_ENV === "development") {
                    console.log("[uploadFileToUserBlob] compression skipped or not beneficial", {
                        name: file.name,
                        size: file.size,
                        type: file.type,
                    });
                }
            }
        } catch (e) {
            console.warn(
                "[uploadFileToUserBlob] compression failed, falling back to original",
                e
            );
        }

        const csrf = await ensureSessionAndCsrf();
        const safeName = sanitizeImageName(fileForUpload.name || "upload.bin");

        const url = `/api/user-blob/upload-url?filename=${encodeURIComponent(
            safeName
        )}&renderId=${encodeURIComponent(draftId)}`;

        if (process.env.NODE_ENV === "development") {
            console.log("[uploadFileToUserBlob] POST", {
                url,
                hasCsrf: !!csrf,
                uploadName: fileForUpload.name,
                uploadBytes: fileForUpload.size,
                uploadType: fileForUpload.type,
            });
        }

        const res = await fetch(url, {
            method: "POST",
            headers: {
                "content-type": fileForUpload.type || "application/octet-stream",
                ...(csrf ? { "x-csrf": csrf } : {}),
            },
            credentials: "include",
            body: fileForUpload,
        });

        const j = await res.json().catch(() => ({} as any));

        if (process.env.NODE_ENV === "development") {
            console.log("[uploadFileToUserBlob] response", {
                ok: res.ok,
                status: res.status,
                bodyKeys: Object.keys(j || {}),
            });
        }

        if (!res.ok || !j?.url || !j?.path) {
            console.error("[uploadFileToUserBlob] error", {
                status: res.status,
                body: j,
            });
            throw new Error(j?.error || "storage_upload_failed");
        }

        const asset: UploadedAsset = {
            url: j.url as string,
            path: j.path as string,
        };

        if (process.env.NODE_ENV === "development") {
            console.log("[uploadFileToUserBlob] success", {
                ...asset,
                uploadedBytes: fileForUpload.size,
                uploadedType: fileForUpload.type,
            });
        }

        return asset;
    }


    async function flushPendingImagesBeforeSave(args: {
        doc: Document;
        draftId: string;
    }) {
        const { doc, draftId } = args;

        if (process.env.NODE_ENV === "development") {
            console.log("[flushPendingImagesBeforeSave] start", { draftId });
        }

        // 0) Backwards-compat: delete any stale data-kloner-old-path assets (foreground)
        const imgsWithOldPath = Array.from(
            doc.querySelectorAll<HTMLImageElement>("img[data-kloner-old-path]")
        );
        const stalePaths: string[] = [];

        for (const img of imgsWithOldPath) {
            const p = img.getAttribute("data-kloner-old-path");
            if (p) stalePaths.push(p);
            img.removeAttribute("data-kloner-old-path");
        }

        // 0b) Backwards-compat: delete any stale data-kloner-bg-old-path assets (backgrounds)
        const bgElsWithOldPath = Array.from(
            doc.querySelectorAll<HTMLElement>("[data-kloner-bg-old-path]")
        );

        for (const el of bgElsWithOldPath) {
            const p = el.getAttribute("data-kloner-bg-old-path");
            if (p) stalePaths.push(p);
            el.removeAttribute("data-kloner-bg-old-path");
        }

        if (stalePaths.length) {
            if (process.env.NODE_ENV === "development") {
                console.log("[flushPendingImagesBeforeSave] deleting stale old paths", {
                    count: stalePaths.length,
                    stalePaths,
                });
            }
            try {
                // fire-and-forget; host listener will call the actual delete API
                requestDeleteAssetsByPaths(stalePaths);
            } catch (err) {
                console.warn(
                    "[flushPendingImagesBeforeSave] requestDeleteAssetsByPaths failed for stale paths",
                    err
                );
            }
        }

        // ----------------------------------------
        // 1) normal pending-local-image flow (foreground <img>)
        // ----------------------------------------
        const imgs = Array.from(
            doc.querySelectorAll<HTMLImageElement>("img[data-local-image-id]")
        );
        if (process.env.NODE_ENV === "development") {
            console.log("[flushPendingImagesBeforeSave] found img elements", {
                count: imgs.length,
            });
        }

        for (const img of imgs) {
            const localId = img.dataset.localImageId;
            const tempUrl = img.src;
            const localFilename = img.dataset.localFilename || "upload.bin";

            if (!localId || !tempUrl) {
                console.warn(
                    "[flushPendingImagesBeforeSave] img missing local id or src",
                    { localId, tempUrl }
                );
                continue;
            }

            try {
                if (process.env.NODE_ENV === "development") {
                    console.log("[flushPendingImagesBeforeSave] fetching blob URL (img)", {
                        localId,
                        tempUrl,
                    });
                }

                const res = await fetch(tempUrl);
                if (!res.ok) {
                    console.error(
                        "[flushPendingImagesBeforeSave] fetch failed for blob URL (img)",
                        { localId, tempUrl, status: res.status }
                    );
                    continue;
                }

                const blob = await res.blob();
                const file = new File([blob], sanitizeName(localFilename), {
                    type: blob.type || "application/octet-stream",
                });

                if (process.env.NODE_ENV === "development") {
                    console.log("[flushPendingImagesBeforeSave] uploading image (img)", {
                        localId,
                        fileName: file.name,
                        fileSize: file.size,
                        type: file.type,
                    });
                }

                const asset = await uploadFileToUserBlob(file, draftId);

                const oldTempUrl = img.src;

                img.src = asset.url;
                img.removeAttribute("data-local-image-id");
                img.removeAttribute("data-local-filename");

                if (asset.path) {
                    img.setAttribute("data-kloner-path", asset.path);
                }

                if (process.env.NODE_ENV === "development") {
                    console.log("[flushPendingImagesBeforeSave] img updated", {
                        localId,
                        oldTempUrl,
                        newUrl: asset.url,
                        path: asset.path,
                    });
                }

                try {
                    URL.revokeObjectURL(oldTempUrl);
                    if (process.env.NODE_ENV === "development") {
                        console.log(
                            "[flushPendingImagesBeforeSave] revoked temp URL (img)",
                            { localId }
                        );
                    }
                } catch (e) {
                    console.warn(
                        "[flushPendingImagesBeforeSave] revokeObjectURL failed (img)",
                        { localId, oldTempUrl },
                        e
                    );
                }
            } catch (err) {
                console.error(
                    "[flushPendingImagesBeforeSave] upload failed (img)",
                    { localId, tempUrl },
                    err
                );
                continue;
            }
        }

        // ----------------------------------------
        // 2) pending-local-image flow for background images on blocks
        // ----------------------------------------

        function extractBgUrlFromStyle(el: HTMLElement): string | null {
            // Prefer inline style first so we match what setBlockBackgroundImage wrote
            let bg = el.style.backgroundImage;
            if (!bg) {
                const cs = doc.defaultView?.getComputedStyle(el);
                bg = cs?.backgroundImage || "";
            }
            if (!bg || bg === "none") return null;

            // Expect patterns like: url("blob:...") or url(blob:...)
            const match = bg.match(/url\((['"]?)(.*?)\1\)/i);
            if (!match) return null;

            return match[2] || null;
        }

        const bgBlocks = Array.from(
            doc.querySelectorAll<HTMLElement>("[data-local-image-id]")
        ).filter((el) => el.tagName !== "IMG");

        if (process.env.NODE_ENV === "development") {
            console.log("[flushPendingImagesBeforeSave] found bg blocks with local image", {
                count: bgBlocks.length,
            });
        }

        for (const el of bgBlocks) {
            const localId = (el.dataset as any).localImageId as string | undefined;
            const localFilename =
                (el.dataset as any).localFilename || "background.bin";

            const tempUrl = extractBgUrlFromStyle(el);

            if (!localId || !tempUrl) {
                console.warn(
                    "[flushPendingImagesBeforeSave] bg block missing local id or bg url",
                    { localId, tempUrl }
                );
                continue;
            }

            try {
                if (process.env.NODE_ENV === "development") {
                    console.log(
                        "[flushPendingImagesBeforeSave] fetching blob URL (bg block)",
                        { localId, tempUrl }
                    );
                }

                const res = await fetch(tempUrl);
                if (!res.ok) {
                    console.error(
                        "[flushPendingImagesBeforeSave] fetch failed for blob URL (bg block)",
                        { localId, tempUrl, status: res.status }
                    );
                    continue;
                }

                const blob = await res.blob();
                const file = new File([blob], sanitizeName(localFilename), {
                    type: blob.type || "application/octet-stream",
                });

                if (process.env.NODE_ENV === "development") {
                    console.log("[flushPendingImagesBeforeSave] uploading image (bg block)", {
                        localId,
                        fileName: file.name,
                        fileSize: file.size,
                        type: file.type,
                    });
                }
                const asset = await uploadFileToUserBlob(file, draftId);

                const oldTempUrl = tempUrl;

                // Swap background to the real storage URL
                el.style.backgroundImage = `url("${asset.url}")`;

                // Clear local markers
                delete (el.dataset as any).localImageId;
                delete (el.dataset as any).localFilename;

                // Persist bg asset path for future deletions
                if (asset.path) {
                    el.setAttribute("data-kloner-bg-path", asset.path);
                }
                if (process.env.NODE_ENV === "development") {
                    console.log("[flushPendingImagesBeforeSave] bg block updated", {
                        localId,
                        oldTempUrl,
                        newUrl: asset.url,
                        path: asset.path,
                    });
                }
                try {
                    URL.revokeObjectURL(oldTempUrl);
                    if (process.env.NODE_ENV === "development") {
                        console.log(
                            "[flushPendingImagesBeforeSave] revoked temp URL (bg block)",
                            { localId }
                        );
                    }
                } catch (e) {
                    console.warn(
                        "[flushPendingImagesBeforeSave] revokeObjectURL failed (bg block)",
                        { localId, oldTempUrl },
                        e
                    );
                }
            } catch (err) {
                console.error(
                    "[flushPendingImagesBeforeSave] upload failed (bg block)",
                    { localId, tempUrl },
                    err
                );
                continue;
            }
        }
    }


    // iframe messages: uploads + selection meta + delete-assets
    useEffect(() => {
        const onMsg = async (e: MessageEvent) => {
            const data = e.data || {};

            if (data?.type === "kloner:upload") {
                const { id, filename, contentType } = data;
                const buf: ArrayBuffer | undefined = data.buffer;

                try {
                    if (!buf || !filename || !contentType) {
                        throw new Error("bad_payload");
                    }

                    const file = new File(
                        [new Uint8Array(buf)],
                        sanitizeName(filename),
                        {
                            type: contentType,
                        }
                    );

                    if (draftId) {
                        const { url, path } = await uploadFileToUserBlob(file, draftId);

                        iframeRef.current?.contentWindow?.postMessage(
                            {
                                type: "kloner:upload:done",
                                id,
                                ok: true,
                                url,
                                path, // storage path so iframe can tag and later delete
                            },
                            "*"
                        );
                    } else {
                        throw new Error("missing_draft_id");
                    }
                } catch (err: any) {
                    iframeRef.current?.contentWindow?.postMessage(
                        {
                            type: "kloner:upload:done",
                            id,
                            ok: false,
                            error: String(err?.message || "upload_failed"),
                        },
                        "*"
                    );
                }
                return;
            }

            if (data?.type === "kloner:delete-assets") {
                const paths = Array.isArray(data.paths)
                    ? data.paths.filter((p: unknown) => typeof p === "string" && p)
                    : [];
                if (!paths.length) return;
                try {
                    await fetch("/api/user-blob/delete", {
                        method: "POST",
                        headers: {
                            "content-type": "application/json",
                        },
                        body: JSON.stringify({ paths }),
                    });
                } catch (err) {
                    console.error("asset delete from iframe failed", err);
                }
                return;
            }

            if (data?.type === "kloner:selection") {
                const meta = data.meta as SelectionMeta | undefined;
                setSelectionMeta(
                    meta && typeof meta.has === "boolean" ? meta : { has: false }
                );
            }
        };

        window.addEventListener("message", onMsg);
        return () => window.removeEventListener("message", onMsg);
    }, [draftId]);

    useEffect(() => {
        function handleMessage(ev: MessageEvent) {
            const data = ev.data;
            if (!data || data.type !== "kloner:selection") return;
            const meta = data.meta as SelectionMeta;
            setSelectionMeta(meta || { has: false });
        }

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);


    const sendStyleCommand = useCallback(
        (cmd: StyleCmd) => {
            const win = iframeRef.current?.contentWindow as any;
            try {
                win?.__klonerApi?.style?.({ ...cmd, device });
            } catch {
                // ignore
            }
        },
        [device]
    );

    const handleNativeUndo = () => {
        try {
            const iframe = iframeRef.current;

            // Prefer undo inside the iframe (where the user is editing)
            if (iframe?.contentWindow?.document) {
                const doc = iframe.contentWindow.document as Document & {
                    execCommand?: (commandId: string) => boolean;
                };

                if (typeof doc.execCommand === "function") {
                    doc.execCommand("undo");
                    return;
                }
            }

            // Fallback: undo in the host document (if something here has focus)
            if (typeof document !== "undefined") {
                const anyDoc = document as Document & {
                    execCommand?: (commandId: string) => boolean;
                };

                if (typeof anyDoc.execCommand === "function") {
                    anyDoc.execCommand("undo");
                }
            }
        } catch (err) {
            console.warn("[PreviewEditor] native undo failed", err);
        }
    };

    const performClose = useCallback(
        async (closeMode: "save" | "discard") => {
            if (closing) return;
            setClosing(true);
            tryClearIframeSelection();
            try {
                if (closeMode === "save") {
                    // commit uploads that are now in saved HTML
                    postToEditor({ type: "kloner:commit-assets" });
                    setClosePrompt(false);
                    await doSave();
                } else {
                    // discard: nuke any pending uploads for this session
                    postToEditor({ type: "kloner:discard-assets" });
                }

                await onClose?.();
            } finally {
                setClosing(false);
            }
        },
        [closing, doSave, onClose, tryClearIframeSelection]
    );

    // pre-AI save: add snapshot and immediately persist to localStorage so the
    // user can always revert even if the app crashes or the tab closes.
    function snapshotBeforeAiEdit(fullHtml: string) {
        addSnapshot({
            html: fullHtml,
            source: "auto",
        });

        // Immediately persist history + current draft to localStorage to avoid
        // relying on the next render/effect cycle which might be delayed.
        try {
            const hk = HISTORY_KEY(draftId);
            const currentKey = CURRENT_DRAFT_KEY(draftId);

            // Build payloads consistent with v2 envelopes
            const nextHistory: V2History = {
                v: 2,
                items: [
                    {
                        id: typeof crypto !== "undefined" && "randomUUID" in crypto
                            ? (crypto as any).randomUUID()
                            : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        createdAt: Date.now(),
                        source: "before-ai",
                        html: (fullHtml || "").trim(),
                    } as any,
                    ...history,
                ].slice(0, MAX_HISTORY_SNAPSHOTS),
                updatedAt: Date.now(),
            };

            const currentPayload: V2CurrentDraft = {
                v: 2,
                html: (fullHtml || "").trim(),
                updatedAt: Date.now(),
            };

            const historyStr = JSON.stringify(nextHistory);
            const currentStr = JSON.stringify(currentPayload);

            // Warn if the payloads are large (approximate in bytes)
            const totalBytes = historyStr.length + currentStr.length;
            const WARN_BYTES = 1_500_000; // ~1.5MB heuristic
            if (totalBytes > WARN_BYTES) {
                // Inform the user their localStorage may be near quota.
                try {
                    if (typeof window !== "undefined") {
                        window.alert(
                            "Local save is large and may exceed your browser storage quota. Consider clearing older drafts/history if saves fail."
                        );
                    }
                } catch {
                    // ignore
                }
            }

            try {
                localStorage.setItem(hk, historyStr);
            } catch (err: any) {
                if (err && (err.name === "QuotaExceededError" || err.code === 22)) {
                    try {
                        window.alert(
                            "Unable to save undo snapshot: localStorage quota exceeded. Clear storage or export your drafts to continue."
                        );
                    } catch { }
                }
            }

            try {
                localStorage.setItem(currentKey, currentStr);
            } catch (err: any) {
                if (err && (err.name === "QuotaExceededError" || err.code === 22)) {
                    try {
                        window.alert(
                            "Unable to persist current draft: localStorage quota exceeded. Clear storage or export your drafts to continue."
                        );
                    } catch { }
                }
            }
        } catch (err) {
            console.warn("[PreviewEditor] snapshotBeforeAiEdit immediate persist failed", err);
        }
    }

    const saveImageToLibrary = useCallback(async (url: string, name?: string) => {
        if (!user || !draftId) return;

        try {
            const uid = user.uid;
            const timestamp = Date.now();
            const ext = 'jpg'; // assume jpg
            const fileName = name || `ai-injected-${timestamp}.${ext}`;
            const storagePath = `kloner_images/${uid}/${fileName}`;

            // Download the image
            const response = await fetch(url);
            const blob = await response.blob();

            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, blob);

            // No need to add to items here, as the panel will reload
        } catch (err) {
            console.warn("[saveImageToLibrary] failed", err);
        }
    }, [user, draftId]);

    // Put this helper inside the same component, above the JSX return:
    const applyAiEditedBlockHtml = useCallback(
        async (afterBlockHtml: string) => {
            const raw = (afterBlockHtml ?? "").trim();

            const looksBroken =
                !raw ||
                raw === "</" ||
                raw === "<" ||
                raw.length < 8 ||
                (!raw.includes("<") || !raw.includes(">"));

            if (looksBroken) {
                console.warn(
                    "[PreviewEditor] Ignoring AI edit – block HTML looked broken",
                    { afterBlockHtml },
                );
                return;
            }

            // Save any injected images to library
            try {
                const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
                let match;
                while ((match = imgRegex.exec(raw)) !== null) {
                    const src = match[1];
                    if (src && (src.startsWith('http') || src.startsWith('//'))) {
                        // External image, save to library
                        await saveImageToLibrary(src);
                    }
                }
            } catch (err) {
                console.warn("[PreviewEditor] Failed to save injected images", err);
            }

            // 1) Best-effort pre-AI save of the current state (optional, keeps old version safe)
            try {
                if (!closing && !savingDraft && !applyingPreview && dirty) {
                    await doSave();
                }
            } catch (err) {
                console.warn(
                    "[PreviewEditor] pre-AI save failed, continuing anyway",
                    err,
                );
            }

            // 2) Snapshot the *pre-AI* full HTML for undo
            try {
                const iframe = iframeRef.current;
                if (iframe && iframe.contentDocument) {
                    const preAiDoc =
                        iframe.contentDocument.documentElement.outerHTML;
                    snapshotBeforeAiEdit(preAiDoc);
                }
            } catch (err) {
                console.warn("Failed to snapshot before AI edit", err);
            }

            // 3) Apply AI block into iframe and serialize full HTML
            const fullHtml = applyBlockHtmlToIframeAndSerialize(raw, true);

            if (!fullHtml) {
                console.warn(
                    "[PreviewEditor] applyBlockHtmlToIframeAndSerialize returned null",
                );
                return;
            }

            // 4) Clean the serialized full HTML
            let cleanedHtml = fullHtml;
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(fullHtml, "text/html");
                cleanedHtml = snapshotCleanFromDocument(doc);
            } catch (err) {
                console.warn(
                    "[PreviewEditor] failed to clean AI-edited HTML",
                    err,
                );
            }

            // 5) Update local editor state with the AI-edited HTML
            setDirty(true);
            setHistoryOpen(true)
            setHtmlDraft(cleanedHtml);
            setPreviewHtml(cleanedHtml);
            if (onLiveHtml) onLiveHtml(cleanedHtml);

            // 6) Snapshot the *post-AI* full HTML so you can "keep / discard" this edit
            // try {
            //     addSnapshot({
            //         source: "ai-edit",
            //         html: cleanedHtml,
            //     });
            // } catch (err) {
            //     console.warn(
            //         "[PreviewEditor] failed to snapshot after AI edit",
            //         err,
            //     );
            // }

            // 7) Immediately persist the AI-edited HTML (blocking save for this helper)
            try {
                if (!closing) {
                    await doSave();
                }
                bumpSessionCounter("aiApply");

            } catch (err) {
                console.warn(
                    "[PreviewEditor] failed to save AI-edited HTML immediately",
                    err,
                );
            }
        },
        [
            closing,
            savingDraft,
            applyingPreview,
            dirty,
            doSave,
            iframeRef,
            snapshotBeforeAiEdit,
            applyBlockHtmlToIframeAndSerialize,
            snapshotCleanFromDocument,
            setDirty,
            setHtmlDraft,
            setPreviewHtml,
            onLiveHtml,
            addSnapshot,
            saveImageToLibrary,
        ],
    );

    const runAiEditFromMiniToolbar = useCallback(
        async (prompt: string) => {
            // Use the existing helper rather than __klonerApi
            if (!getSelectedBlockHtml) {
                console.warn("[MiniToolbar] getSelectedBlockHtml not available");
                return;
            }

            const currentHtml = getSelectedBlockHtml();
            if (!currentHtml || !currentHtml.trim()) {
                console.warn("[MiniToolbar] empty selected block HTML for AI edit");
                return;
            }

            if (!draftId) {
                console.warn("[MiniToolbar] no draftId / renderId for AI edit");
                return;
            }

            bumpSessionCounter("aiEdit");
            bumpSessionCounter("aiMiniToolbar");

            setAiEditing(true);
            try {
                const res = await fetch("/api/ai-edit", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        renderId: draftId,
                        html: currentHtml,
                        prompt,
                    }),
                });

                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    console.error(
                        "[MiniToolbar] AI edit failed",
                        res.status,
                        data?.error
                    );
                    return;
                }

                const data = await res.json();
                const suggestion =
                    data?.suggestions && data.suggestions.length
                        ? data.suggestions[0]
                        : null;

                const afterHtml: string | undefined = suggestion?.afterHtml;

                if (!afterHtml || typeof afterHtml !== "string") {
                    console.warn("[MiniToolbar] No afterHtml in AI response");
                    return;
                }

                await applyAiEditedBlockHtml(afterHtml);
            } catch (err) {
                console.error("[MiniToolbar] AI edit request threw", err);
            } finally {
                setAiEditing(false);
            }
        },
        [getSelectedBlockHtml, draftId, applyAiEditedBlockHtml]
    );



    const handleModeClick = useCallback(
        (next: ViewMode) => {
            if (closing || mode === next) return;
            setMode(next);
            bumpSessionCounter("modeSwitch");
            tryClearIframeSelection();
        },
        [closing, mode, tryClearIframeSelection],
    );

    const openSidePanelMode = useCallback(
        (nextMode: "style" | "meta" | "code" | "ai-library" | "revision-chat") => {
            setSidePanelMode(nextMode);
            setSidebarHidden(false);
            setMobileControlsOpen(false);

            if (nextMode === "code") {
                if (isDevCodeMode) handleModeClick("code");
            } else if (mode !== "preview") {
                handleModeClick("preview");
            }

            if (isCompactLayout) {
                setMobileTab("panel");
            }
        },
        [handleModeClick, isCompactLayout, isDevCodeMode, mode],
    );

    const openScreenshotMode = useCallback(() => {
        setSidebarHidden(true);
        setSidePanelMode("style");
        setMobileControlsOpen(false);
        if (mode !== "screenshot") handleModeClick("screenshot");
        if (isCompactLayout) setMobileTab("preview");
    }, [handleModeClick, isCompactLayout, mode]);

    const mobilePanelTitle = useMemo(() => {
        if (sidePanelMode === "style") return "Styles";
        if (sidePanelMode === "meta") return "SEO / Meta";
        if (sidePanelMode === "ai-library") return "AI Images";
        if (sidePanelMode === "code") return "Code";
        return "AI Edits";
    }, [sidePanelMode]);

    const showSidebarPanel = isCompactLayout ? mobileTab === "panel" : !sidebarHidden;
    const showCanvasPanel = !isCompactLayout || mobileTab === "preview";
    const effectiveUiScale = isCompactLayout ? 1 : uiScale;

    // kicks to preview if detects "code mode" in prod
    useEffect(() => {
        if (!isDevCodeMode && mode === "code") {
            handleModeClick("preview");
        }
    }, [isDevCodeMode, mode, handleModeClick]);

    const activeSourceImage = useMemo(
        () =>
            (allPages && activePage && activePage.screenshotUrl) || sourceImage,
        [allPages, activePage, sourceImage]
    );


    const iframeWrapperRef = useRef<HTMLDivElement | null>(null);

    const iframeNode = (
        <iframe
            key={iframeKey}
            ref={iframeRef}
            className="w-full h-[70vh] sm:h-[80vh] border-0"
            title="KlonerPreview"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin"
            srcDoc={
                aiPreviewHtml ||
                renderHtml ||
                "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>"
            }
            onLoad={() => {
                const doc = iframeRef.current?.contentDocument;
                if (!doc) return;

                // doc.querySelectorAll(".kloner-toolbar").forEach((n) => n.remove());
                // doc.querySelectorAll(".kloner-style-panel").forEach((n) => n.remove());

                if (mode === "preview") {
                    injectEditableOverlay(
                        doc,
                        (updated) => setHtmlDraft(updated),
                        device,
                    );
                    iframeRef.current?.contentWindow?.focus();
                }
            }}
        />


    );

    // ARCHIVING PAGES
    function removePageFromHtmlById(rawHtml: string, pageId: string): string {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawHtml, "text/html");

            // assumes your page roots are marked with data-kloner-page-id
            const roots = doc.querySelectorAll<HTMLElement>(`[data-kloner-page-id="${pageId}"]`);
            roots.forEach((el) => el.remove());

            return doc.documentElement.outerHTML;
        } catch (err) {
            console.warn("[PreviewEditor] failed to remove page from HTML", err);
            return rawHtml;
        }
    }

    return (
        <div
            ref={containerRef}
            tabIndex={-1}
            className="fixed inset-0 z-[9999] bg-black/50"
        >
            {!isCompactLayout && (<PreviewEditorTour />)}

            <div className={`absolute overflow-hidden ${isCompactLayout ? "inset-0 bg-white" : "inset-4"}`}>

                {isCompactLayout && (
                    <div className="absolute inset-x-0 top-0 z-[104] border-b border-neutral-200 bg-gray-50/95 px-3 py-2 backdrop-blur">
                        <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-neutral-900">
                                    {nameHint || "Preview editor"}
                                </div>
                                <div className="truncate text-[11px] text-neutral-500">
                                    {mobileTab === "preview"
                                        ? mode === "screenshot"
                                            ? "Reference view"
                                            : mode === "code"
                                                ? "Code preview"
                                                : `Live preview · ${device}`
                                        : `${mobilePanelTitle} panel`}
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => setMobileControlsOpen(true)}
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 shadow-sm transition hover:bg-neutral-50"
                                title="Controls"
                                aria-label="Controls"
                            >
                                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                            </button>

                            <button
                                type="button"
                                onClick={() => setExportPrompt(true)}
                                disabled={exporting}
                                data-tour-deploy
                                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-[#f55f2a] bg-[#f55f2a] px-3 text-sm font-semibold text-white shadow-md transition ${
                                    exporting
                                        ? "cursor-not-allowed opacity-60"
                                        : "hover:bg-[#e54f1a]"
                                }`}
                                title="Deploy"
                                aria-label="Deploy"
                            >
                                <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Deploy</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    if (dirty) setClosePrompt(true);
                                    else performClose("discard");
                                }}
                                disabled={closing || aiEditing}
                                aria-label="Close editor"
                                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 shadow-sm transition ${
                                    closing
                                        ? "cursor-not-allowed opacity-60"
                                        : "hover:bg-neutral-50 hover:text-neutral-900"
                                }`}
                            >
                                <span className="block h-[18px] w-[18px]">
                                    <svg
                                        viewBox="0 0 24 24"
                                        className="h-full w-full"
                                        aria-hidden="true"
                                    >
                                        <path
                                            d="M6 6l12 12M18 6L6 18"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.8"
                                            strokeLinecap="round"
                                        />
                                    </svg>
                                </span>
                            </button>
                        </div>
                    </div>
                )}

                {/* Top right controls */}
                {!isCompactLayout && (
                    <div className="absolute top-5 right-5 z-[102] flex items-center gap-2">
                        {/* Deploy button */}
                        <button
                            type="button"
                            onClick={() => setExportPrompt(true)}
                            disabled={exporting}
                            data-tour-deploy
                            className={`inline-flex h-8 items-center gap-1.5 rounded-full border border-[#f55f2a] bg-[#f55f2a] px-3 py-1 text-[13px] font-semibold text-white shadow-md transition ${
                                exporting
                                    ? "cursor-not-allowed opacity-60"
                                    : "hover:bg-[#e54f1a] hover:shadow-lg"
                            }`}
                            style={{
                                boxShadow: exporting 
                                    ? "0 4px 6px -1px rgba(0, 0, 0, 0.1)" 
                                    : "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 0 8px rgba(245, 95, 42, 0.3)"
                            }}
                            title="Deploy"
                            aria-label="Deploy"
                        >
                            <Rocket className="h-3 w-3" aria-hidden="true" />
                            <span>Deploy</span>
                        </button>
                        
                        {/* Close button */}
                        <button
                            type="button"
                            onClick={() => {
                                if (dirty) setClosePrompt(true);
                                else performClose("discard");
                            }}
                            disabled={closing || aiEditing}
                            aria-label="Close editor"
                            className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 shadow-md transition ${
                                closing
                                    ? "cursor-not-allowed opacity-60"
                                    : "hover:bg-neutral-50 hover:text-neutral-900"
                            }`}
                        >
                            <span className="block h-[18px] w-[18px]">
                                <svg
                                    viewBox="0 0 24 24"
                                    className="h-full w-full"
                                    aria-hidden="true"
                                >
                                    <path
                                        d="M6 6l12 12M18 6L6 18"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                    />
                                </svg>
                            </span>
                        </button>
                    </div>
                )}

                {/* V2 Badge moved to bottom right area */}

                {/* TOP TOOLBAR (tools + device) */}
                {!isCompactLayout && (
                <div
                    id="kloner-device-toggle"
                    className="absolute z-[101] flex items-center justify-center top-5 left-5 right-5"
                >
                    <div className="flex items-center gap-2">
                        {/* Tools strip (left of device) */}
                        <div className="p-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                        {/* Mode switcher */}
                        <div className="shrink-0 inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-1 shadow-md">
                            <button
                                type="button"
                                onClick={() => handleModeClick("preview")}
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                                    mode === "preview"
                                        ? "bg-[#f55f2a] text-white"
                                        : "bg-white text-neutral-600 hover:bg-neutral-100"
                                }`}
                                title="Preview"
                                aria-label="Preview"
                            >
                                <Eye className="h-3 w-3" aria-hidden="true" />
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setSidebarHidden(true);
                                    setSidePanelMode("style");
                                    handleModeClick("screenshot");
                                }}
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                                    mode === "screenshot"
                                        ? "bg-[#f55f2a] text-white"
                                        : "bg-white text-neutral-600 hover:bg-neutral-100"
                                }`}
                                title="Screenshot"
                                aria-label="Screenshot"
                            >
                                <Camera className="h-3 w-3" aria-hidden="true" />
                            </button>

                            {isDevCodeMode && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSidebarHidden(false);
                                        setSidePanelMode("code");
                                        handleModeClick("code");
                                    }}
                                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                                        mode === "code"
                                            ? "bg-[#f55f2a] text-white"
                                            : "bg-white text-neutral-600 hover:bg-neutral-100"
                                    }`}
                                    title="Code"
                                    aria-label="Code"
                                >
                                    <Code2 className="h-3 w-3" aria-hidden="true" />
                                </button>
                            )}
                        </div>

                        {/* Panel tools */}
                        <div className="shrink-0 inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-1 shadow-md">
                            <button
                                type="button"
                                onClick={() => {
                                    const isActive = !sidebarHidden && sidePanelMode === "style" && mode === "preview";
                                    if (isActive) {
                                        setSidebarHidden(true);
                                    } else {
                                        setSidePanelMode("style");
                                        setSidebarHidden(false);
                                        if (mode === "screenshot" || mode === "code") handleModeClick("preview");
                                    }
                                }}
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                                    !sidebarHidden && sidePanelMode === "style" && mode === "preview"
                                        ? "bg-[#f55f2a] text-white"
                                        : "bg-white text-neutral-600 hover:bg-neutral-100"
                                }`}
                                title="Styles"
                                aria-label="Styles"
                            >
                                <Palette className="h-3 w-3" aria-hidden="true" />
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    const isActive = !sidebarHidden && sidePanelMode === "meta";
                                    if (isActive) {
                                        setSidebarHidden(true);
                                    } else {
                                        setSidePanelMode("meta");
                                        setSidebarHidden(false);
                                        if (mode !== "preview") handleModeClick("preview");
                                    }
                                }}
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                                    !sidebarHidden && sidePanelMode === "meta"
                                        ? "bg-[#f55f2a] text-white"
                                        : "bg-white text-neutral-600 hover:bg-neutral-100"
                                }`}
                                title="SEO / Meta"
                                aria-label="SEO / Meta"
                            >
                                <FileText className="h-3 w-3" aria-hidden="true" />
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    const isActive = !sidebarHidden && sidePanelMode === "revision-chat";
                                    if (isActive) {
                                        setSidebarHidden(true);
                                    } else {
                                        setSidePanelMode("revision-chat");
                                        setSidebarHidden(false);
                                        if (mode !== "preview") handleModeClick("preview");
                                    }
                                }}
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                                    !sidebarHidden && sidePanelMode === "revision-chat"
                                        ? "bg-[#f55f2a] text-white"
                                        : "bg-white text-neutral-600 hover:bg-neutral-100"
                                }`}
                                title="AI edits"
                                aria-label="AI edits"
                            >
                                <MessageSquare className="h-3 w-3" aria-hidden="true" />
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    const isActive = !sidebarHidden && sidePanelMode === "ai-library";
                                    if (isActive) {
                                        setSidebarHidden(true);
                                    } else {
                                        setSidePanelMode("ai-library");
                                        setSidebarHidden(false);
                                        if (mode === "screenshot") handleModeClick("preview");
                                    }
                                }}
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                                    !sidebarHidden && sidePanelMode === "ai-library"
                                        ? "bg-[#f55f2a] text-white"
                                        : "bg-white text-neutral-600 hover:bg-neutral-100"
                                }`}
                                title="AI images"
                                aria-label="AI images"
                            >
                                <Images className="h-3 w-3" aria-hidden="true" />
                            </button>
                        </div>
                        </div>

                        {/* Device switcher */}
                        <div className="shrink-0 inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-1 shadow-md">
                            <motion.button
                                disabled={aiEditing}
                                type="button"
                                onClick={() => handleDeviceChange("desktop")}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.96 }}
                                className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                                    device === "desktop"
                                        ? "bg-[#f55f2a] text-white"
                                        : "bg-white text-neutral-600 hover:bg-neutral-100"
                                }`}
                                title="Desktop"
                            >
                                <Monitor className="h-3 w-3" />
                            </motion.button>

                            <motion.button
                                disabled={aiEditing}
                                type="button"
                                onClick={() => handleDeviceChange("tablet")}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.96 }}
                                className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                                    device === "tablet"
                                        ? "bg-[#f55f2a] text-white"
                                        : "bg-white text-neutral-600 hover:bg-neutral-100"
                                }`}
                                title="Tablet"
                            >
                                <Tablet className="h-3 w-3" />
                            </motion.button>

                            <motion.button
                                type="button"
                                disabled={aiEditing}
                                onClick={() => handleDeviceChange("mobile")}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.96 }}
                                className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                                    device === "mobile"
                                        ? "bg-[#f55f2a] text-white"
                                        : "bg-white text-neutral-600 hover:bg-neutral-100"
                                }`}
                                title="Mobile"
                            >
                                <Smartphone className="h-3 w-3" />
                            </motion.button>
                        </div>
                    </div>
                </div>
                )}

                {/* UI scale moved to bottom right */}

                <div
                    className={`relative ${isCompactLayout ? "flex h-full flex-col bg-white pt-[58px]" : "grid h-full grid-cols-1 gap-4 rounded-xl bg-white/90 p-4 shadow-xl"}`}
                    style={isCompactLayout ? undefined : {
                        transform: `scale(${effectiveUiScale})`,
                        transformOrigin: "top left",
                        width: `${100 / effectiveUiScale}%`,
                        height: `${100 / effectiveUiScale}%`,
                    }}
                >

                    {/* LEFT SIDEBAR (consistent styling) */}
                    {showSidebarPanel && (
                        <motion.aside
                            id="kloner-style-sidebar"
                            className={`pointer-events-auto bg-white flex flex-col overflow-hidden ${
                                isCompactLayout
                                    ? "relative z-20 h-full w-full bg-gray-50"
                                    : "fixed bottom-0 left-0 top-0 z-40 w-[min(92vw,520px)] rounded-r-2xl border-r border-neutral-200 shadow-xl"
                            }`}
                            initial={isCompactLayout ? { opacity: 0, y: 8 } : { x: -16, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={isCompactLayout ? { opacity: 0, y: 8 } : { x: -16, opacity: 0 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                        >
                            {/* Panel header */}
                            <div className="flex items-center justify-between px-4 py-3" style={{ backgroundColor: "rgba(245, 95, 42, 0.08)" }}>
                                <div>
                                <div className="text-sm font-semibold text-[#f55f2a]">
                                    {sidePanelMode === "style" && "🎨 Styles"}
                                    {sidePanelMode === "meta" && "🔍 SEO / Meta"}
                                    {sidePanelMode === "ai-library" && "🖼️ AI Images"}
                                    {sidePanelMode === "revision-chat" && "💬 AI Edits"}
                                    {sidePanelMode === "code" && "⌨️ Code"}
                                </div>
                                {isCompactLayout && (
                                    <div className="mt-0.5 text-[11px] text-neutral-600">
                                        Switch back to preview any time from the footer.
                                    </div>
                                )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (isCompactLayout) {
                                            setMobileTab("preview");
                                        } else {
                                            setSidebarHidden(true);
                                        }
                                    }}
                                    disabled={closing || aiEditing}
                                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-neutral-600 shadow-sm transition ${
                                        closing ? "cursor-not-allowed opacity-60" : "hover:bg-neutral-50"
                                    }`}
                                    aria-label="Close panel"
                                    title={isCompactLayout ? "Back to preview" : "Close panel"}
                                >
                                    <span className="block h-4 w-4">
                                        <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden="true">
                                            <path
                                                d="M6 6l12 12M18 6L6 18"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.8"
                                                strokeLinecap="round"
                                            />
                                        </svg>
                                    </span>
                                </button>
                            </div>

                            {isCompactLayout && (
                                <div className="border-b border-neutral-200 bg-white px-4 py-3">
                                    <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                                        <button
                                            type="button"
                                            onClick={() => openSidePanelMode("revision-chat")}
                                            className={`shrink-0 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                                                sidePanelMode === "revision-chat"
                                                    ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                    : "border-neutral-300 bg-white text-neutral-700"
                                            }`}
                                        >
                                            <MessageSquare className="h-3.5 w-3.5" />
                                            <span>AI</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => openSidePanelMode("style")}
                                            className={`shrink-0 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                                                sidePanelMode === "style"
                                                    ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                    : "border-neutral-300 bg-white text-neutral-700"
                                            }`}
                                        >
                                            <Palette className="h-3.5 w-3.5" />
                                            <span>Styles</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => openSidePanelMode("meta")}
                                            className={`shrink-0 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                                                sidePanelMode === "meta"
                                                    ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                    : "border-neutral-300 bg-white text-neutral-700"
                                            }`}
                                        >
                                            <FileText className="h-3.5 w-3.5" />
                                            <span>SEO</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => openSidePanelMode("ai-library")}
                                            className={`shrink-0 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                                                sidePanelMode === "ai-library"
                                                    ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                    : "border-neutral-300 bg-white text-neutral-700"
                                            }`}
                                        >
                                            <Images className="h-3.5 w-3.5" />
                                            <span>Images</span>
                                        </button>
                                        {isDevCodeMode && (
                                            <button
                                                type="button"
                                                onClick={() => openSidePanelMode("code")}
                                                className={`shrink-0 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                                                    sidePanelMode === "code"
                                                        ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                        : "border-neutral-300 bg-white text-neutral-700"
                                                }`}
                                            >
                                                <Code2 className="h-3.5 w-3.5" />
                                                <span>Code</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Panel body */}
                            <div className={`min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 ${isCompactLayout ? "pb-36" : ""}`}>
                                {/* STYLE MODE BODY */}
                                {!controlsCollapsed && sidePanelMode === "style" && (
                                    <>
                                        {mode === "preview" && (
                                            <div
                                                className="mt-1 border-t border-neutral-200 pt-3 text-[12px]"
                                                id="kloner-selection-style"
                                            >
                                                <div className="mb-3 flex items-center justify-between">
                                                    <div className="text-[18px] font-medium text-neutral-800">
                                                        {selectionMeta.has
                                                            ? selectionMeta.tagName || "Element"
                                                            : "Select element to style"}
                                                    </div>
                                                    <div className="text-[16px] text-neutral-500 font-medium">
                                                        {device.toUpperCase()}
                                                    </div>
                                                </div>

                                                <div className="space-y-3 text-[12px] max-h-64 overflow-y-auto pr-1 lg:max-h-none">
                                                    {(mergedThemeColors.length || theme.fontFamilies.length) > 0 && (
                                                        <div className="space-y-4">
                                                            {mergedThemeColors.length > 0 && (
                                                                <div>
                                                                    <div className="mb-2 text-[16px] font-medium text-neutral-600">
                                                                        Text
                                                                    </div>
                                                                    <div className="grid grid-cols-6 gap-2">
                                                                        {mergedThemeColors.map((c) => (
                                                                            <button
                                                                                key={`theme-text-${c}`}
                                                                                type="button"
                                                                                className="h-8 w-8 rounded border border-black/10 shadow-sm transition hover:scale-105 active:scale-95 disabled:opacity-40"
                                                                                style={{ background: c }}
                                                                                disabled={closing}
                                                                                onClick={() =>
                                                                                    sendStyleCommand({
                                                                                        kind: "textColor",
                                                                                        value: c,
                                                                                    })
                                                                                }
                                                                            />
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {mergedThemeColors.length > 0 && (
                                                                <div>
                                                                    <div className="mb-2 text-[16px] font-medium text-neutral-600">
                                                                        Background
                                                                    </div>

                                                                    <div className="mb-3 grid grid-cols-6 gap-2">
                                                                        {mergedThemeColors.map((c) => (
                                                                            <button
                                                                                key={`theme-bg-${c}`}
                                                                                type="button"
                                                                                className="h-8 w-8 rounded border border-black/10 shadow-sm transition hover:scale-105 active:scale-95 disabled:opacity-40"
                                                                                style={{ background: c }}
                                                                                disabled={closing}
                                                                                onClick={() =>
                                                                                    sendStyleCommand({
                                                                                        kind: "bgColor",
                                                                                        value: c,
                                                                                    })
                                                                                }
                                                                            />
                                                                        ))}

                                                                        <button
                                                                            key="transparent-bg"
                                                                            type="button"
                                                                            disabled={closing}
                                                                            onClick={() =>
                                                                                sendStyleCommand({
                                                                                    kind: "bgColor",
                                                                                    value: "transparent",
                                                                                })
                                                                            }
                                                                            className="inline-flex h-8 w-8 items-center justify-center rounded border border-dashed border-neutral-400 bg-white text-[10px] font-medium text-neutral-600 shadow-sm transition hover:bg-neutral-50 hover:scale-105 active:scale-95 disabled:opacity-40"
                                                                            title="Transparent"
                                                                        >
                                                                            ⌀
                                                                        </button>
                                                                    </div>

                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-[16px] font-medium text-neutral-600">
                                                                            Custom
                                                                        </span>

                                                                        <input
                                                                            type="color"
                                                                            value={customBgColor}
                                                                            disabled={closing}
                                                                            onChange={(e) => {
                                                                                const value = e.target.value;
                                                                                setCustomBgColor(value);
                                                                                sendStyleCommand({
                                                                                    kind: "bgColor",
                                                                                    value,
                                                                                });
                                                                            }}
                                                                            className="h-6 w-6 cursor-pointer rounded border border-black/10 bg-transparent p-0"
                                                                        />

                                                                        <input
                                                                            type="text"
                                                                            value={customBgColor}
                                                                            disabled={closing}
                                                                            onChange={(e) => {
                                                                                const raw = e.target.value.trim();
                                                                                setCustomBgColor(raw);
                                                                            }}
                                                                            onBlur={() => {
                                                                                const v = customBgColor.trim();
                                                                                if (!v) return;
                                                                                const hex = v.startsWith("#") ? v : `#${v}`;
                                                                                if (hex.length === 4 || hex.length === 7) {
                                                                                    setCustomBgColor(hex);
                                                                                    sendStyleCommand({
                                                                                        kind: "bgColor",
                                                                                        value: hex,
                                                                                    });
                                                                                }
                                                                            }}
                                                                            className="h-6 flex-1 rounded border border-neutral-300 bg-white px-2 text-[12px] text-neutral-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                                                                            placeholder="#ffffff"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Font */}
                                                    <div>
                                                        <div className="mb-2 text-[13px] font-medium text-neutral-800">
                                                            Font
                                                        </div>
                                                        <select
                                                            className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-[12px] shadow-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 disabled:opacity-50"
                                                            disabled={closing}
                                                            onChange={(e) => {
                                                                const opt = FONT_OPTIONS.find(
                                                                    (f) => f.id === e.target.value,
                                                                );
                                                                if (!opt) return;
                                                                sendStyleCommand({
                                                                    kind: "fontFamily",
                                                                    value: opt.css,
                                                                });
                                                            }}
                                                            defaultValue=""
                                                        >
                                                            <option value="" disabled>
                                                                Choose font
                                                            </option>
                                                            {FONT_OPTIONS.map((f) => (
                                                                <option
                                                                    key={f.id}
                                                                    value={f.id}
                                                                    style={{ fontFamily: f.css }}
                                                                >
                                                                    {f.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    {/* Size & headings */}
                                                    <div>
                                                        <div className="mb-2 text-[13px] font-medium text-neutral-800">
                                                            Size
                                                        </div>
                                                        <div className="flex flex-wrap gap-2">
                                                            {FONT_SIZE_PRESETS.map((s) => (
                                                                <button
                                                                    key={s.id}
                                                                    type="button"
                                                                    className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                    disabled={closing}
                                                                    onClick={() =>
                                                                        sendStyleCommand({
                                                                            kind: "fontSizePx",
                                                                            value: s.px,
                                                                        })
                                                                    }
                                                                >
                                                                    {s.label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Text align */}
                                                    <div>
                                                        <div className="mb-2 text-[13px] font-medium text-neutral-800">
                                                            Align
                                                        </div>
                                                        <div className="flex gap-2">
                                                            {[
                                                                { id: "left", label: "Left" },
                                                                { id: "center", label: "Center" },
                                                                { id: "right", label: "Right" },
                                                            ].map((a) => (
                                                                <button
                                                                    key={a.id}
                                                                    type="button"
                                                                    className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                    disabled={closing}
                                                                    onClick={() =>
                                                                        sendStyleCommand({
                                                                            kind: "align",
                                                                            value: a.id as "left" | "center" | "right",
                                                                        })
                                                                    }
                                                                >
                                                                    {a.label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Weight & transform */}
                                                    <div>
                                                        <div className="mb-2 text-[13px] font-medium text-neutral-800">
                                                            Weight
                                                        </div>

                                                        <div className="flex flex-wrap gap-2">
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-light shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "weight",
                                                                        value: "300",
                                                                    })
                                                                }
                                                            >
                                                                Light
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-normal shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "weight",
                                                                        value: "400",
                                                                    })
                                                                }
                                                            >
                                                                Regular
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "weight",
                                                                        value: "500",
                                                                    })
                                                                }
                                                            >
                                                                Medium
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-semibold shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "weight",
                                                                        value: "600",
                                                                    })
                                                                }
                                                            >
                                                                Semibold
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-bold shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "weight",
                                                                        value: "700",
                                                                    })
                                                                }
                                                            >
                                                                Bold
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Text transform */}
                                                    <div>
                                                        <div className="mb-2 text-[13px] font-medium text-neutral-800">
                                                            Transform
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "transform",
                                                                        value: "uppercase",
                                                                    })
                                                                }
                                                            >
                                                                UPPER
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "transform",
                                                                        value: "none",
                                                                    })
                                                                }
                                                            >
                                                                Normal
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Text color */}
                                                    <div>
                                                        <div className="mb-2 text-[13px] font-medium text-neutral-800">
                                                            Text Color
                                                        </div>

                                                        <div className="mb-3 grid grid-cols-6 gap-2">
                                                            {TEXT_COLOR_SWATCHES.map((c) => (
                                                                <button
                                                                    key={c}
                                                                    type="button"
                                                                    className="h-8 w-8 rounded border border-black/10 shadow-sm transition hover:scale-105 active:scale-95 disabled:opacity-40"
                                                                    style={{ background: c }}
                                                                    disabled={closing}
                                                                    onClick={() =>
                                                                        sendStyleCommand({
                                                                            kind: "textColor",
                                                                            value: c,
                                                                        })
                                                                    }
                                                                />
                                                            ))}
                                                        </div>

                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[16px] font-medium text-neutral-600">
                                                                Custom
                                                            </span>

                                                            <input
                                                                type="color"
                                                                value={customTextColor}
                                                                disabled={closing}
                                                                onChange={(e) => {
                                                                    const value = e.target.value;
                                                                    setCustomTextColor(value);
                                                                    sendStyleCommand({
                                                                        kind: "textColor",
                                                                        value,
                                                                    });
                                                                }}
                                                                className="h-6 w-6 cursor-pointer rounded border border-black/10 bg-transparent p-0"
                                                            />

                                                            <input
                                                                type="text"
                                                                value={customTextColor}
                                                                disabled={closing}
                                                                onChange={(e) => {
                                                                    const raw = e.target.value.trim();
                                                                    setCustomTextColor(raw);
                                                                }}
                                                                onBlur={() => {
                                                                    const v = customTextColor.trim();
                                                                    if (!v) return;
                                                                    const hex = v.startsWith("#") ? v : `#${v}`;
                                                                    if (hex.length === 4 || hex.length === 7) {
                                                                        setCustomTextColor(hex);
                                                                        sendStyleCommand({
                                                                            kind: "textColor",
                                                                            value: hex,
                                                                        });
                                                                    }
                                                                }}
                                                                className="h-6 flex-1 rounded border border-neutral-300 bg-white px-2 text-[12px] text-neutral-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                                                                placeholder="#111827"
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Background */}
                                                    <div>
                                                        <div className="mb-2 text-[13px] font-medium text-neutral-800">
                                                            Background
                                                        </div>
                                                        <div className="grid grid-cols-6 gap-2">
                                                            {BG_COLOR_SWATCHES.map((c) => (
                                                                <button
                                                                    key={c}
                                                                    type="button"
                                                                    className="h-8 w-8 rounded border border-black/10 shadow-sm transition hover:scale-105 active:scale-95 disabled:opacity-40"
                                                                    style={{ background: c }}
                                                                    disabled={closing}
                                                                    onClick={() =>
                                                                        sendStyleCommand({
                                                                            kind: "bgColor",
                                                                            value: c,
                                                                        })
                                                                    }
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Spacing */}
                                                    <div>
                                                        <div className="mb-2 text-[13px] font-medium text-neutral-800">
                                                            Spacing
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "letterSpacing",
                                                                        value: "-0.02em",
                                                                    })
                                                                }
                                                            >
                                                                Tight
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "letterSpacing",
                                                                        value: "0",
                                                                    })
                                                                }
                                                            >
                                                                Normal
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "letterSpacing",
                                                                        value: "0.08em",
                                                                    })
                                                                }
                                                            >
                                                                Wide
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Layout */}
                                                    <div>
                                                        <div className="mb-2 text-[13px] font-medium text-neutral-800">
                                                            Layout
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "blockAlign",
                                                                        value: "left",
                                                                    })
                                                                }
                                                            >
                                                                Left
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "blockAlign",
                                                                        value: "center",
                                                                    })
                                                                }
                                                            >
                                                                Center
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "blockAlign",
                                                                        value: "right",
                                                                    })
                                                                }
                                                            >
                                                                Right
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}



                                        {/* Screenshot mode hint (still lives under style panel) */}
                                        {isDevCodeMode && mode === "screenshot" && (
                                            <div className="mt-4 text-[12px] text-slate-600">
                                                Edit in Preview, apply with &quot;Apply changes&quot;.
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* CODE MODE BODY – separate branch */}
                                {isDevCodeMode && sidePanelMode === "code" && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">HTML Code</div>
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    try {
                                                        await navigator.clipboard.writeText(htmlDraft);
                                                    } catch {
                                                        const el = document.createElement('textarea');
                                                        el.value = htmlDraft;
                                                        document.body.appendChild(el);
                                                        el.select();
                                                        document.execCommand('copy');
                                                        document.body.removeChild(el);
                                                    }
                                                }}
                                                className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 active:scale-95"
                                            >
                                                Copy HTML
                                            </button>
                                        </div>
                                        <div className="min-h-0 flex-1">
                                            <textarea
                                                className="h-[60vh] w-full resize-none rounded-xl border border-neutral-200 bg-white p-4 font-mono text-sm leading-6 text-neutral-900 shadow-sm outline-none placeholder:text-neutral-400 focus:border-[#f55f2a] focus:ring-2 focus:ring-[#f55f2a]/20 disabled:opacity-60"
                                                value={htmlDraft}
                                                onChange={(e) => setHtmlDraft(e.target.value)}
                                                spellCheck={false}
                                                disabled={closing}
                                                placeholder="Enter your HTML code here..."
                                            />
                                        </div>
                                    </div>
                                )}

                                {sidePanelMode === "ai-library" && (
                                    <AiImageLibraryPanel
                                        iframeRef={iframeRef}
                                        user={user}
                                        renderId={draftId ?? null}
                                    />
                                )}

                                {sidePanelMode === "meta" && (
                                    <MetaSettings
                                        key={currentPageKey}
                                        draftId={draftId}
                                        meta={currentSeoMeta}
                                        uploadFileToUserBlob={uploadFileToUserBlob as any}
                                        onSaveMeta={handleSaveMetaForCurrentPage}
                                    />
                                )}

                                {sidePanelMode === "revision-chat" && (
                                    <AiEditPanelV2
                                        renderId={draftId ?? undefined}
                                        refreshNonce={aiHistoryRefreshNonce}
                                        getSelectedBlockHtml={getSelectedBlockHtml}
                                        selectionMeta={selectionMeta}
                                        onAiHistoryChange={setAiHistory}
                                        onApplyBlockHtml={applyAiEditedBlockHtml}
                                        onAiEditingStateChange={(isEditing) => {
                                            setAiEditing(isEditing);
                                        }}
                                    />
                                )}
                            </div>
                        </motion.aside>
                    )}



                    {/* Right / canvas */}
                    {showCanvasPanel && (
                    <section className={`relative flex flex-col overflow-hidden ${isCompactLayout ? "min-h-0 flex-1 bg-slate-50 pb-32" : "max-lg:order-1 rounded-lg border bg-slate-50"}`}>
                        {mode === "preview" && draftId && (
                            <div
                                className="border-t max-h-72 overflow-auto"
                                id="kloner-ai-edit-panel"
                            >

                            </div>
                        )}


                        {showSaveNudge && (
                            <div className="mt-4 flex justify-center mt-3 pointer-events-none z-[96] rounded-full bg-green-600 text-white hover:bg-green-700 text-white hover:brightness-95 shadow-lg px-4 py-2 text-sm">
                                This is a one-time friendly reminder to save or apply your changes as you edit, so you don’t lose them.
                            </div>
                        )}

                        {allPages && allPages.length > 0 && (
                            <div
                                className={
                                    isCompactLayout
                                        ? "mt-3 overflow-x-auto px-3"
                                        : "mt-20"
                                }
                            >
                                <div
                                    className={
                                        isCompactLayout
                                            ? "inline-flex min-w-max"
                                            : "flex justify-center"
                                    }
                                >
                                    <div
                                        id="kloner-page-switcher"
                                        className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/90/80 px-2 py-1 shadow-sm"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setShowPageLayers((open) => !open)}
                                            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-100"
                                        >
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 20 20"
                                                fill="currentColor"
                                                className="h-4 w-4"
                                            >
                                                <path d="M10 2L2 6l8 4 8-4-8-4z" />
                                                <path d="M2 10l8 4 8-4" />
                                                <path d="M2 14l8 4 8-4" />
                                            </svg>
                                            <span>Pages</span>
                                        </button>

                                        <div className="inline-flex items-center gap-2">
                                            {allPages.map((p) => {
                                                const isActive = p.id === activePageId;
                                                const isArchived = archivedPageIds.includes(p.id);

                                                const baseClasses =
                                                    "px-3 py-2 rounded-full text-xs font-semibold transition-colors flex items-center gap-2 border";
                                                const stateClasses = isArchived
                                                    ? "bg-neutral-100 text-neutral-400 border-neutral-200/80 opacity-70 cursor-default"
                                                    : isActive
                                                        ? "bg-accent text-white border-transparent"
                                                        : "bg-white/90 text-neutral-700 hover:bg-neutral-100 border-neutral-200";

                                                return (
                                                    <motion.div
                                                        key={p.id}
                                                        layout
                                                        initial={{ opacity: 0, scale: 0.9, y: 2 }}
                                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                                        exit={{ opacity: 0, scale: 0.9, y: 2 }}
                                                        className="inline-flex flex-col items-center"
                                                    >
                                                        <motion.button
                                                            type="button"
                                                            onClick={() => {
                                                                if (!isArchived) handlePageSwitch(p.id);
                                                            }}
                                                            whileHover={!isArchived ? { scale: 1.03, y: -1 } : undefined}
                                                            whileTap={!isArchived ? { scale: 0.97 } : undefined}
                                                            className={[baseClasses, stateClasses].join(" ")}
                                                        >
                                                            <span>{p.id}</span>

                                                            {!isArchived && (
                                                                <a
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        archivePage(p.id);
                                                                    }}
                                                                    title="Archive page"
                                                                    className={[
                                                                        "flex h-5 w-5 items-center justify-center rounded-full transition",
                                                                        isActive
                                                                            ? "bg-white/90/20 text-white hover:bg-white/90/30"
                                                                            : "bg-neutral-200 text-neutral-700 hover:bg-neutral-300",
                                                                    ].join(" ")}
                                                                >
                                                                    <svg
                                                                        xmlns="http://www.w3.org/2000/svg"
                                                                        viewBox="0 0 20 20"
                                                                        fill="currentColor"
                                                                        className="h-5 w-5"
                                                                    >
                                                                        <path d="M5 3a2 2 0 00-2 2v4h2V5h10v4h2V5a2 2 0 00-2-2H5z" />
                                                                        <path d="M3 11v4a2 2 0 002 2h10a2 2 0 002-2v-4h-3a3 3 0 01-6 0H3z" />
                                                                    </svg>
                                                                </a>
                                                            )}
                                                        </motion.button>

                                                        {isArchived && (
                                                            <button
                                                                type="button"
                                                                onClick={() => restorePage(p.id)}
                                                                className="mt-1 text-[13px] font-medium text-green-600 hover:text-green-700"
                                                            >
                                                                Restore
                                                            </button>
                                                        )}
                                                    </motion.div>
                                                );
                                            })}

                                            {/* ADD PAGE BUTTON (always visible) */}
                                            <motion.button
                                                type="button"
                                                onClick={openNewPageModal}
                                                whileHover={{ scale: 1.04, y: -1 }}
                                                whileTap={{ scale: 0.98 }}
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white/90 text-neutral-900 shadow-sm hover:bg-neutral-100"
                                                title="Add new page"
                                            >
                                                <svg
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    viewBox="0 0 20 20"
                                                    fill="currentColor"
                                                    className="h-4 w-4"
                                                >
                                                    <path
                                                        fillRule="evenodd"
                                                        d="M10 4a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 0110 4z"
                                                        clipRule="evenodd"
                                                    />
                                                </svg>
                                            </motion.button>
                                        </div>
                                    </div>
                                </div>

                                {/* MODAL */}
                                <AnimatePresence>
                                    {showNewPageModal && (
                                        <motion.div
                                            key="new-page-modal"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
                                            onMouseDown={(e) => {
                                                if (e.target === e.currentTarget) closeNewPageModal();
                                            }}
                                        >
                                            <motion.div
                                                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                                                transition={{ duration: 0.18, ease: "easeOut" }}
                                                className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white shadow-2xl"
                                            >
                                                <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
                                                    <div className="space-y-1">
                                                        <div className="text-sm font-semibold text-neutral-900">
                                                            Add a new page
                                                        </div>
                                                        <div className="text-xs text-neutral-600">
                                                            Generates a new page only. Existing pages remain unchanged.
                                                        </div>
                                                    </div>

                                                    <button
                                                        type="button"
                                                        onClick={closeNewPageModal}
                                                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200"
                                                        title="Close"
                                                        disabled={creatingPage}
                                                    >
                                                        <svg
                                                            xmlns="http://www.w3.org/2000/svg"
                                                            viewBox="0 0 20 20"
                                                            fill="currentColor"
                                                            className="h-4 w-4 text-neutral-700"
                                                        >
                                                            <path
                                                                fillRule="evenodd"
                                                                d="M4.47 4.47a.75.75 0 011.06 0L10 8.94l4.47-4.47a.75.75 0 111.06 1.06L11.06 10l4.47 4.47a.75.75 0 11-1.06 1.06L10 11.06l-4.47 4.47a.75.75 0 11-1.06-1.06L8.94 10 4.47 5.53a.75.75 0 010-1.06z"
                                                                clipRule="evenodd"
                                                            />
                                                        </svg>
                                                    </button>
                                                </div>

                                                <div className="space-y-4 px-5 py-4">
                                                    <div className="space-y-2">
                                                        <label className="text-xs font-semibold text-neutral-700">Link URL</label>


                                                        {/* slug input with fixed "/" prefix */}
                                                        <div
                                                            className={[
                                                                "flex items-center overflow-hidden rounded-xl border bg-white",
                                                                newPageUrlErr
                                                                    ? "border-red-300 focus-within:border-red-400"
                                                                    : "border-neutral-200 focus-within:border-neutral-300",
                                                            ].join(" ")}
                                                        >
                                                            <div className="select-none px-3 py-2 text-sm text-neutral-400">/</div>

                                                            <input
                                                                value={newPageUrl}
                                                                onChange={(e) => {
                                                                    setCreatePageErr(null);
                                                                    setNewPageUrl(e.target.value);
                                                                }}
                                                                placeholder="pricing or blog/guides"
                                                                className="w-full bg-transparent px-0 py-2 pr-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                                                                disabled={creatingPage || aiEditing}
                                                                inputMode="text"
                                                                autoCapitalize="none"
                                                                autoCorrect="off"
                                                                spellCheck={false}
                                                            />
                                                        </div>

                                                        {/* instant validation feedback */}
                                                        {newPageUrlErr ? (
                                                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                                                                {newPageUrlErr}
                                                            </div>
                                                        ) : (
                                                            <div className="text-[13px] text-neutral-500">
                                                                Examples: pricing, about, blog/guides
                                                            </div>
                                                        )}


                                                        <div className="text-[13px] text-neutral-500">
                                                            Example: pricing, about, services (only a-z, 0-9, and -)
                                                        </div>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className="text-xs font-semibold text-neutral-700">Describe your new page</label>
                                                        <textarea
                                                            value={newPagePrompt}
                                                            onChange={(e) => {
                                                                setCreatePageErr(null);
                                                                setNewPagePrompt(e.target.value);
                                                            }}
                                                            placeholder="Describe your new page"
                                                            rows={4}
                                                            className="w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-300"
                                                            disabled={creatingPage || aiEditing}
                                                        />
                                                    </div>

                                                    {createPageErr && (
                                                        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                                                            {createPageErr}
                                                        </div>
                                                    )}

                                                    <div className="flex items-center justify-end gap-2 pt-1">
                                                        <button
                                                            type="button"
                                                            onClick={closeNewPageModal}
                                                            className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
                                                            disabled={creatingPage || aiEditing}
                                                        >
                                                            Cancel
                                                        </button>

                                                        {isDevCodeMode && (
                                                            <button
                                                                type="button"
                                                                onClick={async () => {
                                                                    if (creatingPage || aiEditing) return;
                                                                    setShowNewPageModal(false);
                                                                    setAiEditing(true);
                                                                    try {
                                                                        await createNewPageWithAi();
                                                                    } finally {
                                                                        setAiEditing(false);
                                                                    }
                                                                }}
                                                                disabled={creatingPage || aiEditing}
                                                                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60"
                                                            >
                                                                {creatingPage || aiEditing ? "Creating…" : "Create page"}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </motion.div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}


                        {(mode === "preview" || (isDevCodeMode && mode === "code")) && (
                            <div
                                ref={iframeWrapperRef}
                                className={
                                    isPreviewFullscreen
                                        ? "flex-1 min-h-0 flex flex-col overflow-hidden"
                                        : isCompactLayout
                                            ? "flex-1 overflow-auto px-3 pb-6 pt-3"
                                            : "flex-1 overflow-auto p-3 sm:p-6"
                                }
                            >
                                <AnimatePresence mode="wait">
                                    <motion.div
                                        key={activePageId}
                                        drag
                                        dragControls={previewDragControls}
                                        dragListener={false}
                                        dragMomentum={false}
                                        dragElastic={0}
                                        className={
                                            isPreviewFullscreen
                                                ? "flex-1 min-h-0 flex items-stretch justify-end"
                                                : 'mx-auto'
                                        }
                                        style={
                                            isPreviewFullscreen
                                                ? { width: "100%", minWidth: 320, maxWidth: "100%" }
                                                : { width: devicePx, minWidth: 320, maxWidth: "100%" }
                                        }
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -6 }}
                                        transition={{ duration: 0.22 }}
                                    >
                                        {device === "desktop" && (
                                            <div
                                                className="flex-1 min-h-0 rounded-xl border border-neutral-800 bg-neutral-950/90 shadow-xl overflow-hidden flex flex-col"
                                                id="kloner-home">
                                                <div
                                                    className="flex cursor-move items-center gap-2 px-4 py-2 border-b border-neutral-800 bg-neutral-900/90"
                                                    onPointerDown={(e) => {
                                                        if (e.button !== 0 || e.buttons !== 1) return;
                                                        e.preventDefault();
                                                        setIsDraggingPreview(true);
                                                        previewDragControls.start(e);
                                                    }}
                                                >
                                                    <div className="flex gap-1.5">
                                                        <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                                                        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                                                        <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                                                    </div>

                                                    <div className="mx-auto h-6 max-w-xs flex-1 rounded-full bg-neutral-800/90 text-[12px] text-neutral-400 px-3 flex items-center">
                                                        preview.kloner
                                                    </div>

                                                    <div id="kloner-quick-undo" className="flex items-center gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={togglePreviewFullscreen}
                                                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/80 transition"
                                                            aria-label={isPreviewFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                                                        >
                                                            {isPreviewFullscreen ? (
                                                                <Minimize2 className="h-5 w-5" />
                                                            ) : (
                                                                <Maximize2 className="h-5 w-5" />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>

                                                <div
                                                    className="bg-white/90 flex-2 min-h-0 overflow-auto"
                                                    style={{ pointerEvents: isDraggingPreview ? "none" : "auto" }}
                                                >
                                                    {iframeNode}
                                                </div>
                                            </div>
                                        )}

                                        {device === "tablet" && (
                                            <div
                                                onPointerDown={(e) => {
                                                    if (e.button !== 0 || e.buttons !== 1) return;
                                                    e.preventDefault();
                                                    setIsDraggingPreview(true);
                                                    previewDragControls.start(e);
                                                }}
                                                className="mx-auto cursor-move ounded-[28px] border rounded-[36px] border-neutral-700 bg-neutral-950/90 px-4 pt-4 pb-6 shadow-xl"
                                            >
                                                <div className="flex items-center justify-end gap-1.5">
                                                </div>
                                                <div className="mx-auto mb-2 h-1.5 w-20 rounded-full bg-neutral-700" />
                                                <div
                                                    className="overflow-hidden rounded-[20px]"
                                                    style={{ pointerEvents: isDraggingPreview ? "none" : "auto" }}
                                                >
                                                    {iframeNode}
                                                </div>
                                            </div>
                                        )}

                                        {device === "mobile" && (
                                            <div
                                                onPointerDown={(e) => {
                                                    if (e.button !== 0 || e.buttons !== 1) return;
                                                    e.preventDefault();
                                                    setIsDraggingPreview(true);
                                                    previewDragControls.start(e);
                                                }}
                                                className="cursor-move mx-auto w-[380px] sm:w-[460px] max-w-full rounded-[36px] border border-neutral-800 bg-neutral-950/90 px-3 pt-4 pb-5 shadow-xl"
                                            >
                                                <div className="flex items-center justify-end gap-1.5">
                                                    {/* UNDO
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const api = iframeRef.current?.contentWindow?.__klonerApi;
                                                            if (api?.undo) api.undo();
                                                        }}
                                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/80 transition"
                                                        aria-label="Undo"
                                                    >
                                                        <Undo2 className="h-5 w-5" />
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const api = iframeRef.current?.contentWindow?.__klonerApi;
                                                            if (api?.redo) api.redo();
                                                        }}
                                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/80 transition"
                                                        aria-label="Redo"
                                                    >
                                                        <Redo2 className="h-5 w-5" />
                                                    </button> */}
                                                </div>
                                                <div className="mx-auto mb-3 h-2 w-24 rounded-full bg-neutral-700" />
                                                <div
                                                    className="overflow-hidden rounded-[28px]"
                                                    style={{ pointerEvents: isDraggingPreview ? "none" : "auto" }}
                                                >
                                                    {iframeNode}
                                                </div>
                                                <div className="mx-auto mt-3 h-7 w-24 rounded-full border border-neutral-700" />
                                            </div>
                                        )}


                                    </motion.div>
                                </AnimatePresence>
                            </div>
                        )}


                        <MiniToolbar
                            iframeRef={iframeRef}
                            wrapperRef={iframeWrapperRef}
                            selectionMeta={selectionMeta}
                            uiScale={uiScale}
                            aiEditing={aiEditing}
                            onAiEditRequest={runAiEditFromMiniToolbar}
                        />
                        {mode === "screenshot" && (
                            <div className={`flex-1 overflow-auto ${isCompactLayout ? "px-3 pb-36 pt-3" : "p-6"}`}>
                                <div
                                    className="mx-auto"
                                    style={{ width: devicePx, minWidth: 320 }}
                                >
                                    {activeSourceImage ? (
                                        <Image
                                            src={activeSourceImage}
                                            alt="Reference"
                                            width={1200}
                                            height={800}
                                            className="w-full h-auto rounded border bg-white/90"
                                        />
                                    ) : (
                                        <div className="h-[60vh] grid place-items-center text-slate-500 text-md">
                                            No reference screenshot
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {closing && (
                            <div className="absolute inset-0 bg-white/90/80 grid place-items-center">
                                <div className="flex items-center gap-3 rounded border px-3 py-2 bg-white/90 text-md text-neutral-800">
                                    <Spinner /> Saving & closing…
                                </div>
                            </div>
                        )}

                        {/* Right-side history menu (top-right overlay) */}
                        {historyOpen ? (
                            <div
                                id="kloner-history"
                                className="hidden lg:block absolute top-20 right-3 z-[80] w-72 max-h-[70vh]"
                            >
                                <div className="flex flex-col rounded-lg border border-neutral-200 bg-white/90/95 shadow-lg">
                                    <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200">
                                        <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                                            History
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setHistoryOpen(false)}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 bg-white/90 text-neutral-500 shadow-sm hover:bg-neutral-100 hover:text-neutral-800"
                                            title="Hide history"
                                        >
                                            <EyeOff className="w-4 h-4" />
                                            <span className="sr-only">Hide history</span>
                                        </button>
                                    </div>

                                    <div className="min-h-0 flex-1 overflow-y-auto p-2 bg-white">
                                        <HistoryPanel
                                            snapshots={mergedHistory}
                                            onRestore={handleRestoreSnapshot}
                                            activeId={activeHistoryId}
                                            onDelete={deleteHistoryItem}
                                            onClearAll={clearHistory}
                                        />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                id="kloner-history-button"
                                onClick={() => setHistoryOpen(true)}
                                className="hidden lg:flex absolute top-20 right-3 z-[70] h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white/90/95 text-neutral-600 shadow-md hover:bg-neutral-100 hover:text-neutral-800"
                                title="Show edit history"
                            >
                                <Eye className="w-4 h-4" />
                                <span className="sr-only">Show history</span>
                            </button>
                        )}


                        {/* Mobile footer actions */}
                        {isCompactLayout && (
                        <div className="fixed bottom-0 left-0 right-0 z-[105] bg-white/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-6px_16px_rgba(15,23,42,0.14)]">
                            <div role="tablist" aria-label="Preview editor tabs" className="mb-3 grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={mobileTab === "preview"}
                                    onClick={() => {
                                        setMobileTab("preview");
                                        setMobileControlsOpen(false);
                                    }}
                                    className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition-colors ${
                                        mobileTab === "preview"
                                            ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                            : "border-neutral-300 bg-white text-neutral-800"
                                    }`}
                                >
                                    <Monitor className="h-4 w-4" />
                                    <span>Preview</span>
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={mobileTab === "panel"}
                                    onClick={() => {
                                        setMobileTab("panel");
                                        setSidebarHidden(false);
                                        setMobileControlsOpen(false);
                                    }}
                                    className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition-colors ${
                                        mobileTab === "panel"
                                            ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                            : "border-neutral-300 bg-white text-neutral-800"
                                    }`}
                                >
                                    <MessageSquare className="h-4 w-4" />
                                    <span>Agent</span>
                                </button>
                            </div>

                            <div className="flex flex-inline gap-2" id="kloner-save-changes-mobile">
                                <motion.button
                                    whileHover={{ y: -0.5 }}
                                    whileTap={{ scale: 0.99 }}
                                    onClick={() => doSave()}
                                    disabled={closing || savingDraft || !dirty}
                                    aria-busy={applyingPreview}
                                    className={`w-full rounded-md px-3 py-3 text-lg font-semibold transition focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-60 ${dirty
                                        ? "bg-green-600 text-white hover:bg-green-700"
                                        : "bg-green-50 text-green-700"
                                        }`}
                                    title="Apply current draft to the live preview"
                                    type="button"
                                >
                                    {applyingPreview
                                        ? "Updating preview…"
                                        : dirty
                                            ? "Apply"
                                            : "Saved"}
                                </motion.button>

                                <button
                                    onClick={() => {
                                        if (dirty) setClosePrompt(true);
                                        else performClose("discard");
                                    }}
                                    disabled={closing}
                                    type="button"
                                    className={`w-full rounded-md px-3 py-3 text-lg font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-300 active:scale-[.99] ${closing
                                        ? "cursor-not-allowed bg-accent text-white opacity-80"
                                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                        }`}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                        )}


                        {!isCompactLayout && (
                        <div className="hidden lg:block mb-3" style={{ marginLeft: !sidebarHidden ? "540px" : "20px", marginRight: "20px" }} id="kloner-apply-changes">
                            {/* V2 Badge above Apply button */}
                            <div className="flex items-center justify-between mb-2">
                                <div className="inline-flex items-center gap-1 rounded-full bg-[#f55f2a] px-2 py-1 text-[10px] font-semibold text-white shadow-md">
                                    V2
                                </div>
                                {/* UI scale controls */}
                                <div className="flex items-center gap-2 rounded-full bg-white shadow-md px-2 py-1">
                                    <div className="flex items-center gap-1 text-[13px] font-semibold text-slate-600">
                                        <button
                                            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white text-neutral-600 shadow-md hover:bg-neutral-50"
                                            onClick={() => setUiScale((s) => Math.max(0.5, +(s - 0.05).toFixed(2)))}
                                            disabled={closing}
                                        >
                                            −
                                        </button>
                                        <span className="w-10 text-center">{Math.round(uiScale * 100)}%</span>
                                        <button
                                            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white text-neutral-600 shadow-md hover:bg-neutral-50"
                                            onClick={() => setUiScale((s) => Math.min(1.25, +(s + 0.05).toFixed(2)))}
                                            disabled={closing}
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    bumpSessionCounter("save")
                                    doSave()
                                }}
                                disabled={closing || savingDraft || !dirty}
                                aria-busy={applyingPreview}
                                className={`rounded-xl px-4 py-4 w-full text-xl font-semibold transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-green-500 active:scale-[.99] ${dirty
                                    ? "bg-green-600 text-white hover:bg-green-700 shadow-lg"
                                    : "bg-neutral-100 text-neutral-600 pointer-events-none"
                                    }`}
                                title="Apply current draft to the live preview"
                            >
                                {applyingPreview || savingDraft ? (
                                    <div className="flex items-center justify-center gap-2">
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        Updating preview…
                                    </div>
                                ) : dirty ? (
                                    "Apply changes"
                                ) : (
                                    "Preview is up to date"
                                )}
                            </button>
                        </div>
                        )}

                        {isCompactLayout && mobileControlsOpen && (
                            <div
                                className="fixed inset-0 z-[106] flex items-end bg-black/40 backdrop-blur-[1px]"
                                role="dialog"
                                aria-modal="true"
                                aria-label="Preview editor controls"
                                onClick={() => setMobileControlsOpen(false)}
                            >
                                <div
                                    className="w-full rounded-t-2xl border border-neutral-200 bg-white shadow-2xl"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="flex items-center justify-between border-b border-neutral-200 p-4">
                                        <div>
                                            <div className="font-semibold text-neutral-900">Controls</div>
                                            <div className="text-[11px] text-neutral-600">Preview editor</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setMobileControlsOpen(false)}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700"
                                            title="Close controls"
                                            aria-label="Close controls"
                                        >
                                            <span className="block h-[18px] w-[18px]">
                                                <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden="true">
                                                    <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                                </svg>
                                            </span>
                                        </button>
                                    </div>

                                    <div className="space-y-4 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                                        <div>
                                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">View</div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setMobileControlsOpen(false);
                                                        setMobileTab("preview");
                                                        handleModeClick("preview");
                                                    }}
                                                    className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold ${
                                                        mode === "preview"
                                                            ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                            : "border-neutral-300 bg-white text-neutral-800"
                                                    }`}
                                                >
                                                    <Eye className="h-4 w-4" />
                                                    <span>Preview</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={openScreenshotMode}
                                                    className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold ${
                                                        mode === "screenshot"
                                                            ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                            : "border-neutral-300 bg-white text-neutral-800"
                                                    }`}
                                                >
                                                    <Camera className="h-4 w-4" />
                                                    <span>Reference</span>
                                                </button>
                                                {isDevCodeMode && (
                                                    <button
                                                        type="button"
                                                        onClick={() => openSidePanelMode("code")}
                                                        className={`col-span-2 inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold ${
                                                            mode === "code"
                                                                ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                                : "border-neutral-300 bg-white text-neutral-800"
                                                        }`}
                                                    >
                                                        <Code2 className="h-4 w-4" />
                                                        <span>Code</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Panel</div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => openSidePanelMode("revision-chat")}
                                                    className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold ${
                                                        sidePanelMode === "revision-chat"
                                                            ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                            : "border-neutral-300 bg-white text-neutral-800"
                                                    }`}
                                                >
                                                    <MessageSquare className="h-4 w-4" />
                                                    <span>AI edits</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => openSidePanelMode("style")}
                                                    className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold ${
                                                        sidePanelMode === "style"
                                                            ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                            : "border-neutral-300 bg-white text-neutral-800"
                                                    }`}
                                                >
                                                    <Palette className="h-4 w-4" />
                                                    <span>Styles</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => openSidePanelMode("meta")}
                                                    className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold ${
                                                        sidePanelMode === "meta"
                                                            ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                            : "border-neutral-300 bg-white text-neutral-800"
                                                    }`}
                                                >
                                                    <FileText className="h-4 w-4" />
                                                    <span>SEO</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => openSidePanelMode("ai-library")}
                                                    className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold ${
                                                        sidePanelMode === "ai-library"
                                                            ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                            : "border-neutral-300 bg-white text-neutral-800"
                                                    }`}
                                                >
                                                    <Images className="h-4 w-4" />
                                                    <span>Images</span>
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">Device</div>
                                            <div className="grid grid-cols-3 gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        handleDeviceChange("desktop");
                                                        setMobileControlsOpen(false);
                                                    }}
                                                    className={`inline-flex items-center justify-center gap-2 rounded-full border px-3 py-2.5 text-sm font-semibold ${
                                                        device === "desktop"
                                                            ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                            : "border-neutral-300 bg-white text-neutral-800"
                                                    }`}
                                                >
                                                    <Monitor className="h-4 w-4" />
                                                    <span>Desktop</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        handleDeviceChange("tablet");
                                                        setMobileControlsOpen(false);
                                                    }}
                                                    className={`inline-flex items-center justify-center gap-2 rounded-full border px-3 py-2.5 text-sm font-semibold ${
                                                        device === "tablet"
                                                            ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                            : "border-neutral-300 bg-white text-neutral-800"
                                                    }`}
                                                >
                                                    <Tablet className="h-4 w-4" />
                                                    <span>Tablet</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        handleDeviceChange("mobile");
                                                        setMobileControlsOpen(false);
                                                    }}
                                                    className={`inline-flex items-center justify-center gap-2 rounded-full border px-3 py-2.5 text-sm font-semibold ${
                                                        device === "mobile"
                                                            ? "border-[#f55f2a] bg-[#f55f2a] text-white"
                                                            : "border-neutral-300 bg-white text-neutral-800"
                                                    }`}
                                                >
                                                    <Smartphone className="h-4 w-4" />
                                                    <span>Mobile</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {exporting && !closing && (
                            <div className="absolute inset-0 z-[95] bg-white/90/80 backdrop-blur-[2px] grid place-items-center pointer-events-auto">
                                <div className="flex items-center gap-3 rounded border px-3 py-2 bg-white/90 text-md text-neutral-800 shadow-md">
                                    <Spinner />
                                    <span>Exporting changes…</span>
                                </div>
                            </div>
                        )}

                        {aiEditing && !closing && (
                            <div className="absolute inset-0 z-[95] backdrop-blur-[2px] grid place-items-center pointer-events-auto">
                                {/* accent border wrapper */}
                                <div
                                    className="inline-flex rounded-2xl p-[3px] shadow-sm"
                                    style={{
                                        // use ONLY your accent (and tints) for the moving border
                                        backgroundImage: "linear-gradient(90deg, rgba(245,95,42,0.35), rgba(245,95,42,0.85), rgba(245,95,42,0.35))",
                                        backgroundSize: "220% 220%",
                                        animation: "kloner-accent-move 2.8s linear infinite",
                                    }}
                                >
                                    {/* inner content */}
                                    <div className="flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-1.5 text-[15px] text-neutral-900 shadow-[0_10px_30px_rgba(0,0,0,0.10)] ring-[0.5] ring-black/5 backdrop-blur">
                                        <span
                                            className="bg-clip-text text-transparent font-semibold tracking-tight"
                                            style={{
                                                backgroundImage:
                                                    "linear-gradient(90deg, rgba(245,95,42,0.6), rgba(245,95,42,1), rgba(245,95,42,0.6))",
                                                backgroundSize: "220% 220%",
                                                animation: "kloner-accent-move 2.8s linear infinite",
                                            }}
                                        >
                                            Applying AI edit…
                                        </span>
                                        <span className="inline-flex items-center gap-1 leading-none" aria-hidden="true">
                                            <span className="h-1.5 w-1.5 rounded-full bg-[#f55f2a] kloner-dot" />
                                            <span
                                                className="h-1.5 w-1.5 rounded-full bg-[#f55f2a] kloner-dot"
                                                style={{ opacity: 0.75, animationDelay: "0.15s" }}
                                            />
                                            <span
                                                className="h-1.5 w-1.5 rounded-full bg-[#f55f2a] kloner-dot"
                                                style={{ opacity: 0.45, animationDelay: "0.30s" }}
                                            />
                                        </span>

                                        <style jsx>{`
                                            @keyframes kloner-accent-move {
                                                0% {
                                                background-position: 0% 50%;
                                                }
                                                50% {
                                                background-position: 100% 50%;
                                                }
                                                100% {
                                                background-position: 0% 50%;
                                                }
                                            }

                                            @keyframes klonerDots {
                                                0%,
                                                80%,
                                                100% {
                                                transform: translateY(0);
                                                opacity: 0.25;
                                                }
                                                40% {
                                                transform: translateY(-3px);
                                                opacity: 1;
                                                }
                                            }

                                            .kloner-dot {
                                                animation: klonerDots 0.9s ease-in-out infinite;
                                            }
                                            `}</style>
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>
                    )}
                </div>

                {!aiEditing && (
                    <div id="kloner-floating-toolbar">
                        <FloatingBlockToolbar
                            iframeRef={iframeRef}
                            wrapperRef={iframeWrapperRef}
                            selectionMeta={selectionMeta}
                            uiScale={0}
                        />
                    </div>
                )}
                <AnimatePresence>
                    {pageSwitchConfirm && (
                        <motion.div
                            className="fixed inset-0 z-[10005] flex items-center justify-center bg-black/40"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                transition={{ type: "keyframes", stiffness: 260, damping: 22 }}
                                className="bg-white/90 rounded-lg shadow-xl p-4 w-full max-w-sm border border-neutral-200"
                            >
                                <div className="text-md font-semibold text-neutral-900 mb-2">
                                    Save images before switching pages?
                                </div>
                                <p className="text-md text-neutral-600 mb-3">
                                    This page has images that haven’t been uploaded yet. Save them
                                    before switching, or continue without saving.
                                </p>
                                <div className="flex justify-end gap-2 text-md">
                                    <button
                                        type="button"
                                        className="px-2.5 py-1.5 rounded border border-neutral-300 bg-white/90 hover:bg-neutral-50 active:scale-[.98] font-semibold"
                                        onClick={cancelPageSwitch}
                                    >
                                        Stay on this page
                                    </button>
                                    <button
                                        type="button"
                                        className="px-2.5 py-1.5 rounded border border-transparent bg-neutral-900 text-white hover:brightness-110 active:scale-[.98] font-semibold"
                                        onClick={confirmPageSwitch}
                                    >
                                        Save & switch
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {closePrompt && (
                    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
                        <div className="bg-white rounded-lg shadow-xl p-4 w-full max-w-sm border border-neutral-200">
                            <div className="text-md font-semibold text-neutral-900 mb-2">
                                Close editor?
                            </div>
                            <p className="text-sm text-neutral-600 mb-3">
                                You have unsaved changes. Save them before closing, or discard
                                this draft.
                            </p>
                            <div className="flex justify-end gap-2 text-sm">
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 text-xs rounded-full border border-neutral-300 bg-white/90 hover:bg-neutral-50 active:scale-[.98]"
                                    onClick={() => setClosePrompt(false)}
                                >
                                    Keep Editing
                                </button>
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 text-xs rounded-full border border-neutral-300 bg-white/90 hover:bg-neutral-50 active:scale-[.98]"
                                    onClick={() => performClose("discard")}>
                                    Discard
                                </button>
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 text-xs rounded-full bg-accent text-white hover:brightness-110 active:scale-[.98]"
                                    onClick={() => performClose("save")}
                                >
                                    Save & close
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {exportPrompt && (
                    <div className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/40">
                        <div className="bg-white rounded-lg shadow-xl p-4 w-full max-w-sm border border-neutral-200">
                            <div className="text-md font-semibold text-neutral-900 mb-2">
                                Deploy your Website?
                            </div>
                            <p className="text-xs text-neutral-600 mb-2">
                                This will export your current preview and trigger a deployment to
                                your connected Vercel project.
                            </p>
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3">
                                Warning: these changes will reach your live site.
                            </p>
                            <div className="flex justify-end gap-2 text-xs">
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 rounded-full border border-neutral-300 bg-white/90 hover:bg-neutral-50 active:scale-[.98] disabled:opacity-60"
                                    onClick={() => setExportPrompt(false)}
                                    disabled={exporting}
                                >
                                    Back to Editor
                                </button>
                                <button
                                    onClick={async () => {
                                        setExportPrompt(false);
                                        await doExport();
                                    }}
                                    disabled={exporting}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-white shadow-sm hover:border-neutral-400 disabled:opacity-60"
                                    title="Open generated layout site"
                                >
                                    <span>Deploy now</span>
                                    <Rocket className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
        </div>
    );

}

function Spinner({ size = 18 }: { size?: number }) {
    return (
        <span
            className="inline-block rounded-full border-2 border-neutral-300 border-t-transparent"
            style={{ width: size, height: size, animation: "spin .8s linear infinite" }}
            aria-hidden
        />
    );
}

function UiBtn({
    children,
    pressed,
    onClick,
    variant = "tab",
    disabled,
    ariaBusy,
}: {
    children: React.ReactNode;
    pressed?: boolean;
    onClick?: () => void;
    variant?: "tab" | "outline" | "outline-quiet" | "filled";
    disabled?: boolean;
    ariaBusy?: boolean;
}) {
    const base =
        "m-1 inline-flex items-center justify-center gap-2 transition active:scale-[.99] focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-60 disabled:cursor-not-allowed text-sm";

    const withBusy = (
        <>
            {ariaBusy && <Spinner size={14} />}
            <span>{children}</span>
        </>
    );

    if (variant === "filled") {
        return (
            <button
                onClick={onClick}
                disabled={disabled}
                aria-busy={ariaBusy}
                className={`${base} rounded-md px-3 py-1.5 font-semibold text-white shadow-sm hover:brightness-95`}
                style={{ backgroundColor: ACCENT }}
            >
                {withBusy}
            </button>
        );
    }
    if (variant === "outline") {
        return (
            <button
                onClick={onClick}
                disabled={disabled}
                aria-busy={ariaBusy}
                className={`${base} rounded-md px-3 py-1.5 border border-neutral-300 bg-white/90 hover:bg-neutral-50`}
            >
                {withBusy}
            </button>
        );
    }
    if (variant === "outline-quiet") {
        return (
            <button
                onClick={onClick}
                disabled={disabled}
                aria-busy={ariaBusy}
                className={`${base} rounded-md px-3 py-1.5 border border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100`}
            >
                {withBusy}
            </button>
        );
    }

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            aria-busy={ariaBusy}
            className={`${base} rounded-full px-2.5 py-1 text-sm border ${pressed
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white/90 hover:bg-neutral-50"
                }`}
        >
            {withBusy}
        </button>
    );
}