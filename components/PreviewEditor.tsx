// src/components/PreviewEditor.tsx
"use client";

import { ensureSessionAndCsrf } from "@/app/login/LoginForm";
import { useEffect, useMemo, useRef, useState, useCallback, ChangeEvent } from "react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";

export type Device = "desktop" | "tablet" | "mobile";
export type ViewMode = "code" | "preview" | "screenshot";

type EditorPage = {
    id: string; // should match data-route when possible
    label: string;
    html: string;
    screenshotUrl?: string;
};

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
const STORAGE_KEY = (id?: string) => `kloner:draft:${id || "default"}`;
const SAVE_NUDGE_KEY = "kloner_save_nudge_seen";

export type SelectionMeta = {
    has: boolean;
    tagName?: string;
    path?: string | null;
    rect?: any;
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
import { db } from "@/lib/firebase"; // or wherever your db is
import type { User as FirebaseUser } from "firebase/auth";
import { RenderDoc } from "@/app/dashboard/view/page";
import { useAuth } from "@/src/hooks/useAuth";
import { Camera, Code2, Eye, EyeOff, FileText, Images, Loader2, Maximize2, MessageSquare, Minimize2, Monitor, Palette, Redo2, Rocket, RotateCcw, RotateCw, Smartphone, Tablet, Undo2 } from "lucide-react";
import { compressImageForUpload } from "@/src/lib/clientImageCompression";
import { EditorSessionCounters, EditorSessionMetrics, EditorSessionUser, ExportAnalyticsUser, recordEditorSessionAnalytics, recordExportAnalytics } from "./analytics";
import AiEditPanel from "./editor/AiEditPanel";
import { PreviewEditorTour } from "./PreviewEditorTour";
import { injectEditableOverlay } from "@/src/lib/klonerIframeRuntime";
import { MetaSettings, UploadedAsset } from "./MetaSettings";
import { FloatingBlockToolbar } from "@/src/lib/floatingToolbar";
import { AiImageLibraryPanel } from "./AiImageLibraryPanel";
import MiniToolbar from "@/src/lib/miniToolbar";
import { IS_MOBILE, sanitizeImageName } from "./helpers";

const MAX_HISTORY_SNAPSHOTS = 40;

const HISTORY_KEY = (draftId?: string | null) =>
    draftId ? `kloner:draftHistory:${draftId}` : "kloner:draftHistory:__anonymous";

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

type SidePanelMode = "style" | "meta" | "ai-library" | "code";


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

export default function PreviewEditor({
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
    const [history, setHistory] = useState<DraftSnapshot[]>([]);
    const [aiHistory, setAiHistory] = useState<AiEditSuggestion[]>([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [sidebarHidden, setSidebarHidden] = useState(IS_MOBILE ? true : false);
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
                    if (process.env.NODE_ENV === "development") {
                        console.log(
                            "[editor-analytics] flush skipped (no user)",
                            reason,
                            counters,
                            durationMs,
                        );
                    }
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
    const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
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
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            const nodes = doc.querySelectorAll<HTMLElement>(
                `[data-kloner-page-id="${pageId}"]`
            );

            nodes.forEach((node) => {
                node.setAttribute("data-kloner-archived", "1");

                // only hide if not already hidden
                const style = node.getAttribute("style") || "";
                if (!/display\s*:\s*none/.test(style)) {
                    node.style.display = "none";
                }
            });

            return "<!doctype html>\n" + doc.documentElement.outerHTML;
        } catch (err) {
            console.warn("[archivePageInHtmlById] failed", err);
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


    function restorePageInHtmlById(html: string, pageId: string): string {
        if (!html) return html;
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            const nodes = doc.querySelectorAll<HTMLElement>(
                `[data-kloner-page-id="${pageId}"]`
            );

            nodes.forEach((node) => {
                node.removeAttribute("data-kloner-archived");
                if (node.style.display === "none") {
                    node.style.display = "";
                }
            });

            return "<!doctype html>\n" + doc.documentElement.outerHTML;
        } catch (err) {
            console.warn("[restorePageInHtmlById] failed", err);
            return html;
        }
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


    const mergedHistory: DraftSnapshot[] = [
        ...history,
        ...aiHistory.map(aiSuggestionToSnapshot),
    ].sort((a, b) => b.createdAt - a.createdAt);

    type HtmlSnapshotSource = "manual" | "autosave" | "before-ai" | "apply";

    type HtmlSnapshot = {
        id: string;
        createdAt: number;
        summary: any;
        source: any;
        html: string;
        prompt: any;
    };


    // const HISTORY_STORAGE_KEY = (draftId?: string | null) =>
    //     draftId ? `kloner:history:${draftId}` : "kloner:history:temp";

    // // load history from localStorage when draftId changes
    // useEffect(() => {
    //     if (!draftId) return;

    //     let cancelled = false;

    //     async function loadAiHistory() {
    //         try {
    //             const res = await fetch(
    //                 `/api/ai-edit?renderId=${encodeURIComponent(draftId as any)}`,
    //                 { credentials: "include" }
    //             );
    //             if (!res.ok) return;

    //             const j = await res.json();
    //             if (cancelled) return;

    //             const all: AiEditSuggestion[] = Array.isArray(j.suggestions)
    //                 ? j.suggestions
    //                 : [];

    //             const limited = [...all]
    //                 .sort((a, b) => {
    //                     const aT = new Date(a.createdAt).getTime();
    //                     const bT = new Date(b.createdAt).getTime();
    //                     return bT - aT;
    //                 })
    //                 .slice(0, 10);

    //             setAiHistory(limited);
    //         } catch {
    //             // ignore
    //         }
    //     }

    //     loadAiHistory();

    //     return () => {
    //         cancelled = true;
    //     };
    // }, [draftId]);


    // // persist history to localStorage
    // useEffect(() => {
    //     if (typeof window === "undefined") return;
    //     const key = HISTORY_STORAGE_KEY(draftId);
    //     try {
    //         window.localStorage.setItem(key, JSON.stringify(history));
    //     } catch {
    //         // ignore quota errors
    //     }
    // }, [history, draftId]);

    // load history from localStorage when draftId changes
    // useEffect(() => {
    //     if (typeof window === "undefined") return;
    //     const key = HISTORY_STORAGE_KEY(draftId);
    //     const raw = window.localStorage.getItem(key);
    //     if (!raw) return;

    //     try {
    //         const parsed = JSON.parse(raw) as DraftSnapshot[];
    //         if (!Array.isArray(parsed)) return;

    //         // keep only the last 10 by createdAt
    //         const limited = [...parsed]
    //             .sort((a, b) => b.createdAt - a.createdAt)
    //             .slice(0, 10);

    //         setHistory(limited);
    //     } catch {
    //         // ignore bad data
    //     }
    // }, [draftId]);


    function addSnapshot(opts: { id: string, createdAt: any, html: string; source: DraftSnapshotSource }) {
        const trimmed = opts.html.trim();
        if (!trimmed) return;

        setHistory((prev): DraftSnapshot[] => {
            const next: DraftSnapshot[] = [
                ...prev as any,
                {
                    id:
                        typeof crypto !== "undefined" && "randomUUID" in crypto
                            ? crypto.randomUUID()
                            : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    createdAt: Date.now(),
                    source: opts.source,
                    html: trimmed,
                },
            ];

            // cap at last 50 entries to avoid unbounded growth
            return next.length > 50 ? next.slice(next.length - 50) : next;
        });
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

    const allPages = useMemo<EditorPage[] | null>(
        () =>
            pages && pages.length
                ? pages
                : derivedPages.length
                    ? derivedPages
                    : null,
        [pages, derivedPages]
    );

    const activePage = useMemo(
        () =>
            allPages ? allPages.find((p) => p.id === activePageId) ?? null : null,
        [allPages, activePageId]
    );

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

        const seen = window.localStorage.getItem(SAVE_NUDGE_KEY) === "1";
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

    const currentPageKey = useMemo(() => {
        if (!allPages || !activePageId || activePageId === "single") {
            return SINGLE_PAGE_KEY;
        }
        return activePageId;
    }, [allPages, activePageId]);

    const currentSeoMeta: SeoMeta = useMemo(() => {
        const base = seoMetaByPage[currentPageKey] ?? emptyMeta;

        // If this page already has a non-empty favicon, use it as-is.
        if (typeof base.faviconUrl === "string" && base.faviconUrl.trim() !== "") {
            return base;
        }

        // Otherwise, fall back to ANY valid favicon in the map (global favicon).
        const anyFavicon = Object.values(seoMetaByPage).find(
            (m): m is SeoMeta => {
                if (!m || typeof m !== "object") return false;
                const v = (m as SeoMeta).faviconUrl;
                return typeof v === "string" && v.trim() !== "";
            },
        );

        if (!anyFavicon || !anyFavicon.faviconUrl) {
            return base;
        }

        return {
            ...base,
            faviconUrl: anyFavicon.faviconUrl,
        };
    }, [seoMetaByPage, currentPageKey]);


    // pick a single renderId to use for Firestore writes / reads
    const resolvedRenderId = draftId ?? null;


    // this now does BOTH: updates local state AND writes to Firestore
    const handleSaveMetaForCurrentPage = useCallback(
        async (meta: SeoMeta) => {
            // Decide which logical page we are saving for
            const rawPageKey =
                currentPageKey && currentPageKey !== "single"
                    ? currentPageKey
                    : SINGLE_PAGE_KEY;

            // Firestore-safe key: NEVER allow "__single__" to be persisted
            const pageKey =
                rawPageKey === "__single__" ? "single" : rawPageKey || "single";

            const faviconUrl = meta.faviconUrl?.trim() || "";

            // build next map from current state
            let next: SeoMetaByPage = {
                ...(seoMetaByPage || {}),
                [pageKey]: meta,
            };

            // favicon is global: propagate across pages if set
            if (faviconUrl) {
                next = Object.fromEntries(
                    Object.entries(next).map(([key, val]) => [
                        key,
                        key === pageKey ? val : { ...val, faviconUrl },
                    ]),
                ) as SeoMetaByPage;
            }

            // HARD GUARD: never let "__single__" survive into Firestore
            if ("__single__" in next) {
                const anyNext: any = next;
                const singleMeta = anyNext.__single__;
                delete anyNext.__single__;
                // prefer explicitly under "single" key if not already present
                if (!anyNext.single && singleMeta) {
                    anyNext.single = singleMeta;
                }
                next = anyNext;
            }

            // update local state so the editor reflects the latest SEO immediately
            setSeoMetaByPage(next);
            setActiveSeoMetaByPage(next);

            // write to Firestore so exports and other clients see the latest meta
            if (user && resolvedRenderId) {
                try {
                    const dref = doc(
                        db,
                        "kloner_users",
                        user.uid,
                        "kloner_renders",
                        resolvedRenderId,
                    );

                    await updateDoc(dref, {
                        seoMetaByPage: next,
                        updatedAt: serverTimestamp(),
                        // CRITICAL: persist JSON-LD as an object
                        jsonLd: meta.jsonLd ?? null,
                    });
                } catch (err) {
                    console.error(
                        "[handleSaveMetaForCurrentPage] Failed to persist SEO meta to Firestore",
                        { err, resolvedRenderId },
                    );
                }
            }

            // optional: still propagate up to any parent hook if you had one
            if (onSaveMeta) {
                void onSaveMeta(
                    pageKey === "single" ? null : pageKey,
                    meta,
                    next,
                );
            }
        },
        [
            currentPageKey,
            seoMetaByPage,
            user,
            resolvedRenderId,
            onSaveMeta,
            // if SINGLE_PAGE_KEY is a constant in scope, add it here too:
            // SINGLE_PAGE_KEY,
        ],
    );



    const theme = useMemo(
        () => deriveThemeFromInitialHtml(initialHtml),
        [initialHtml],
    );

    const mergedThemeColors = useMemo(
        () => Array.from(new Set([...(theme.textColors || []), ...(theme.bgColors || [])])),
        [theme.textColors, theme.bgColors]
    );

    // inject route-specific CSS into the monolithic HTML for iframe preview
    const renderHtml = useMemo(() => {
        const base = stripScripts(stripEditorArtifacts(previewHtml || ""));
        if (!base) return base;

        if (!allPages || !activePageId || activePageId === "single") return base;

        const styleTag = `<style id="kloner-active-route">main.page-root[data-route]{display:none!important;}main.page-root[data-route="${activePageId}"]{display:block!important;}</style>`;

        if (base.includes("</head>")) {
            return base.replace("</head>", `${styleTag}</head>`);
        }
        if (base.includes("<head>")) {
            return base.replace("<head>", `<head>${styleTag}`);
        }
        return styleTag + base;
    }, [previewHtml, activePageId, allPages]);

    const [uiScale, setUiScale] = useState<number>(() => {
        if (typeof window === "undefined") return (IS_MOBILE ? 1.05 : 0.75)
        const v = Number(localStorage.getItem("kloner:uiScale"));
        return Number.isFinite(v) && v >= 0.5 && v <= 1.25 ? v : (IS_MOBILE ? 1.05 : 0.75)
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

    // initialise monolithic HTML once (or when draftId/initialHtml changes)
    useEffect(() => {
        const storageKey = STORAGE_KEY(draftId);
        const fromLs =
            typeof window !== "undefined"
                ? localStorage.getItem(storageKey)
                : null;

        const baseHtml = stripScripts(fromLs || initialHtml || "");
        setHtmlDraft(baseHtml);
        setPreviewHtml(baseHtml);
        setDirty(false);
    }, [draftId, initialHtml]);


    // set initial active page, and keep it valid when page set changes
    useEffect(() => {
        if (!allPages || allPages.length === 0) {
            if (!activePageId) setActivePageId("single");
            return;
        }

        const stillExists =
            activePageId && allPages.some((p) => p.id === activePageId);

        if (stillExists) return;

        if (initialPageId && allPages.some((p) => p.id === initialPageId)) {
            setActivePageId(initialPageId);
            return;
        }

        setActivePageId(allPages[0].id);
    }, [allPages, activePageId, initialPageId]);

    // persist monolithic draft to localStorage
    useEffect(() => {
        const storageKey = STORAGE_KEY(draftId);
        if (typeof window !== "undefined") {
            localStorage.setItem(storageKey, htmlDraft);
        }
        setDirty(true);
    }, [htmlDraft, draftId]);

    // ---------- NEW: snapshot helper for saving/exporting ----------
    const snapshotFromIframeOrDraft = useCallback(() => {
        // In code mode, textarea is the source of truth.
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

    const snapshotDraft = useCallback(
        (source: DraftSnapshotSource) => {
            const html = snapshotFromIframeOrDraft();
            if (!html) return;

            setHistory((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.html === html) return prev;

                const snap: DraftSnapshot = {
                    id: `${Date.now()}-${Math.random()
                        .toString(36)
                        .slice(2, 8)}`,
                    createdAt: Date.now(),
                    source,
                    html,
                    summary: undefined,
                    prompt: undefined,
                };

                const merged = [...prev, snap];
                if (merged.length > MAX_HISTORY_SNAPSHOTS) merged.shift();

                return merged;
            });

            setActiveHistoryId((prev) => prev || `${Date.now()}`);
        },
        [snapshotFromIframeOrDraft],
    );


    useEffect(() => {
        if (!draftId) return;
        if (typeof window === "undefined") return;

        const intervalMs = 60_000;
        const id = window.setInterval(() => {
            snapshotDraft("auto");
            bumpSessionCounter("autosave");
        }, intervalMs);

        return () => window.clearInterval(id);
    }, [draftId, snapshotDraft]);


    // bump iframe key when HTML or mode changes (except pure screenshot mode)
    useEffect(() => {
        if (mode === "screenshot") return;
        setIframeKey((k) => k + 1);
    }, [renderHtml, mode]);

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

    const handleRestoreSnapshot = useCallback(
        (snap: DraftSnapshot) => {
            if (!snap) return;

            const confirmRestore = dirty ? window.confirm("Replace the current draft with this version? Unsaved changes will be lost.") : true;

            if (!confirmRestore) return;

            setHtmlDraft(snap.html);
            setPreviewHtml(snap.html);
            emitLive(snap.html);
            setDirty(false);
            setActiveHistoryId(snap.id);
            bumpSessionCounter("historyRestore")
        }, [dirty, emitLive]
    );


    function HistoryPanel(props: {
        snapshots: DraftSnapshot[];
        onRestore: (snap: DraftSnapshot) => void;
    }) {
        const { snapshots, onRestore } = props;

        if (!snapshots.length) {
            return (
                <div className="text-sm text-gray-500 bg-white">
                    No history yet. Autosaves and applied versions will appear here.
                </div>
            );
        }

        const ordered = [...snapshots].sort((a, b) => b.createdAt - a.createdAt);

        return (
            <div className="flex flex-col gap-2 text-md h-full bg-white">
                <div className="flex-1 overflow-y-auto rounded-md border border-gray-200">
                    {ordered.map((snap) => (
                        <button
                            key={snap.id}
                            type="button"
                            onClick={() => onRestore(snap)}
                            className="w-full text-left px-3 py-2 border-b border-gray-100 hover:bg-gray-50 focus:outline-none focus:bg-gray-100"
                        >
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-[13px] uppercase tracking-wide text-gray-600">
                                    <span className="font-semibold text-[13px] uppercase tracking-wide text-gray-600">
                                        {snap.source === "auto"
                                            ? "Autosave"
                                            : snap.source === "apply"
                                                ? "Applied"
                                                : snap.source === "ai-edit"
                                                    ? "AI change"
                                                    : "Manual save"}
                                    </span>

                                </span>
                                <span className="text-[13px] text-gray-500">
                                    {formatSnapshotTime(snap.createdAt)}
                                </span>
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-[13px] text-gray-500">
                                {formatSnapshotLabel(snap)}
                            </p>
                        </button>
                    ))}
                </div>
            </div>
        );
    }


    function applyDraftToPreview() {
        if (applyingPreview) return;

        setApplyingPreview(true);

        const nextHtml = htmlDraft;

        setPreviewHtml(nextHtml);
        emitLive(nextHtml);
        setDirty(false);

        // history entry when user explicitly applies to preview
        snapshotDraft("apply");

        window.setTimeout(() => {
            setApplyingPreview(false);
        }, 450);
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
            // still continue to switch, to avoid trapping the user
        } finally {
            setActivePageId(nextId);
            bumpSessionCounter("pageSwitch");
            setPageSwitchConfirm(null);
        }
    };

    const cancelPageSwitch = () => {
        setPageSwitchConfirm(null);
    };


    // inside your editor component
    async function doExport() {
        if (exporting) return;
        setExportNote("");
        setExporting(true);

        const exportStartMs = Date.now();

        try {
            await doSave({ applyToPreview: true });

            const baseHtmlRaw = snapshotFromIframeOrDraft();
            const baseHtml = (baseHtmlRaw || previewHtml || "").trim();
            if (!baseHtml) {
                const msg = "No HTML available to export";
                const durationMs = Date.now() - exportStartMs;

                await recordExportAnalytics(
                    user as ExportAnalyticsUser,
                    draftId,
                    {
                        status: "error",
                        error: msg,
                        durationMs,
                    },
                );

                throw new Error(msg);
            }

            // FINAL SAFETY PASS: strip any Kloner UI one last time
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

            // analytics: first / last export, count, last draft, timing, status
            await recordExportAnalytics(
                user as ExportAnalyticsUser,
                draftId,
                {
                    status: "success",
                    error: null,
                    durationMs,
                },
            );
        } catch (e: any) {
            const msg = String(e?.message || "");
            const durationMs = Date.now() - exportStartMs;

            await recordExportAnalytics(
                user as ExportAnalyticsUser,
                draftId,
                {
                    status: "error",
                    error: msg,
                    durationMs,
                },
            );

            if (/401|403|unauth/i.test(msg)) {
                setExportNote(
                    "Export blocked. Connect your Vercel account in Settings, then retry.",
                );
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

    function snapshotBeforeAiEdit(fullHtml: string) {
        addSnapshot({
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            source: "auto", // pre-AI label
            html: fullHtml,
        });
    }

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
            setHtmlDraft(cleanedHtml);
            setPreviewHtml(cleanedHtml);
            if (onLiveHtml) onLiveHtml(cleanedHtml);

            // 6) Snapshot the *post-AI* full HTML so you can "keep / discard" this edit
            try {
                addSnapshot({
                    id: crypto.randomUUID(),
                    createdAt: Date.now(),
                    source: "ai-edit", // distinct label from "auto"
                    html: cleanedHtml,
                });
            } catch (err) {
                console.warn(
                    "[PreviewEditor] failed to snapshot after AI edit",
                    err,
                );
            }

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
        ],
    );

    // Inside PreviewEditor component, near your other callbacks

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
            // sandbox: allow scripts but still keep it in a sandbox box
            sandbox="
      allow-scripts
      allow-same-origin
      allow-forms
      allow-popups
      allow-modals
      allow-popups-to-escape-sandbox
    "
            srcDoc={
                aiPreviewHtml ||
                renderHtml ||
                "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>"
            }
            onLoad={() => {
                const doc = iframeRef.current?.contentDocument;
                if (!doc) return;

                // clean existing editor chrome
                doc.querySelectorAll(".kloner-toolbar").forEach((n) => n.remove());
                doc.querySelectorAll(".kloner-style-panel").forEach((n) => n.remove());

                if (mode === "preview") {
                    injectEditableOverlay(
                        doc,
                        (updated) => {
                            setHtmlDraft(updated);
                        },
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
            {!IS_MOBILE && (<PreviewEditorTour />)}

            <div className="absolute inset-4 overflow-hidden">

                {/* Close */}
                {!IS_MOBILE && (
                    <button
                        type="button"
                        onClick={() => {
                            if (dirty) setClosePrompt(true);
                            else performClose("discard");
                        }}
                        disabled={closing}
                        aria-label="Close editor"
                        className={`absolute top-5 right-5 z-[100] inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-300 bg-white/90/90 text-neutral-700 shadow-md transition ${closing
                            ? "cursor-not-allowed opacity-60"
                            : "hover:bg-neutral-100 hover:text-neutral-900"
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
                )}

                {/* FLOATING DEVICE SELECTOR – TOP CENTER */}
                <div
                    id="kloner-device-toggle"
                    className={`absolute ${IS_MOBILE ? 'bottom-20 left-1/2 z-[101]' : 'top-5 left-1/2 z-[101] '} -translate-x-1/2`}>
                    <div className={`inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white/90/95 px-2 py-1 shadow-md`}>
                        <motion.button
                            type="button"
                            onClick={() => handleDeviceChange("desktop")}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.96 }}
                            className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${device === "desktop"
                                ? "bg-[#f55f2a] text-white"
                                : "bg-white/90 text-neutral-600 hover:bg-neutral-100"
                                }`}
                            title="Desktop"
                        >
                            <Monitor className="h-3 w-3" />
                        </motion.button>

                        <motion.button
                            type="button"
                            onClick={() => handleDeviceChange("tablet")}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.96 }}
                            className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${device === "tablet"
                                ? "bg-[#f55f2a] text-white"
                                : "bg-white/90 text-neutral-600 hover:bg-neutral-100"
                                }`}
                            title="Tablet"
                        >
                            <Tablet className="h-3 w-3" />
                        </motion.button>

                        <motion.button
                            type="button"
                            onClick={() => handleDeviceChange("mobile")}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.96 }}
                            className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${device === "mobile"
                                ? "bg-[#f55f2a] text-white"
                                : "bg-white/90 text-neutral-600 hover:bg-neutral-100"
                                }`}
                            title="Mobile"
                        >
                            <Smartphone className="h-3 w-3" />
                        </motion.button>
                    </div>
                </div>

                {/* UI scale – top left */}
                {sidebarHidden && (
                    <div className={`absolute ${IS_MOBILE ? 'bottom-20 left-3' : 'top-5 left-5'} z-10 flex items-center gap-2 rounded-full ${IS_MOBILE ? '' : 'border border-neutral-200 bg-white/90/95 shadow-md'} px-3 py-1 `}>
                        {!IS_MOBILE && (
                            <span className="text-[11px] font-medium text-neutral-600">UI scale</span>
                        )}
                        <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-600">
                            <button
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-neutral-600 shadow-sm hover:bg-neutral-100"
                                onClick={() => setUiScale((s) => Math.max(0.5, +(s - 0.05).toFixed(2)))}
                                disabled={closing}
                            >
                                −
                            </button>
                            {!IS_MOBILE && (<span className="w-10 text-center">{Math.round(uiScale * 100)}%</span>)}
                            <button
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-neutral-600 shadow-sm hover:bg-neutral-100"
                                onClick={() => setUiScale((s) => Math.min(1.25, +(s + 0.05).toFixed(2)))}
                                disabled={closing}
                            >
                                +
                            </button>
                        </div>
                    </div>
                )}

                <div
                    className="relative bg-white/90 rounded-xl shadow-xl gap-4 p-4 grid grid-cols-1"
                    style={{
                        transform: `scale(${uiScale})`,
                        transformOrigin: "top left",
                        width: `${100 / uiScale}%`,
                        height: `${100 / uiScale}%`,
                    }}
                >

                    {/* FLOATING LEFT ICON RAIL (META / CODE / DEPLOY / SCREENSHOT / STYLES) */}
                    <div className="pointer-events-auto fixed left-4 top-1/2 z-40 -translate-y-1/2">
                        <div className="flex flex-col gap-2 rounded-full border border-neutral-200 bg-white/90/80 p-1 shadow-md backdrop-blur-sm">
                            {/* Styles */}
                            <button
                                id="kloner-selection-style"
                                type="button"
                                onClick={() => {
                                    const isActive = !sidebarHidden && sidePanelMode === "style" && mode === "preview";
                                    if (isActive) {
                                        setSidebarHidden(true);
                                    } else {
                                        setSidePanelMode("style");
                                        setSidebarHidden(false);
                                        if (mode === "screenshot" || mode === "code") {
                                            handleModeClick("preview");
                                        }
                                    }
                                }}
                                className={`group relative flex h-9 w-9 items-center justify-center rounded-full border text-[11px] shadow-sm transition ${!sidebarHidden && sidePanelMode === "style" && mode === "preview"
                                    ? "border-transparent bg-accent text-white"
                                    : "border-neutral-300 bg-white/90/80 text-neutral-500 hover:border-transparent hover:bg-accent hover:text-white"
                                    }`}
                            >
                                <Palette className="h-4 w-4" aria-hidden="true" />
                                <span className="sr-only">Styles</span>
                                <span className="pointer-events-none absolute left-11 top-1/2 hidden -translate-y-1/2 rounded-md bg-neutral-900 px-2 py-1 text-[10px] font-medium text-white shadow-sm group-hover:inline-block">
                                    Styles
                                </span>
                            </button>

                            {/* Meta */}
                            <button
                                type="button"
                                id="kloner-meta-toggle"
                                onClick={() => {
                                    const isActive = !sidebarHidden && sidePanelMode === "meta";
                                    if (isActive) {
                                        setSidebarHidden(true);
                                    } else {
                                        setSidePanelMode("meta");
                                        setSidebarHidden(false);

                                        // meta editing should always work against the visual preview, not code/screenshot
                                        if (mode !== "preview") {
                                            handleModeClick("preview");
                                        }
                                    }
                                }}
                                className={`group relative flex h-9 w-9 items-center justify-center rounded-full border text-[11px] shadow-sm transition ${!sidebarHidden && sidePanelMode === "meta"
                                    ? "border-transparent bg-accent text-white"
                                    : "border-neutral-300 bg-white/90/80 text-neutral-500 hover:border-transparent hover:bg-accent hover:text-white"
                                    }`}
                            >
                                <FileText className="h-4 w-4" aria-hidden="true" />
                                <span className="sr-only">Meta</span>
                                <span className="pointer-events-none absolute left-11 top-1/2 hidden -translate-y-1/2 rounded-md bg-neutral-900 px-2 py-1 text-[10px] font-medium text-white shadow-sm group-hover:inline-block">
                                    Meta
                                </span>
                            </button>

                            {/* AI edit chatlog */}
                            <button
                                type="button"
                                id="kloner-ai-edit-toggle"
                                onClick={() => {
                                    const isActive = !sidebarHidden && sidePanelMode === "revision-chat";
                                    if (isActive) {
                                        setSidebarHidden(true);
                                    } else {
                                        setSidePanelMode("revision-chat");
                                        setSidebarHidden(false);

                                        // AI edits always operate on the visual preview
                                        if (mode !== "preview") {
                                            handleModeClick("preview");
                                        }
                                    }
                                }}
                                className={`group relative flex h-9 w-9 items-center justify-center rounded-full border text-[11px] shadow-sm transition ${!sidebarHidden && sidePanelMode === "revision-chat"
                                    ? "border-transparent bg-accent text-white"
                                    : "border-neutral-300 bg-white/90/80 text-neutral-500 hover:border-transparent hover:bg-accent hover:text-white"
                                    }`}
                            >
                                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                                <span className="sr-only">AI edit chat</span>
                                <span className="pointer-events-none absolute left-11 top-1/2 hidden -translate-y-1/2 rounded-md bg-neutral-900 px-2 py-1 text-[10px] font-medium text-white shadow-sm group-hover:inline-block">
                                    AI edit chat
                                </span>
                            </button>

                            {/* AI images */}
                            <button
                                type="button"
                                id="kloner-ai-image-library"
                                onClick={() => {
                                    const isActive = !sidebarHidden && sidePanelMode === "ai-library";
                                    if (isActive) {
                                        setSidebarHidden(true);
                                    } else {
                                        setSidePanelMode("ai-library");
                                        setSidebarHidden(false);
                                        if (mode === "screenshot") {
                                            handleModeClick("preview");
                                        }
                                    }
                                }}
                                className={`group relative flex h-9 w-9 items-center justify-center rounded-full border text-[11px] shadow-sm transition ${!sidebarHidden && sidePanelMode === "ai-library"
                                    ? "border-transparent bg-accent text-white"
                                    : "border-neutral-300 bg-white/90/80 text-neutral-500 hover:border-transparent hover:bg-accent hover:text-white"
                                    }`}
                            >
                                <Images className="h-4 w-4" aria-hidden="true" />
                                <span className="sr-only">AI images</span>
                                <span className="pointer-events-none absolute left-11 top-1/2 hidden -translate-y-1/2 rounded-md bg-neutral-900 px-2 py-1 text-[10px] font-medium text-white shadow-sm group-hover:inline-block">
                                    AI images
                                </span>
                            </button>

                            {/* Code */}
                            {isDevCodeMode && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const isActive = !sidebarHidden && sidePanelMode === "code" && mode === "code";

                                        if (isActive) {
                                            handleModeClick("preview");
                                        } else {
                                            setSidebarHidden(false);
                                            setSidePanelMode("code");
                                            handleModeClick("code");
                                        }
                                    }}
                                    className={`group relative flex h-9 w-9 items-center justify-center rounded-full border text-[11px] shadow-sm transition ${mode === "code" && sidePanelMode === "code" && !sidebarHidden
                                        ? "border-transparent bg-accent text-white"
                                        : "border-neutral-300 bg-white/90/80 text-neutral-500 hover:border-transparent hover:bg-accent hover:text-white"
                                        }`}
                                >
                                    <Code2 className="h-4 w-4" aria-hidden="true" />
                                    <span className="sr-only">Code</span>
                                    <span className="pointer-events-none absolute left-11 top-1/2 hidden -translate-y-1/2 rounded-md bg-neutral-900 px-2 py-1 text-[10px] font-medium text-white shadow-sm group-hover:inline-block">
                                        Code
                                    </span>
                                </button>
                            )}

                            {/* Deploy */}
                            <button
                                id="kloner-actions-row"
                                type="button"
                                onClick={() => setExportPrompt(true)}
                                disabled={exporting}
                                className={`group relative flex h-9 w-9 items-center justify-center rounded-full border text-[11px] shadow-sm transition ${exporting
                                    ? "border-transparent bg-accent/70 text-white cursor-not-allowed"
                                    : "border-neutral-300 bg-white/90/80 text-neutral-500 hover:border-transparent hover:bg-accent hover:text-white"
                                    }`}
                            >
                                <Rocket className="h-4 w-4" aria-hidden="true" />
                                <span className="sr-only">Deploy</span>
                                <span className="pointer-events-none absolute left-11 top-1/2 hidden -translate-y-1/2 rounded-md bg-neutral-900 px-2 py-1 text-[10px] font-medium text-white shadow-sm group-hover:inline-block">
                                    Deploy
                                </span>
                            </button>

                            {/* Screenshot */}
                            <button
                                type="button"
                                onClick={() => {
                                    setSidebarHidden(true);
                                    setSidePanelMode("style");
                                    handleModeClick("screenshot");
                                }}
                                className={`group relative flex h-9 w-9 items-center justify-center rounded-full border text-[11px] shadow-sm transition ${mode === "screenshot"
                                    ? "border-transparent bg-accent text-white"
                                    : "border-neutral-300 bg-white/90/80 text-neutral-500 hover:border-transparent hover:bg-accent hover:text-white"
                                    }`}
                            >
                                <Camera className="h-4 w-4" aria-hidden="true" />
                                <span className="sr-only">Screenshot</span>
                                <span className="pointer-events-none absolute left-11 top-1/2 hidden -translate-y-1/2 rounded-md bg-neutral-900 px-2 py-1 text-[10px] font-medium text-white shadow-sm group-hover:inline-block">
                                    Screenshot
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* FLOATING EDITOR SIDEBAR? */}
                    {!sidebarHidden && (
                        <motion.aside
                            id="kloner-style-sidebar"
                            className="pointer-events-auto fixed left-16 top-20 bottom-20 z-40 flex w-[300px] md:w-[350px] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white/60 px-3 py-3 pb-5 shadow-lg backdrop-blur-sm"
                            initial={{ x: -16, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: -16, opacity: 0 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                        >
                            {/* put your panel contents in a scroll area */}
                            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                                {/* STYLE MODE BODY */}
                                {!controlsCollapsed && sidePanelMode === "style" && (
                                    <>
                                        {mode === "preview" && (
                                            <div
                                                className="mt-1 border-t border-neutral-200 pt-3 text-[12px]"
                                                id="kloner-selection-style"
                                            >
                                                <div className="mb-1 flex items-center justify-between">
                                                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                                                        Selection
                                                    </div>
                                                    <div className="text-[11px] text-neutral-400">
                                                        {selectionMeta.has
                                                            ? selectionMeta.tagName || "Element"
                                                            : "Click any block to style it"}
                                                    </div>
                                                </div>
                                                <div className="mb-2 text-[11px] text-neutral-400">
                                                    Styles here are scoped to the current{" "}
                                                    <span className="font-semibold">{device}</span> layout.
                                                </div>

                                                <div className="space-y-3 text-[12px] max-h-64 overflow-y-auto pr-1 lg:max-h-none">
                                                    {(mergedThemeColors.length || theme.fontFamilies.length) > 0 && (
                                                        <div className="mt-2 space-y-3 border-t border-neutral-200 pt-3">
                                                            <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-400">
                                                                Theme (from this page)
                                                            </div>

                                                            {mergedThemeColors.length > 0 && (
                                                                <div>
                                                                    <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-neutral-400">
                                                                        Theme text color
                                                                    </div>
                                                                    <div className="flex flex-wrap gap-1">
                                                                        {mergedThemeColors.map((c) => (
                                                                            <button
                                                                                key={`theme-text-${c}`}
                                                                                type="button"
                                                                                className="h-5 w-5 rounded-full border border-black/10 shadow-sm transition hover:scale-105 active:scale-95 disabled:opacity-40"
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
                                                                    <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-neutral-400">
                                                                        Theme background
                                                                    </div>

                                                                    <div className="mb-2 flex flex-wrap items-center gap-1">
                                                                        {mergedThemeColors.map((c) => (
                                                                            <button
                                                                                key={`theme-bg-${c}`}
                                                                                type="button"
                                                                                className="h-5 w-5 rounded-full border border-black/10 shadow-sm transition hover:scale-105 active:scale-95 disabled:opacity-40"
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
                                                                            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-neutral-400/80 bg-white/90 text-[9px] font-semibold uppercase tracking-wide text-neutral-500 shadow-sm transition hover:bg-neutral-50 hover:scale-105 active:scale-95 disabled:opacity-40"
                                                                            title="Transparent background"
                                                                        >
                                                                            ⌀
                                                                        </button>
                                                                    </div>

                                                                    <div className="flex items-center gap-2 text-[11px]">
                                                                        <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-400">
                                                                            Custom background
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
                                                                            className="h-6 w-6 cursor-pointer rounded-full border border-black/10 bg-transparent p-0"
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
                                                                            className="h-7 flex-1 rounded border border-neutral-300 bg-white/90 px-2 text-[11px] text-neutral-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                                                                            placeholder="#ffffff"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Font */}
                                                    <div>
                                                        <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-neutral-400">
                                                            Font
                                                        </div>
                                                        <select
                                                            className="w-full rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[12px] shadow-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 disabled:opacity-50"
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
                                                        <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-neutral-400">
                                                            Size & headings
                                                        </div>
                                                        <div className="flex flex-wrap gap-1">
                                                            {FONT_SIZE_PRESETS.map((s) => (
                                                                <button
                                                                    key={s.id}
                                                                    type="button"
                                                                    className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] leading-tight shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                        <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-neutral-400">
                                                            Text align
                                                        </div>
                                                        <div className="flex gap-1">
                                                            {[
                                                                { id: "left", label: "Left" },
                                                                { id: "center", label: "Center" },
                                                                { id: "right", label: "Right" },
                                                            ].map((a) => (
                                                                <button
                                                                    key={a.id}
                                                                    type="button"
                                                                    className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                        <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-neutral-400">
                                                            Font weight & transform
                                                        </div>

                                                        <div className="flex flex-wrap gap-1">
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] font-light shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] font-normal shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] font-semibold shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] font-semibold shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "weight",
                                                                        value: "600",
                                                                    })
                                                                }
                                                            >
                                                                Semi-bold
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] font-bold shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] font-extrabold shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "weight",
                                                                        value: "800",
                                                                    })
                                                                }
                                                            >
                                                                Extra-bold
                                                            </button>

                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] uppercase tracking-[0.14em] shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "transform",
                                                                        value: "uppercase",
                                                                    })
                                                                }
                                                            >
                                                                UPPERCASE
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] normal-case shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={closing}
                                                                onClick={() =>
                                                                    sendStyleCommand({
                                                                        kind: "transform",
                                                                        value: "none",
                                                                    })
                                                                }
                                                            >
                                                                Aa
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Text color */}
                                                    <div>
                                                        <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-neutral-400">
                                                            Text color
                                                        </div>

                                                        <div className="mb-2 flex flex-wrap gap-1">
                                                            {TEXT_COLOR_SWATCHES.map((c) => (
                                                                <button
                                                                    key={c}
                                                                    type="button"
                                                                    className="h-5 w-5 rounded-full border border-black/10 shadow-sm transition hover:scale-105 active:scale-95 disabled:opacity-40"
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

                                                        <div className="flex items-center gap-2 text-[11px]">
                                                            <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-400">
                                                                Custom text
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
                                                                className="h-6 w-6 cursor-pointer rounded-full border border-black/10 bg-transparent p-0"
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
                                                                className="h-7 flex-1 rounded border border-neutral-300 bg-white/90 px-2 text-[11px] text-neutral-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                                                                placeholder="#111827"
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Background */}
                                                    <div>
                                                        <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-neutral-400">
                                                            Background
                                                        </div>
                                                        <div className="flex flex-wrap gap-1">
                                                            {BG_COLOR_SWATCHES.map((c) => (
                                                                <button
                                                                    key={c}
                                                                    type="button"
                                                                    className="h-5 w-5 rounded-full border border-black/10 shadow-sm transition hover:scale-105 active:scale-95 disabled:opacity-40"
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

                                                    {/* Letter spacing */}
                                                    <div>
                                                        <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-neutral-400">
                                                            Letter spacing
                                                        </div>
                                                        <div className="flex flex-wrap gap-1">
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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

                                                    {/* Block align */}
                                                    <div>
                                                        <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-neutral-400">
                                                            Block align
                                                        </div>
                                                        <div className="flex flex-wrap gap-1">
                                                            <button
                                                                type="button"
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                                className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] shadow-sm transition hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                Edit in Preview, apply with “Apply changes".
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* CODE MODE BODY – separate branch */}
                                {isDevCodeMode && sidePanelMode === "code" && (
                                    <>
                                        <div className="min-h-0 flex-1">
                                            <textarea
                                                className="h-full w-full rounded border border-neutral-300 bg-white/90 p-2 font-mono text-[12px] leading-5 outline-none shadow-sm focus:ring-1 focus:ring-neutral-400 disabled:opacity-60"
                                                value={htmlDraft}
                                                onChange={(e) => setHtmlDraft(e.target.value)}
                                                spellCheck={false}
                                                disabled={closing}
                                            />
                                        </div>
                                    </>
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
                                    <AiEditPanel
                                        renderId={draftId}
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
                    <section className="relative bg-slate-50 rounded-lg border overflow-hidden flex flex-col max-lg:order-1">
                        {mode === "preview" && draftId && (
                            <div
                                className="border-t max-h-72 overflow-auto"
                                id="kloner-ai-edit-panel"
                            >

                            </div>
                        )}


                        {showSaveNudge && (
                            <div className="mt-4 flex justify-center mt-3 pointer-events-none z-[96] rounded-full bg-emerald-600 text-white hover:brightness-95 shadow-lg px-4 py-2 text-sm">
                                This is a one-time friendly reminder to save or apply your changes as you edit, so you don’t lose them.
                            </div>
                        )}

                        {allPages && allPages.length > 0 && (
                            <div
                                className={
                                    IS_MOBILE
                                        ? "mt-2 overflow-x-auto -mx-4 px-4" // phone: allow horizontal scroll, edge-to-edge
                                        : "mt-20"                            // non-mobile: keep your existing spacing
                                }
                            >
                                <div
                                    className={
                                        IS_MOBILE
                                            ? "inline-flex min-w-max"        // let content be wider than viewport
                                            : "flex justify-center"          // desktop/tablet: centered
                                    }
                                >
                                    {/* Outer pill: Layers button + all pages in one horizontal row */}
                                    <div
                                        id="kloner-page-switcher"
                                        className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/90/80 px-2 py-1 shadow-sm"
                                    >
                                        {/* Layers toggle (kept, even though archived row is gone) */}
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

                                        {/* All pages – archived ones are greyed out with restore below */}
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

                                                            {/* Archive icon only for non-archived pages */}
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

                                                        {/* Restore control only for archived pages */}
                                                        {isArchived && (
                                                            <button
                                                                type="button"
                                                                onClick={() => restorePage(p.id)}
                                                                className="mt-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700"
                                                            >
                                                                Restore
                                                            </button>
                                                        )}
                                                    </motion.div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}


                        {(mode === "preview" || (isDevCodeMode && mode === "code")) && (
                            <div
                                ref={iframeWrapperRef}
                                className={
                                    isPreviewFullscreen
                                        ? "flex-1 min-h-0 flex flex-col overflow-hidden"
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
                                                : "ml-auto"
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
                                                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
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

                                {/* <div id="kloner-quick-undo">
                                    <FloatingBlockToolbar
                                        iframeRef={iframeRef}
                                        wrapperRef={iframeWrapperRef}
                                        selectionMeta={selectionMeta}
                                        uiScale={0}
                                    />
                                </div> */}

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
                            <div className="flex-1 overflow-auto p-6">
                                <div
                                    className="mx-auto"
                                    style={{ width: devicePx, minWidth: 320 }}
                                >
                                    {activeSourceImage ? (
                                        <img
                                            src={activeSourceImage}
                                            alt="Reference"
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
                                className="hidden lg:block absolute top-20 right-3 z-[80] w-72 max-h-[70vh]"
                            >
                                <div className="flex flex-col rounded-lg border border-neutral-200 bg-white/90/95 shadow-lg">
                                    <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
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
                                        />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                id="kloner-history"
                                onClick={() => setHistoryOpen(true)}
                                className="hidden lg:flex absolute top-20 right-3 z-[70] h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white/90/95 text-neutral-600 shadow-md hover:bg-neutral-100 hover:text-neutral-800"
                                title="Show edit history"
                            >
                                <Eye className="w-4 h-4" />
                                <span className="sr-only">Show history</span>
                            </button>
                        )}


                        {/* Mobile footer actions */}
                        <div className="fixed bottom-0 left-0 right-0 z-50 block bg-white/90/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.12)] lg:hidden">
                            <div className="flex flex-inline gap-2" id="kloner-save-changes-mobile">
                                <motion.button
                                    whileHover={{ y: -0.5 }}
                                    whileTap={{ scale: 0.99 }}
                                    onClick={() => doSave()}
                                    disabled={closing || savingDraft || !dirty}
                                    aria-busy={applyingPreview}
                                    className={`w-full rounded-md px-3 py-3 text-lg font-semibold transition focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-60 ${dirty
                                        ? "bg-emerald-600 text-white hover:brightness-95"
                                        : "bg-emerald-50 text-emerald-700"
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


                        <div className="hidden lg:block mb-3" id="kloner-apply-changes">
                            <button
                                onClick={() => {
                                    bumpSessionCounter("save")
                                    doSave()
                                }}
                                disabled={closing || savingDraft || !dirty}
                                aria-busy={applyingPreview}
                                className={`rounded px-4 py-4 w-full text-xl transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-neutral-300 active:scale-[.99] ${dirty
                                    ? "bg-emerald-600 text-white hover:brightness-95 shadow-lg"
                                    : "bg-emerald-50 text-emerald-700 pointer-events-none"
                                    }`}
                                title="Apply current draft to the live preview"
                            >
                                {applyingPreview || savingDraft ? (
                                    <a className="flex items-center justify-center flex-inline gap-2">
                                        <Loader2 className="h-10 w-10 animate-spin" />
                                        Updating preview…
                                    </a>
                                ) : dirty ? (
                                    "Apply changes"
                                ) : (
                                    "Preview is up to date"
                                )}
                            </button>

                        </div>

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
                                {/* gradient border wrapper */}
                                <div
                                    className="inline-flex rounded-2xl p-[3px] shadow-sm"
                                    style={{
                                        backgroundImage: "linear-gradient(90deg,#4f46e5,#ec4899,#f97316)",
                                        backgroundSize: "200% 200%",
                                        animation: "kloner-ai-gradient-move 3s linear infinite",
                                    }}
                                >
                                    {/* inner content with solid background */}
                                    <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-1 text-[16px] text-neutral-700">
                                        <Loader2
                                            className="h-3.5 w-3.5 animate-spin"
                                        // keep a solid color or leave default; gradient on color won't work
                                        />
                                        <span
                                            className="bg-clip-text text-transparent"
                                            style={{
                                                backgroundImage:
                                                    "linear-gradient(90deg,#4f46e5,#ec4899,#f97316)",
                                                backgroundSize: "200% 200%",
                                                animation: "kloner-ai-gradient-move 3s linear infinite",
                                            }}
                                        >
                                            Applying AI Edit...
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {!aiEditing && !closing && (
                            <div id="kloner-quick-undo">
                                <FloatingBlockToolbar
                                    iframeRef={iframeRef}
                                    wrapperRef={iframeWrapperRef}
                                    selectionMeta={selectionMeta}
                                    uiScale={0}
                                />
                            </div>
                        )}

                    </section>
                </div>

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
                        <div className="bg-white/90 rounded-lg shadow-xl p-4 w-full max-w-sm border border-neutral-200">
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
                                    className="px-2.5 py-1.5 text-xs rounded border border-neutral-300 bg-white/90 hover:bg-neutral-50 active:scale-[.98] font-semibold"
                                    onClick={() => setClosePrompt(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 text-xs rounded border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 active:scale-[.98] font-semibold"
                                    onClick={() => performClose("discard")}
                                >
                                    Discard
                                </button>
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 text-xs rounded border border-transparent bg-accent text-white hover:brightness-110 active:scale-[.98] font-semibold"
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
                        <div className="bg-white/90 rounded-lg shadow-xl p-4 w-full max-w-sm border border-neutral-200">
                            <div className="text-md font-semibold text-neutral-900 mb-2">
                                Deploy your Website?
                            </div>
                            <p className="text-sm text-neutral-600 mb-2">
                                This will export your current preview and trigger a deployment to
                                your connected Vercel project.
                            </p>
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3">
                                Warning: these changes can reach your live site once the
                                deployment finishes.
                            </p>
                            <div className="flex justify-end gap-2 text-sm">
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 rounded border border-neutral-300 bg-white/90 hover:bg-neutral-50 active:scale-[.98] disabled:opacity-60"
                                    onClick={() => setExportPrompt(false)}
                                    disabled={exporting}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={async () => {
                                        setExportPrompt(false);
                                        await doExport();
                                    }}
                                    disabled={exporting}
                                    className="inline-flex items-center gap-1.5 rounded-md font-semibold bg-accent px-2.5 py-1 text-white shadow-sm hover:border-neutral-400 disabled:opacity-60"
                                    title="Open generated layout site"
                                >
                                    <span>Deploy now</span>
                                    <Rocket className="h-5 w-5" />
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