// src/components/PreviewEditor.tsx
"use client";

import { ensureSessionAndCsrf } from "@/app/login/LoginForm";
import { useEffect, useMemo, useRef, useState, useCallback, ChangeEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Device = "desktop" | "tablet" | "mobile";
type ViewMode = "code" | "preview" | "screenshot";

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
    // NEW: raw JSON-LD object for this page
    jsonLd?: unknown;
}


async function deleteAssetsOnServer(paths: string[]) {
    if (!paths.length) return;

    try {
        const csrf = await ensureSessionAndCsrf?.();
        const res = await fetch("/api/user-blob/delete", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(csrf ? { "x-csrf": csrf } : {}),
            },
            credentials: "include",
            body: JSON.stringify({ paths }),
        });

        const body = await res.json().catch(() => ({} as any));

        console.log("[deleteAssetsOnServer] response", {
            ok: res.ok,
            status: res.status,
            body,
        });

        if (!res.ok) {
            console.error("[deleteAssetsOnServer] failed", {
                status: res.status,
                body,
            });
        }
    } catch (err) {
        console.error("[deleteAssetsOnServer] error", err);
    }
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

type SelectionMeta = {
    has: boolean;
    tagName?: string;
    path?: string | null;
};

const FONT_OPTIONS = [
    {
        id: "system-sans",
        label: "System Sans",
        css: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },
    {
        id: "system-serif",
        label: "System Serif",
        css: 'Georgia, "Times New Roman", Times, serif',
    },
    {
        id: "inter",
        label: "Inter",
        css: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },
    {
        id: "roboto",
        label: "Roboto",
        css: '"Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },
    {
        id: "poppins",
        label: "Poppins",
        css: '"Poppins", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },
    {
        id: "space-grotesk",
        label: "Space Grotesk",
        css: '"Space Grotesk", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    {
        id: "playfair",
        label: "Playfair Display",
        css: '"Playfair Display", Georgia, "Times New Roman", Times, serif',
    },
    {
        id: "mono",
        label: "Monospace",
        css: '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
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
import { Loader2, Rocket } from "lucide-react";
import { compressImageForUpload } from "@/src/lib/clientImageCompression";
import { sanitizeImageName } from "./helpers";
import AiEditPanel from "./editor/AiEditPanel";


// ───────── SEO helpers for export ─────────

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

type UploadedAsset = {
    url: string;
    path: string;
};

type DerivedTheme = {
    textColors: string[];
    bgColors: string[];
    fontFamilies: string[];
};

type SidePanelMode = "style" | "meta";


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
    initialSeoMeta,
    onSaveMeta,
    initialSeoMetaByPage,
}: Props) {
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
    const [sidePanelMode, setSidePanelMode] = useState<SidePanelMode>("style");
    const [htmlDraft, setHtmlDraft] = useState<string>("");
    const [previewHtml, setPreviewHtml] = useState<string>("");
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [iframeKey, setIframeKey] = useState<number>(0);
    const { user } = useAuth();
    const [activePageId, setActivePageId] = useState<string>("");
    const [derivedPages, setDerivedPages] = useState<EditorPage[]>([]);
    const [pageSwitchConfirm, setPageSwitchConfirm] = useState<{ targetId: string } | null>(null);
    const [aiPreviewHtml, setAiPreviewHtml] = useState<string | null>(null);
    const [archivedPageIds, setArchivedPageIds] = useState<string[]>([]);
    const [selectionMeta, setSelectionMeta] = useState<SelectionMeta>({ has: false });
    const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);

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

    function archivePage(id: string) {
        setArchivedPageIds((prev) =>
            prev.includes(id) ? prev : [...prev, id]
        );

        // if the active page gets archived, switch to the first non-archived page
        if (id === activePageId && allPages) {
            const next = allPages.find((p) => !archivedPageIds.includes(p.id) && p.id !== id);
            if (next) {
                handlePageSwitch(next.id);
            }
        }
    }

    function restorePage(id: string) {
        setArchivedPageIds((prev) => prev.filter((x) => x !== id));
    }


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

        // Prefer path-based targeting (same as getSelectedBlockHtml)
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

        // If this page already has a favicon, use it as-is.
        if (base.faviconUrl) return base;

        // Otherwise, fall back to ANY favicon in the map (global favicon).
        const anyFavicon = Object.values(seoMetaByPage).find(
            (m) => m.faviconUrl && m.faviconUrl.trim() !== "",
        );

        if (!anyFavicon) return base;

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
            const pageKey =
                currentPageKey && currentPageKey !== "single"
                    ? currentPageKey
                    : SINGLE_PAGE_KEY;

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
                    pageKey === SINGLE_PAGE_KEY ? null : pageKey,
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
        ],
    );


    const theme = useMemo(
        () => deriveThemeFromInitialHtml(initialHtml),
        [initialHtml],
    );

    type MetaWithJsonLd = SeoMeta & {
        jsonLd?: unknown;
    };

    type MetaSettingsProps = {
        draftId?: string;
        meta: MetaWithJsonLd;
        uploadFileToUserBlob: (file: File, draftId: string) => Promise<UploadedAsset>;
        onSaveMeta?: (meta: MetaWithJsonLd) => Promise<void> | void;
    };

    function MetaSettings({
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

        useEffect(() => {
            function handleMessage(event: MessageEvent) {
                const data = event.data;
                if (!data || typeof data !== "object") return;

                if (data.type === "kloner:selection-changed") {
                    const nextMeta: SelectionMeta = {
                        has: !!data.has,
                        path: data.path ?? data.meta?.path ?? null,
                        // keep any other fields you use:
                        // isTextLike: !!data.isTextLike,
                        // isImage: !!data.isImage,
                    };

                    setSelectionMeta(nextMeta);

                    // only update lastSelectedPath when we have an active selection
                    if (nextMeta.has && nextMeta.path) {
                        setLastSelectedPath(nextMeta.path);
                    }
                }

                if (data.type === "kloner:clear-selection") {
                    // allow the highlight to clear, but keep lastSelectedPath
                    setSelectionMeta((prev) => ({
                        ...prev,
                        has: false,
                        // DO NOT blank path here
                    }));
                }
            }

            window.addEventListener("message", handleMessage);
            return () => window.removeEventListener("message", handleMessage);
        }, []);



        // when page / meta changes, re-seed form + JSON editor
        useEffect(() => {
            setDraftMeta(meta);
            setJsonText(meta.jsonLd ? JSON.stringify(meta.jsonLd, null, 2) : "");
        }, [meta]);

        const handleMetaChange = (key: keyof MetaWithJsonLd, value: string) => {
            setDraftMeta((prev) => ({ ...prev, [key]: value }));
        };

        useEffect(() => {
            function handleMessage(event: MessageEvent) {
                const data = event.data;
                if (!data || typeof data !== "object") return;

                if (data.type === "kloner:delete-assets") {
                    const paths = Array.isArray(data.paths) ? data.paths : [];
                    console.log("[PreviewEditor] kloner:delete-assets", { paths });
                    deleteAssetsOnServer(paths);
                }
            }

            window.addEventListener("message", handleMessage);
            return () => window.removeEventListener("message", handleMessage);
        }, []);


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

                const metaToSave: SeoMeta = {
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
                setDraftMeta((prev) => ({ ...prev, faviconUrl: url }));
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
                        className="block text-sm font-medium text-gray-700"
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
                    <p className="text-xs text-gray-500 mt-1">
                        Used in browser tabs and search results. Max 60 characters.
                    </p>
                </div>

                {/* Meta description */}
                <div>
                    <label
                        htmlFor="meta-description"
                        className="block text-sm font-medium text-gray-700"
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
                    <p className="text-xs text-gray-500 mt-1">
                        Used for search snippets. Max 160 characters.
                    </p>
                </div>

                {/* OG image URL */}
                <div>
                    <label
                        htmlFor="meta-og-image"
                        className="block text-sm font-medium text-gray-700"
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
                    <p className="text-xs text-gray-500 mt-1">
                        Image shown when this page is shared on social platforms.
                    </p>
                </div>

                {/* Favicon upload */}
                <div>
                    <label
                        htmlFor="meta-favicon"
                        className="block text-sm font-medium text-gray-700"
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
                            className={`cursor-pointer inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${uploading
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
                        className="block text-sm font-medium text-gray-700"
                    >
                        JSON-LD (advanced)
                    </label>
                    <textarea
                        id="meta-jsonld"
                        name="meta-jsonld"
                        value={jsonText}
                        onChange={(e) => setJsonText(e.target.value)}
                        placeholder='{
                            "@context": "https://schema.org",
                            "@type": "WebPage",
                            "name": "The Basic Website — Sample Brand",
                            "url": "https://example.com/"
                            }'
                        rows={10}
                        className="mt-1 block w-full rounded-md border-gray-300 font-mono text-xs leading-5 shadow-sm focus:border-accent focus:ring-accent p-2 border"
                        spellCheck={false}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        Must be valid JSON. This content will be rendered inside a{" "}
                        {`<script type="application/ld+json">`} tag for this page.
                    </p>
                </div>

                {/* Save meta button with debounce */}
                <button
                    type="button"
                    onClick={handleMetaSaveClick}
                    disabled={saving}
                    className={`inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition ${saving
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
        if (typeof window === "undefined") return 0.85;
        const v = Number(localStorage.getItem("kloner:uiScale"));
        return Number.isFinite(v) && v >= 0.5 && v <= 1.25 ? v : 0.85;
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

    // NEW: Device toggle logic
    const handleDeviceChange = useCallback((next: Device) => {
        if (device === next) return;
        setDevice(next);
        tryClearIframeSelection();
    }, [device, tryClearIframeSelection]);


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

    function applyDraftToPreview() {
        // hard debounce – ignore if an apply is already in flight
        if (applyingPreview) return;

        setApplyingPreview(true);

        // Use the current draft as the single source of truth
        // Do NOT re-read from the iframe or original HTML here.
        const nextHtml = htmlDraft;

        setPreviewHtml(nextHtml); // what you use for srcDoc / export
        emitLive(nextHtml);       // whatever live sync / broadcast you do
        setDirty(false);

        window.setTimeout(() => {
            setApplyingPreview(false);
        }, 450);
    }


    async function doSave(options?: { applyToPreview?: boolean }) {
        if (savingDraft) return;

        // must have a draftId to associate uploads with
        if (!draftId) {
            console.error("doSave called without draftId");
            return;
        }

        setSavingDraft(true);
        try {
            const doc = iframeRef.current?.contentDocument ?? document;

            // 1) upload any local-only images and rewrite DOM src/src-path
            await flushPendingImagesBeforeSave({
                doc,
                draftId,
            });

            // 2) now capture HTML with final URLs and WITHOUT Kloner toolbar / editor UI
            const nextHtml = doc
                ? snapshotCleanFromDocument(doc)
                : snapshotFromIframeOrDraft();

            setHtmlDraft(nextHtml);

            if (!saveDraft) {
                setPreviewHtml(nextHtml);
                if (options?.applyToPreview) {
                    emitLive(nextHtml);
                }
                setDirty(false);
                return;
            }

            const nextVersion = version + 1;

            await saveDraft({
                draftId,
                html: nextHtml,
                meta: {
                    nameHint: nameHint || undefined,
                    device,
                    mode,
                    pageId: activePageId || undefined,
                },
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

        const doc = iframeRef.current?.contentDocument;
        const hasPendingImages = !!doc?.querySelector("img[data-local-image-id]");

        if (hasPendingImages) {
            // open nice confirmation box instead of window.confirm
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

        try {
            await doSave({ applyToPreview: true });

            const baseHtmlRaw = snapshotFromIframeOrDraft();
            const baseHtml = (baseHtmlRaw || previewHtml || "").trim();
            if (!baseHtml) {
                throw new Error("No HTML available to export");
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
        } catch (e: any) {
            const msg = String(e?.message || "");
            if (/401|403|unauth/i.test(msg)) {
                setExportNote(
                    "Export blocked. Connect your Vercel account in Settings, then retry."
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
        const head = docClone.querySelector("head");
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
                (n as HTMLElement).removeAttribute("data-kloner-sel")
            );
            body.querySelectorAll("[contenteditable]").forEach((n) =>
                (n as HTMLElement).removeAttribute("contenteditable")
            );
            body.querySelectorAll<HTMLElement>("[data-kloner]").forEach((n) =>
                n.removeAttribute("data-kloner")
            );

            // Kill any <meta> / <title> that ended up inside <body>
            body.querySelectorAll("meta, title").forEach((n) => n.remove());
        }

        if (head) {
            // Editor style blocks
            head.querySelectorAll("[data-kloner-style]").forEach((n) => n.remove());
            head.querySelectorAll("style[id^='kloner-']").forEach((n) => n.remove());

            // Safety net: nukes any remaining editor styles
            head.querySelectorAll("style").forEach((s) => {
                const txt = s.textContent || "";
                if (
                    txt.includes(".kloner-toolbar") ||
                    txt.includes("kloner-style-panel") ||
                    txt.includes("data-kloner") ||
                    txt.includes(".kgroup") ||
                    txt.includes(".kbtn")
                ) {
                    s.remove();
                }
            });

            // Optional: remove any explicit editor scripts by id or content
            head.querySelectorAll("script[id^='kloner-']").forEach((n) => n.remove());
            head.querySelectorAll("script").forEach((s) => {
                const txt = s.textContent || "";
                if (
                    txt.includes("kloner-toolbar") ||
                    txt.includes("data-kloner")
                ) {
                    s.remove();
                }
            });
        }

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
        console.log("[uploadFileToUserBlob] start", {
            draftId,
            originalName: file.name,
            originalBytes: file.size,
            originalType: file.type,
        });

        // 1) compress on the client first (if helpful)
        let fileForUpload = file;
        try {
            const compressed = await compressImageForUpload(file);

            if (compressed !== file) {
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
                fileForUpload = compressed;
            } else {
                console.log("[uploadFileToUserBlob] compression skipped or not beneficial", {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                });
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

        console.log("[uploadFileToUserBlob] POST", {
            url,
            hasCsrf: !!csrf,
            uploadName: fileForUpload.name,
            uploadBytes: fileForUpload.size,
            uploadType: fileForUpload.type,
        });

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

        console.log("[uploadFileToUserBlob] response", {
            ok: res.ok,
            status: res.status,
            bodyKeys: Object.keys(j || {}),
        });

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

        console.log("[uploadFileToUserBlob] success", {
            ...asset,
            uploadedBytes: fileForUpload.size,
            uploadedType: fileForUpload.type,
        });

        return asset;
    }


    async function flushPendingImagesBeforeSave(args: {
        doc: Document;
        draftId: string;
    }) {
        const { doc, draftId } = args;

        console.log("[flushPendingImagesBeforeSave] start", { draftId });

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
            console.log("[flushPendingImagesBeforeSave] deleting stale old paths", {
                count: stalePaths.length,
                stalePaths,
            });
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

        console.log("[flushPendingImagesBeforeSave] found img elements", {
            count: imgs.length,
        });

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
                console.log("[flushPendingImagesBeforeSave] fetching blob URL (img)", {
                    localId,
                    tempUrl,
                });

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

                console.log("[flushPendingImagesBeforeSave] uploading image (img)", {
                    localId,
                    fileName: file.name,
                    fileSize: file.size,
                    type: file.type,
                });

                const asset = await uploadFileToUserBlob(file, draftId);

                const oldTempUrl = img.src;

                img.src = asset.url;
                img.removeAttribute("data-local-image-id");
                img.removeAttribute("data-local-filename");

                if (asset.path) {
                    img.setAttribute("data-kloner-path", asset.path);
                }

                console.log("[flushPendingImagesBeforeSave] img updated", {
                    localId,
                    oldTempUrl,
                    newUrl: asset.url,
                    path: asset.path,
                });

                try {
                    URL.revokeObjectURL(oldTempUrl);
                    console.log(
                        "[flushPendingImagesBeforeSave] revoked temp URL (img)",
                        { localId }
                    );
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

        console.log("[flushPendingImagesBeforeSave] found bg blocks with local image", {
            count: bgBlocks.length,
        });

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
                console.log(
                    "[flushPendingImagesBeforeSave] fetching blob URL (bg block)",
                    { localId, tempUrl }
                );

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

                console.log("[flushPendingImagesBeforeSave] uploading image (bg block)", {
                    localId,
                    fileName: file.name,
                    fileSize: file.size,
                    type: file.type,
                });

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

                console.log("[flushPendingImagesBeforeSave] bg block updated", {
                    localId,
                    oldTempUrl,
                    newUrl: asset.url,
                    path: asset.path,
                });

                try {
                    URL.revokeObjectURL(oldTempUrl);
                    console.log(
                        "[flushPendingImagesBeforeSave] revoked temp URL (bg block)",
                        { localId }
                    );
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


    const handleModeClick = useCallback(
        (next: ViewMode) => {
            if (closing || mode === next) return;
            setMode(next);
            tryClearIframeSelection();
        },
        [closing, mode, tryClearIframeSelection]
    );

    const activeSourceImage = useMemo(
        () =>
            (allPages && activePage && activePage.screenshotUrl) || sourceImage,
        [allPages, activePage, sourceImage]
    );

    // inside your component render, before the return:
    const iframeNode = (
        <iframe
            key={iframeKey}
            ref={iframeRef}
            className="w-full h-[70vh] sm:h-[80vh] border-0"
            title="KlonerPreview"
            sandbox="allow-same-origin"
            srcDoc={
                aiPreviewHtml ||
                renderHtml ||
                "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>"
            }
            onLoad={() => {
                const doc = iframeRef.current?.contentDocument;
                if (!doc) return;
                doc.querySelectorAll(".kloner-toolbar").forEach((n) => n.remove());
                doc.querySelectorAll(".kloner-style-panel").forEach((n) => n.remove());
                if (mode === "preview") {
                    injectEditableOverlay(doc, (updated) => {
                        setHtmlDraft(updated);
                    });
                    iframeRef.current?.contentWindow?.focus();
                }
            }}
        />
    );


    return (
        <div
            ref={containerRef}
            tabIndex={-1}
            className="fixed inset-0 z-[9999] bg-black/50"
        >
            {/* make this relative so we can anchor the close button */}
            <div className="absolute inset-4 overflow-hidden">
                {/* NEW: global top-right close button, above iframe */}
                <button
                    type="button"
                    onClick={() => {
                        if (dirty) setClosePrompt(true);
                        else performClose("discard");
                    }}
                    disabled={closing}
                    className={`absolute top-5 right-5 z-[100] inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold shadow-lg  ${closing
                        ? "bg-accent text-white cursor-not-allowed"
                        : "bg-accent text-white"
                        }`}
                >
                    <span>Close editor</span>
                    {/* <span aria-hidden="true" className="text-base leading-none">
                        ✕
                    </span> */}
                </button>

                <div
                    className="bg-white rounded-xl shadow-xl grid grid-cols-[minmax(320px,360px),1fr] gap-4 p-4 max-lg:grid-cols-1"
                    style={{
                        transform: `scale(${uiScale})`,
                        transformOrigin: "top left",
                        width: `${100 / uiScale}%`,
                        height: `${100 / uiScale}%`,
                    }}
                >
                    {/* ⛔️ REMOVE this old close button block entirely */}
                    {/*
                        <button
                        onClick={() => {
                            if (dirty) setClosePrompt(true);
                            else performClose("discard");
                        }}
                        disabled={closing}
                        className={`px-3 w-full py-3 mt-2 text-md font-medium rounded-md transition-colors ${
                            closing
                            ? "bg-accent text-white opacity-80 cursor-not-allowed"
                            : "bg-accent text-white"
                        }`}
                        >
                        Close Editor
                        </button>
                        */}

                    <aside className="flex flex-col min-w-0 overflow-auto pr-1 max-lg:order-2">

                        {/* NEW: Style/Meta Toggle */}
                        <div className="inline-flex rounded-md shadow-sm mb-4">
                            <button
                                onClick={() => setSidePanelMode("style")}
                                className={`px-3 py-1 text-lg font-medium rounded-l-md transition-colors ${sidePanelMode === "style"
                                    ? "bg-accent text-white"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                            >
                                Edit Styles
                            </button>
                            <button
                                onClick={() => setSidePanelMode("meta")}
                                className={`px-3 py-1 text-md font-medium rounded-r-md transition-colors ${sidePanelMode === "meta"
                                    ? "bg-accent text-white"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                            >
                                Edit Meta
                            </button>
                        </div>

                        {/* Compact header + toggle – always visible */}
                        <div className="sticky top-0 z-10 flex items-center justify-between bg-white/95 pb-2 backdrop-blur-sm">
                            <div className="flex items-center justify-between w-full">
                                {sidePanelMode === "meta" && (
                                    <MetaSettings
                                        key={currentPageKey}
                                        draftId={draftId}
                                        meta={currentSeoMeta}
                                        uploadFileToUserBlob={uploadFileToUserBlob}
                                        onSaveMeta={handleSaveMetaForCurrentPage}
                                    />
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-medium text-neutral-500 lg:hidden">
                                    Editor controls
                                </span>
                            </div>
                        </div>

                        {/* All existing controls – only hidden when collapsed */}
                        {(!controlsCollapsed && sidePanelMode === "style") && (
                            <>
                                <div className="mb-3">
                                    <div className="text-xs font-semibold text-neutral-500 mb-1">
                                        View
                                    </div>

                                    <div className="flex flex-wrap gap-1">
                                        {/* <UiBtn
                                            pressed={mode === "code"}
                                            onClick={() => handleModeClick("code")}
                                            disabled={closing}
                                        >
                                            Code
                                        </UiBtn> */}
                                        <button
                                            onClick={() =>
                                                handleModeClick("preview")
                                            }
                                            disabled={closing}
                                            className={`px-3 py-1 text-md font-medium rounded-l-md transition-colors ${mode === "preview"
                                                ? "bg-accent text-white"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                        >
                                            Preview
                                        </button>
                                        <button
                                            onClick={() =>
                                                handleModeClick("screenshot")
                                            }
                                            disabled={closing}
                                            className={`px-3 py-1 text-md font-medium rounded-r-md transition-colors ${mode === "screenshot"
                                                ? "bg-accent text-white"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                        >
                                            Screenshot
                                        </button>
                                    </div>
                                </div>

                                <div className="mb-3">
                                    <div className="text-xs font-semibold text-neutral-500 mb-1">
                                        Device
                                    </div>

                                    <div className="inline-flex rounded-md shadow-sm">
                                        <motion.button
                                            type="button"
                                            onClick={() => handleDeviceChange("desktop")}
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.97 }}
                                            className={`p-2 text-lg rounded-l-md transition-colors ${device === "desktop"
                                                ? "bg-blue-600 text-white"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                            title="Desktop"
                                        >
                                            💻
                                        </motion.button>
                                        <motion.button
                                            type="button"
                                            onClick={() => handleDeviceChange("tablet")}
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.97 }}
                                            className={`p-2 text-lg transition-colors ${device === "tablet"
                                                ? "bg-blue-600 text-white"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                            title="Tablet"
                                        >
                                            📱
                                        </motion.button>
                                        <motion.button
                                            type="button"
                                            onClick={() => handleDeviceChange("mobile")}
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.97 }}
                                            className={`p-2 text-lg rounded-r-md transition-colors ${device === "mobile"
                                                ? "bg-blue-600 text-white"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                            title="Mobile"
                                        >
                                            🤳
                                        </motion.button>
                                    </div>


                                    <div className="flex flex-col items-start gap-1 mt-4">
                                        <span className="text-xs font-semibold mb-1 text-neutral-500">
                                            UI Scale
                                        </span>

                                        <div className="flex items-center gap-1 text-xs text-slate-600">
                                            <button
                                                className="px-2 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                                onClick={() =>
                                                    setUiScale((s) => Math.max(0.5, +(s - 0.05).toFixed(2)))
                                                }
                                                disabled={closing}
                                            >
                                                -
                                            </button>
                                            <span className="w-10 text-center">
                                                {Math.round(uiScale * 100)}%
                                            </span>
                                            <button
                                                className="px-2 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                                onClick={() =>
                                                    setUiScale((s) => Math.min(1.25, +(s + 0.05).toFixed(2)))
                                                }
                                                disabled={closing}
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>

                                </div>

                                <div className="my-3">
                                    <div className="text-xs font-semibold text-neutral-500 mb-1">
                                        Actions
                                    </div>

                                    {/* MATCHES 1) EXACT LOOK + FEEL */}
                                    <div className="flex flex-wrap items-center gap-1">

                                        {/* Save Draft
                                        <button
                                              onClick={() => setExportPrompt(true)}
                                              disabled={closing || exporting}
                                            className={`px-3 py-1 text-md font-medium rounded-md transition-colors
                ${savingDraft
                                                    ? "bg-accent text-white opacity-80 cursor-not-allowed"
                                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                        >
                                            {savingDraft ? "💾 Saving…" : "💾 Save changes"}
                                        </button> */}



                                        <div
                                            className="group flex flex-inline items-center gap-1 rounded-lg px-3 py-1.5 text-white text-md"
                                            style={{ backgroundColor: ACCENT }}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => setExportPrompt(true)}
                                                className="font-semibold"
                                            >
                                                {exporting ? "Exporting…" : "Deploy"}
                                            </button>
                                            <Rocket className="h-4 w-4 transform transition-transform duration-150 group-hover:translate-x-0.5 text-md" />
                                        </div>

                                        {/* Export to Vercel */}
                                        {/* <button
                                            onClick={() => setExportPrompt(true)}
                                            disabled={closing || exporting}
                                            className={`px-3 py-1 text-md font-medium rounded-md transition-colors
                                                ${exporting
                                                    ? "bg-accent text-white opacity-80 cursor-not-allowed"
                                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                        >
                                            {exporting ? "🚀 Exporting…" : "🚀 Deploy Website"}
                                        </button> */}
                                        {/* 
                                        <button
                                            onClick={() => {
                                                if (dirty) setClosePrompt(true);
                                                else performClose("discard");
                                            }}
                                            disabled={closing}
                                            className={`px-3 w-full py-3 mt-2 text-md font-medium rounded-md transition-colors ${closing
                                                ? "bg-accent text-white opacity-80 cursor-not-allowed"
                                                : "bg-accent text-white"
                                                }`}
                                        >
                                            Close Editor
                                        </button>

 */}
                                    </div>

                                    {exportNote && (
                                        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] text-amber-800">
                                            {exportNote}
                                        </div>
                                    )}
                                </div>


                                {/* Selection styling sidebar */}
                                {mode === "preview" && (
                                    <div className="mb-3 border-t pt-5 mt-2">
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="text-sm font-semibold text-neutral-500">
                                                Selection style
                                            </div>
                                            <div className="text-[10px] text-neutral-400">
                                                {selectionMeta.has
                                                    ? selectionMeta.tagName ||
                                                    "Element"
                                                    : "Click any block to style it"}
                                            </div>
                                        </div>
                                        <div className="mb-1 text-[10px] text-neutral-400">
                                            Styles here are scoped to the current{" "}
                                            <span className="font-semibold">
                                                {device}
                                            </span>{" "}
                                            layout.
                                        </div>

                                        <div className="space-y-2 text-sm max-h-64 lg:max-h-none overflow-y-auto pr-1">

                                            {/* Theme from page */}
                                            {(theme.textColors.length ||
                                                theme.bgColors.length ||
                                                theme.fontFamilies.length) > 0 && (
                                                    <div className="mt-4 space-y-3 border-t border-neutral-200 pt-3">
                                                        <div className="text-[10px] uppercase tracking-wide text-neutral-400">
                                                            Theme (from this page)
                                                        </div>

                                                        {/* Theme text colors */}
                                                        {theme.textColors.length > 0 && (
                                                            <div>
                                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                                    Theme text color
                                                                </div>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {theme.textColors.map((c) => (
                                                                        <button
                                                                            key={c}
                                                                            type="button"
                                                                            className="w-6 h-6 rounded-full border border-black/10 shadow-sm hover:scale-105 active:scale-95 disabled:opacity-40"
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

                                                        {/* Theme background colors */}
                                                        {theme.bgColors.length > 0 && (
                                                            <div>
                                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                                    Theme background
                                                                </div>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {theme.bgColors.map((c) => (
                                                                        <button
                                                                            key={c}
                                                                            type="button"
                                                                            className="w-6 h-6 rounded-full border border-black/10 shadow-sm hover:scale-105 active:scale-95 disabled:opacity-40"
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
                                                        )}

                                                        {/* Theme font families
                                                        {theme.fontFamilies.length > 0 && (
                                                            <div>
                                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                                    Theme fonts
                                                                </div>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {theme.fontFamilies.map((f) => (
                                                                        <button
                                                                            key={f}
                                                                            type="button"
                                                                            disabled={closing}
                                                                            onClick={() =>
                                                                                sendStyleCommand({
                                                                                    kind: "fontFamily",
                                                                                    value: f,
                                                                                })
                                                                            }
                                                                            className="px-2 py-1 rounded-full border border-black/10 bg-white text-sm shadow-sm hover:scale-105 active:scale-95 disabled:opacity-40"
                                                                            style={{ fontFamily: f }}
                                                                        >
                                                                            {f}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )} */}
                                                    </div>
                                                )}


                                            {/* Font family */}
                                            <div>
                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                    Font
                                                </div>
                                                <select
                                                    className="w-full border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-50"
                                                    disabled={closing}
                                                    onChange={(e) => {
                                                        const opt =
                                                            FONT_OPTIONS.find(
                                                                (f) =>
                                                                    f.id ===
                                                                    e.target
                                                                        .value
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
                                                        >
                                                            {f.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            {/* Font size */}
                                            <div>
                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                    Size & headings
                                                </div>
                                                <div className="flex flex-wrap gap-1">
                                                    {FONT_SIZE_PRESETS.map((s) => (
                                                        <button
                                                            key={s.id}
                                                            type="button"
                                                            className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] leading-tight hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                            disabled={closing}
                                                            style={{ fontSize: s.px / 1.5 }}
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


                                            {/* Align */}
                                            <div>
                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                    Text align
                                                </div>
                                                <div className="flex gap-1">
                                                    {[
                                                        {
                                                            id: "left",
                                                            label: "Left",
                                                        },
                                                        {
                                                            id: "center",
                                                            label: "Center",
                                                        },
                                                        {
                                                            id: "right",
                                                            label: "Right",
                                                        },
                                                    ].map((a) => (
                                                        <button
                                                            key={a.id}
                                                            type="button"
                                                            className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                            disabled={closing}
                                                            onClick={() =>
                                                                sendStyleCommand(
                                                                    {
                                                                        kind: "align",
                                                                        value: a.id as
                                                                            | "left"
                                                                            | "center"
                                                                            | "right",
                                                                    }
                                                                )
                                                            }
                                                        >
                                                            {a.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                Font weight & transform
                                            </div>

                                            {/* Weight / transform */}
                                            <div className="flex flex-wrap gap-1">
                                                {/* font-weight */}
                                                <button
                                                    type="button"
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] font-light hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] font-normal hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] font-medium hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] font-semibold hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] font-bold hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] font-extrabold hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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

                                                {/* text-transform */}
                                                <button
                                                    type="button"
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] uppercase tracking-wide hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] normal-case hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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

                                            {/* Image size
                                            <div>
                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                    Image size
                                                </div>
                                                <div className="flex flex-wrap gap-1">
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "widthPreset",
                                                                value: "auto",
                                                            })
                                                        }
                                                    >
                                                        Auto
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "widthPreset",
                                                                value: "narrow",
                                                            })
                                                        }
                                                    >
                                                        Small
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "widthPreset",
                                                                value: "wide",
                                                            })
                                                        }
                                                    >
                                                        Medium
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "widthPreset",
                                                                value: "full",
                                                            })
                                                        }
                                                    >
                                                        Full
                                                    </button>
                                                </div>
                                            </div> */}


                                            {/* Text color */}
                                            <div>
                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                    Text color
                                                </div>
                                                <div className="flex flex-wrap gap-1">
                                                    {TEXT_COLOR_SWATCHES.map(
                                                        (c) => (
                                                            <button
                                                                key={c}
                                                                type="button"
                                                                className="w-6 h-6 rounded-full border border-black/10 shadow-sm hover:scale-105 active:scale-95 disabled:opacity-40"
                                                                style={{
                                                                    background:
                                                                        c,
                                                                }}
                                                                disabled={
                                                                    closing
                                                                }
                                                                onClick={() =>
                                                                    sendStyleCommand(
                                                                        {
                                                                            kind: "textColor",
                                                                            value: c,
                                                                        }
                                                                    )
                                                                }
                                                            />
                                                        )
                                                    )}
                                                </div>
                                            </div>

                                            {/* Background color */}
                                            <div>
                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                    Background
                                                </div>
                                                <div className="flex flex-wrap gap-1">
                                                    {BG_COLOR_SWATCHES.map(
                                                        (c) => (
                                                            <button
                                                                key={c}
                                                                type="button"
                                                                className="w-6 h-6 rounded-full border border-black/10 shadow-sm hover:scale-105 active:scale-95 disabled:opacity-40"
                                                                style={{
                                                                    background:
                                                                        c,
                                                                }}
                                                                disabled={
                                                                    closing
                                                                }
                                                                onClick={() =>
                                                                    sendStyleCommand(
                                                                        {
                                                                            kind: "bgColor",
                                                                            value: c,
                                                                        }
                                                                    )
                                                                }
                                                            />
                                                        )
                                                    )}
                                                </div>
                                            </div>

                                            {/* Spacing (letter-spacing) */}
                                            <div>
                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                    Letter spacing
                                                </div>
                                                <div className="flex flex-wrap gap-1">
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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

                                            {/* Layout width */}
                                            <div>
                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                    Layout width
                                                </div>
                                                <div className="flex flex-wrap gap-1">
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "widthPreset",
                                                                value: "auto",
                                                            })
                                                        }
                                                    >
                                                        Auto
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "widthPreset",
                                                                value: "narrow",
                                                            })
                                                        }
                                                    >
                                                        Narrow
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "widthPreset",
                                                                value: "wide",
                                                            })
                                                        }
                                                    >
                                                        Wide
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "widthPreset",
                                                                value: "full",
                                                            })
                                                        }
                                                    >
                                                        Full bleed
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Block alignment */}
                                            <div>
                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                    Block align
                                                </div>
                                                <div className="flex flex-wrap gap-1">
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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

                                            {/* Vertical spacing */}
                                            <div>
                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                    Vertical spacing
                                                </div>
                                                <div className="flex flex-wrap gap-1 mb-1">
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "marginTop",
                                                                value: "none",
                                                            })
                                                        }
                                                    >
                                                        No top
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "marginTop",
                                                                value: "md",
                                                            })
                                                        }
                                                    >
                                                        Top space
                                                    </button>
                                                </div>
                                                <div className="flex flex-wrap gap-1">
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "marginBottom",
                                                                value: "none",
                                                            })
                                                        }
                                                    >
                                                        No bottom
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "marginBottom",
                                                                value: "lg",
                                                            })
                                                        }
                                                    >
                                                        Bottom space
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Text wrapping
                                            <div>
                                                <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">
                                                    Text wrapping
                                                </div>
                                                <div className="flex flex-wrap gap-1">
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "wrap",
                                                                value: "normal",
                                                            })
                                                        }
                                                    >
                                                        Normal
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "wrap",
                                                                value: "nowrap",
                                                            })
                                                        }
                                                    >
                                                        No wrap
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                        disabled={closing}
                                                        onClick={() =>
                                                            sendStyleCommand({
                                                                kind: "wrap",
                                                                value: "balance",
                                                            })
                                                        }
                                                    >
                                                        Balanced
                                                    </button>
                                                </div>
                                            </div> */}
                                        </div>
                                    </div>
                                )}


                                <div className="block lg:hidden fixed bottom-10 left-0 right-0 z-50 bg-white/95 border-t border-neutral-200 px-4 py-3">
                                    <div className="flex flex-col gap-2">
                                        <button
                                            onClick={() => doSave()}
                                            disabled={closing || savingDraft || !dirty}
                                            aria-busy={applyingPreview}
                                            className={`w-full rounded-md px-3 py-3 text-lg font-medium transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-neutral-300 active:scale-[.99] ${dirty
                                                ? "bg-emerald-600 text-white hover:brightness-95"
                                                : "bg-emerald-50 text-emerald-700"
                                                }`}
                                            title="Apply current draft to the live preview"
                                        >
                                            {applyingPreview
                                                ? "Updating preview…"
                                                : dirty
                                                    ? "Apply changes to preview"
                                                    : "Preview is up to date"}
                                        </button>

                                        <button
                                            onClick={() => {
                                                if (dirty) setClosePrompt(true);
                                                else performClose("discard");
                                            }}
                                            disabled={closing}
                                            className={`w-full px-3 py-3 text-lg font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-300 active:scale-[.99] ${closing
                                                ? "bg-accent text-white opacity-80 cursor-not-allowed"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                        >
                                            ❌ Close
                                        </button>
                                    </div>
                                </div>

                                {/* {mode === "code" && (
                                    <div className="min-h-0 flex-1">
                                        <textarea
                                            className="h-full w-full border rounded p-2 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-60"
                                            value={htmlDraft}
                                            onChange={(e) => setHtmlDraft(e.target.value)}
                                            spellCheck={false}
                                            disabled={closing}
                                        />
                                    </div>
                                )} */}

                                {mode === "screenshot" && (
                                    <div className="text-xs text-slate-600">
                                        Edit in Preview, apply with “Apply
                                        changes".
                                    </div>
                                )}
                            </>
                        )}
                    </aside>

                    {/* Right / canvas */}
                    <section
                        className="relative bg-slate-50 rounded-lg border overflow-hidden flex flex-col max-lg:order-1"
                    // this was unselecting the block when clicking edit panel
                    // onPointerDown={(e) => {
                    //     if (!(e.target as HTMLElement).closest("iframe"))
                    //         tryClearIframeSelection();
                    // }}
                    >

                        {mode === "preview" && draftId && (
                            <div className="border-t max-h-72 overflow-auto">
                                <AiEditPanel
                                    renderId={draftId}
                                    getSelectedBlockHtml={getSelectedBlockHtml}
                                    selectionMeta={selectionMeta}
                                    onApplyBlockHtml={(afterBlockHtml: string) => {
                                        const fullHtml = applyBlockHtmlToIframeAndSerialize(
                                            afterBlockHtml,
                                            true, // still mutate iframe directly
                                        );

                                        if (!fullHtml) {
                                            console.warn(
                                                "[PreviewEditor] applyBlockHtmlToIframeAndSerialize returned null",
                                            );
                                            return;
                                        }

                                        // NEW: run the saved HTML through the same cleaner used on snapshot
                                        let cleanedHtml = fullHtml;
                                        try {
                                            const parser = new DOMParser();
                                            const doc = parser.parseFromString(fullHtml, "text/html");
                                            cleanedHtml = snapshotCleanFromDocument(doc);
                                        } catch (err) {
                                            console.warn("[PreviewEditor] failed to clean AI-edited HTML", err);
                                        }

                                        // Mark editor dirty and sync draft/preview so Save works
                                        setDirty(true);
                                        setHtmlDraft(cleanedHtml);
                                        setPreviewHtml(cleanedHtml);
                                        if (onLiveHtml) onLiveHtml(cleanedHtml);
                                    }}
                                />
                            </div>
                        )}


                        {allPages && allPages.length > 1 && (
                            <div className="mt-3 space-y-2">
                                {/* active (non-archived) pages */}
                                <div className="flex justify-center">
                                    <div className="inline-flex items-center gap-3 rounded-full border border-neutral-200 bg-white/80 px-1 py-1 shadow-sm">
                                        {allPages
                                            .filter((p) => !archivedPageIds.includes(p.id))
                                            .map((p) => {
                                                const isActive = p.id === activePageId;
                                                return (
                                                    <motion.div
                                                        key={p.id}
                                                        layout
                                                        initial={{ opacity: 0, scale: 0.9, y: 2 }}
                                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                                        exit={{ opacity: 0, scale: 0.9, y: 2 }}
                                                        className="inline-flex items-center"
                                                    >
                                                        <motion.button
                                                            type="button"
                                                            onClick={() => handlePageSwitch(p.id)}
                                                            whileHover={{ scale: 1.03, y: -1 }}
                                                            whileTap={{ scale: 0.97 }}
                                                            className={[
                                                                "px-3 py-4 rounded-full text-md font-medium transition-colors flex items-center gap-2",
                                                                isActive
                                                                    ? "bg-accent text-white"
                                                                    : "bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-200"
                                                            ].join(" ")}
                                                        >
                                                            <span>{p.label}</span>

                                                            {/* archive icon chip */}
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
                                                                        ? "bg-white/20 text-white hover:bg-white/30"
                                                                        : "bg-neutral-200 text-neutral-700 hover:bg-neutral-300"
                                                                ].join(" ")}
                                                            >
                                                                <svg
                                                                    xmlns="http://www.w3.org/2000/svg"
                                                                    viewBox="0 0 20 20"
                                                                    fill="currentColor"
                                                                    className="h-3.5 w-3.5"
                                                                >
                                                                    <path d="M5 3a2 2 0 00-2 2v4h2V5h10v4h2V5a2 2 0 00-2-2H5z" />
                                                                    <path d="M3 11v4a2 2 0 002 2h10a2 2 0 002-2v-4h-3a3 3 0 01-6 0H3z" />
                                                                </svg>
                                                            </a>
                                                        </motion.button>
                                                    </motion.div>
                                                );
                                            })}
                                    </div>
                                </div>

                                {/* archived pages row */}
                                {archivedPageIds.length > 0 && (
                                    <div className="flex justify-center">
                                        <div className="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-300 bg-neutral-50/80 px-2 py-1">
                                            <span className="px-2 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">
                                                Archived
                                            </span>
                                            {allPages
                                                .filter((p) => archivedPageIds.includes(p.id))
                                                .map((p) => (
                                                    <button
                                                        key={p.id}
                                                        type="button"
                                                        onClick={() => restorePage(p.id)}
                                                        className="px-2 py-1 rounded-full text-md font-medium text-neutral-600 bg-white hover:bg-neutral-100 border border-neutral-200"
                                                    >
                                                        {p.label} ·
                                                        <span className="ml-1 text-md hover:underline text-emerald-600">
                                                            Restore
                                                        </span>
                                                    </button>
                                                ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* {activeSourceImage && mode !== "screenshot" && (
                            <img
                                src={activeSourceImage}
                                alt="reference"
                                className="absolute right-3 top-3 h-28 w-auto rounded border shadow pointer-events-none max-sm:hidden"
                            />
                        )} */}

                        {(mode === "preview" || mode === "code") && (
                            <div className="flex-1 overflow-auto p-3 sm:p-6">
                                <AnimatePresence mode="wait">
                                    <motion.div
                                        key={activePageId}
                                        className="mx-auto"
                                        style={{
                                            width: devicePx,
                                            minWidth: 320,
                                            maxWidth: "100%",
                                        }}
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -6 }}
                                        transition={{ duration: 0.22 }}
                                    >
                                        {device === "desktop" && (
                                            <div className="rounded-xl border border-neutral-800 bg-neutral-950/90 shadow-xl overflow-hidden">
                                                <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-800 bg-neutral-900/90">
                                                    <div className="flex gap-1.5">
                                                        <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                                                        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                                                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                                                    </div>
                                                    <div className="mx-auto h-6 max-w-xs flex-1 rounded-full bg-neutral-800/90 text-[10px] text-neutral-400 px-3 flex items-center">
                                                        preview.kloner
                                                    </div>
                                                    <div className="w-10" />
                                                </div>
                                                <div className="bg-white">{iframeNode}</div>
                                            </div>
                                        )}

                                        {device === "tablet" && (
                                            <div className="mx-auto rounded-[28px] border border-neutral-700 bg-neutral-950/90 px-4 pt-4 pb-6 shadow-xl">
                                                <div className="mx-auto mb-2 h-1.5 w-20 rounded-full bg-neutral-700" />
                                                <div className="overflow-hidden rounded-[20px] border border-neutral-200 bg-white">
                                                    {iframeNode}
                                                </div>
                                            </div>
                                        )}

                                        {device === "mobile" && (
                                            <div className="mx-auto rounded-[36px] border border-neutral-800 bg-neutral-950/90 px-3 pt-4 pb-5 shadow-xl max-w-xs sm:max-w-sm">
                                                <div className="mx-auto mb-3 h-2 w-24 rounded-full bg-neutral-700" />
                                                <div className="overflow-hidden rounded-[28px] border border-neutral-200 bg-white">
                                                    {iframeNode}
                                                </div>
                                                <div className="mx-auto mt-3 h-7 w-24 rounded-full border border-neutral-700" />
                                            </div>
                                        )}
                                    </motion.div>
                                </AnimatePresence>
                            </div>
                        )}


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
                                            className="w-full h-auto rounded border bg-white"
                                        />
                                    ) : (
                                        <div className="h-[60vh] grid place-items-center text-slate-500 text-xs">
                                            No reference screenshot
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {closing && (
                            <div className="absolute inset-0 bg-white/80 grid place-items-center">
                                <div className="flex items-center gap-3 rounded border px-3 py-2 bg-white text-xs text-neutral-800">
                                    <Spinner /> Saving & closing…
                                </div>
                            </div>
                        )}

                        <div className="
                        hidden lg:block mb-3">
                            <button
                                onClick={() => doSave()}
                                disabled={closing || savingDraft || !dirty}
                                aria-busy={applyingPreview}
                                className={`rounded px-4 py-4 text-xl w-full transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-neutral-300 active:scale-[.99] ${dirty
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
                    </section>
                </div>

                {/* page switch confirmation, closePrompt, exportPrompt, styles, etc. remain unchanged below */}
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
                                className="bg-white rounded-lg shadow-xl p-4 w-full max-w-sm border border-neutral-200"
                            >
                                <div className="text-xs font-semibold text-neutral-900 mb-2">
                                    Save images before switching pages?
                                </div>
                                <p className="text-xs text-neutral-600 mb-3">
                                    This page has images that haven’t been uploaded yet. Save them
                                    before switching, or continue without saving.
                                </p>
                                <div className="flex justify-end gap-2 text-xs">
                                    <button
                                        type="button"
                                        className="px-2.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-50 active:scale-[.98] font-medium"
                                        onClick={cancelPageSwitch}
                                    >
                                        Stay on this page
                                    </button>
                                    <button
                                        type="button"
                                        className="px-2.5 py-1.5 rounded border border-transparent bg-neutral-900 text-white hover:brightness-110 active:scale-[.98] font-medium"
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
                            <div className="text-xs font-semibold text-neutral-900 mb-2">
                                Close editor?
                            </div>
                            <p className="text-xs text-neutral-600 mb-3">
                                You have unsaved changes. Save them before closing,
                                or discard this draft.
                            </p>
                            <div className="flex justify-end gap-2 text-xs">
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-50 active:scale-[.98] font-medium"
                                    onClick={() => setClosePrompt(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 rounded border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 active:scale-[.98] font-medium"
                                    onClick={() => performClose("discard")}
                                >
                                    Discard
                                </button>
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 rounded border border-transparent bg-accent text-white hover:brightness-110 active:scale-[.98] font-medium"
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
                                This will export your current preview and trigger a
                                deployment to your connected Vercel project.
                            </p>
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3">
                                Warning: these changes can reach your live site once the
                                deployment finishes.
                            </p>
                            <div className="flex justify-end gap-2 text-xs">
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-50 active:scale-[.98] disabled:opacity-60"
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
                                    className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs text-white shadow-sm hover:border-neutral-400 disabled:opacity-60"
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
                className={`${base} rounded-md px-3 py-1.5 border border-neutral-300 bg-white hover:bg-neutral-50`}
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
                : "border-neutral-300 bg-white hover:bg-neutral-50"
                }`}
        >
            {withBusy}
        </button>
    );
}

function injectEditableOverlay(
    doc: Document,
    onChange: (updatedHtml: string) => void
) {
    // Hard reset of any existing overlays in this doc
    doc.querySelectorAll(".kloner-toolbar").forEach((n) => n.remove());
    doc.querySelectorAll(".kloner-style-panel").forEach((n) => n.remove());

    const style = doc.createElement("style");
    style.setAttribute("data-kloner-style", "1");
    style.textContent = `
    :root { --amber-50:#FFFBEB; --amber-200:#FDE68A; --amber-700:#B45309; --rose-50:#FFF1F2; --rose-200:#FECDD3; --rose-700:#BE123C; --slate-700:#334155; --slate-300:#cbd5e1; }

    [data-kloner-sel]{ outline:2px dashed #10b981 !important; outline-offset:2px !important; }

    [data-kloner-textbox]{
      cursor:text;
    }

    .kloner-toolbar{
      position:fixed;
      z-index:2147483647;
      display:none;
      flex-wrap:wrap;
      align-items:center;
      gap:6px;
      padding:6px 8px;
      background:#020617;
      color:#e5e7eb;
      border-radius:999px;
      font:11px/1.2 system-ui,-apple-system,Segoe UI,Roboto;
      box-shadow:0 10px 30px rgba(0,0,0,.25);
      max-width:calc(100vw - 16px);
      border:1px solid rgba(148,163,184,0.45);
      backdrop-filter:blur(14px);
    }

    .kgroup{
      display:inline-flex;
      align-items:center;
      gap:4px;
      padding-right:8px;
      margin-right:4px;
      border-right:1px solid rgba(148,163,184,0.4);
    }
    .kgroup:last-child{
      border-right:none;
      margin-right:0;
      padding-right:0;
    }

    .kgroup-label{
      padding:2px 6px;
      border-radius:999px;
      font-size:10px;
      font-weight:600;
      text-transform:uppercase;
      letter-spacing:0.04em;
      background:rgba(15,23,42,0.95);
      color:rgba(148,163,184,1);
      border:1px solid rgba(51,65,85,1);
      margin-right:2px;
      white-space:nowrap;
    }

    .kbtn{
      display:inline-flex;
      align-items:center;
      gap:4px;
      padding:4px 6px;
      border-radius:7px;
      border:1px solid transparent;
      cursor:pointer;
      font-weight:600;
      font-size:11px;
      background:#111827;
      color:#e5e7eb;
      white-space:nowrap;
      line-height:1.15;
      transition:
        background-color 120ms ease-out,
        color 120ms ease-out,
        border-color 120ms ease-out,
        transform 80ms ease-out;
    }
    .kbtn:hover{
      transform:translateY(-0.5px);
    }
    .kbtn:active{
      transform:translateY(0.5px) scale(.98);
    }

    .kbtn-icon{
      font-size:15px;
      line-height:1;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-width:16px;
    }
    .kbtn-text{
      font-size:10px;
    }

    .kbtn-close{ background:#0f172a; color:#fff; border-color:#0f172a; }
    .kbtn-edit{ background:var(--amber-50); color:var(--amber-700); border-color:var(--amber-200); }
    .kbtn-del{  background:var(--rose-50);  color:var(--rose-700);  border-color:var(--rose-200); }
    .kbtn-img { background:#ecfeff; color:#155e75; border-color:#a5f3fc; }
    .kbtn-link { background:#eef2ff; color:#3730a3; border-color:#c7d2fe; }

    .khint {
      position:fixed;
      z-index:2147483646;
      padding:6px 8px;
      background:#111827;
      color:#fff;
      border-radius:8px;
      font:12px/1.2 system-ui;
      max-width:320px;
    }
  `;
    doc.head.appendChild(style);

    const fileInput = doc.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    fileInput.setAttribute("data-kloner-upload-input", "1");
    doc.body.appendChild(fileInput);

    const hint = doc.createElement("div");
    hint.className = "khint";
    hint.style.display = "none";
    hint.setAttribute("data-kloner-hint", "1");
    doc.body.appendChild(hint);

    function showHint(text: string, near: HTMLElement) {
        hint.textContent = text;
        const r = near.getBoundingClientRect();
        hint.style.left = `${Math.min(
            r.left,
            doc.defaultView!.innerWidth - 340
        )}px`;
        hint.style.top = `${r.bottom + 8}px`;
        hint.style.display = "block";
        setTimeout(() => (hint.style.display = "none"), 4000);
    }

    function cssBox(el: HTMLElement) {
        const cs = doc.defaultView!.getComputedStyle(el);
        return {
            w: el.getBoundingClientRect().width,
            h: el.getBoundingClientRect().height,
            fontSize: (cs as any).fontSize as string,
            textAlign: (cs as any).textAlign as string,
            fontFamily: (cs as any).fontFamily as string,
            color: (cs as any).color as string,
            backgroundColor: (cs as any).backgroundColor as string,
        };
    }

    const texty = new Set([
        "P",
        "SPAN",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "LI",
        "SMALL",
        "STRONG",
        "EM",
        "LABEL",
        "BUTTON",
        "A",
        "DIV",
    ]);
    function markEditable(root: ParentNode) {
        const w = doc.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT);
        while (w.nextNode()) {
            const el = w.currentNode as HTMLElement;
            if (texty.has(el.tagName)) el.contentEditable = "true";
        }
    }
    markEditable(doc.body);

    const toolbar = doc.createElement("div");
    toolbar.className = "kloner-toolbar";
    toolbar.setAttribute("data-kloner-toolbar", "1");
    toolbar.innerHTML = `
      <div class="kgroup kgroup-core" data-group="core">
        <span class="kgroup-label">Block</span>
        <button class="kbtn kbtn-close" data-act="close" title="Clear selection">
          <span class="kbtn-icon">✕</span>
          <span class="kbtn-text">Clear</span>
        </button>
        <button class="kbtn kbtn-edit" data-act="dup" title="Duplicate block">
          <span class="kbtn-icon">⧉</span>
          <span class="kbtn-text">Duplicate</span>
        </button>
        <button class="kbtn kbtn-edit" data-act="box-add" title="Add text box overlay">
          <span class="kbtn-icon">T+</span>
          <span class="kbtn-text">Text box</span>
        </button>
        <button class="kbtn kbtn-del"  data-act="del" title="Delete block">
          <span class="kbtn-icon">🗑</span>
          <span class="kbtn-text">Delete Block</span>
        </button>
      </div>

      <div class="kgroup kgroup-layout" data-group="layout">
        <span class="kgroup-label">Layout</span>
        <button class="kbtn kbtn-edit" data-act="pad-more" title="Increase inner padding">
          <span class="kbtn-icon">⬚+</span>
          <span class="kbtn-text">More pad</span>
        </button>
        <button class="kbtn kbtn-edit" data-act="pad-less" title="Decrease inner padding">
          <span class="kbtn-icon">⬚−</span>
          <span class="kbtn-text">Less pad</span>
        </button>
      </div>

      <div class="kgroup kgroup-img" data-group="img">
        <span class="kgroup-label">Image</span>
        <button class="kbtn kbtn-img"  data-act="img-insert" title="Insert image into this block">
          <span class="kbtn-icon">🖼+</span>
          <span class="kbtn-text">Insert</span>
        </button>
        <button class="kbtn kbtn-img"  data-act="img-bg" title="Set this block's background image">
          <span class="kbtn-icon">⬚</span>
          <span class="kbtn-text">Bg</span>
        </button>
        <button class="kbtn kbtn-img"  data-act="img-replace" title="Replace selected image">
          <span class="kbtn-icon">🖼⟳</span>
          <span class="kbtn-text">Replace</span>
        </button>
        <button class="kbtn kbtn-img"  data-act="img-del" title="Delete image">
          <span class="kbtn-icon">🗑</span>
          <span class="kbtn-text">Remove</span>
        </button>
        <button class="kbtn kbtn-img"  data-act="img-alt" title="Edit ALT text for accessibility">
          <span class="kbtn-icon">ALT</span>
          <span class="kbtn-text">Text</span>
        </button>
        <button class="kbtn kbtn-img"  data-act="img-front" title="Bring image forward">
          <span class="kbtn-icon">⬆</span>
          <span class="kbtn-text">Front</span>
        </button>
        <button class="kbtn kbtn-img"  data-act="img-back" title="Send image backward">
          <span class="kbtn-icon">⬇</span>
          <span class="kbtn-text">Back</span>
        </button>
        <button class="kbtn kbtn-img"  data-act="img-grow" title="Increase image size">
          <span class="kbtn-icon">＋</span>
          <span class="kbtn-text">Bigger</span>
        </button>
        <button class="kbtn kbtn-img"  data-act="img-shrink" title="Decrease image size">
          <span class="kbtn-icon">－</span>
          <span class="kbtn-text">Smaller</span>
        </button>
      </div>

      <div class="kgroup kgroup-link" data-group="link">
        <span class="kgroup-label">Link</span>
        <button class="kbtn kbtn-link"  data-act="link" title="Edit link URL">
          <span class="kbtn-icon">🔗</span>
          <span class="kbtn-text">URL</span>
        </button>
      </div>
    `;
    doc.body.appendChild(toolbar);

    let selected: HTMLElement | null = null;

    function serializeClean(): string {
        const docClone = doc.documentElement.cloneNode(true) as HTMLElement;
        const htmlEl = docClone as HTMLHtmlElement;
        const head = htmlEl.querySelector("head");
        const body = htmlEl.querySelector("body")!;

        // Remove overlay UI and helpers from body
        body
            .querySelectorAll(
                ".kloner-toolbar, .kloner-style-panel, .khint, [data-kloner-upload-input]"
            )
            .forEach((n) => n.remove());

        // Strip selection + edit attributes
        body.querySelectorAll("[data-kloner-sel]").forEach((n) =>
            (n as HTMLElement).removeAttribute("data-kloner-sel")
        );
        body.querySelectorAll("[contenteditable]").forEach((n) =>
            (n as HTMLElement).removeAttribute("contenteditable")
        );

        // Remove injected style block(s) for the editor from head
        if (head) {
            head.querySelectorAll("[data-kloner-style]").forEach((n) => n.remove());

            // Safety net: if any generic <style> contains .kloner-toolbar, remove it
            head.querySelectorAll("style").forEach((s) => {
                if (s.textContent && s.textContent.includes(".kloner-toolbar")) {
                    s.remove();
                }
            });
        }

        return "<!doctype html>\n" + (docClone as any).outerHTML;
    }

    let hist: string[] = [];
    let idx = -1;
    function updateUndoRedoState() {
        // reserved for future undo/redo UI
    }

    function saveHistory() {
        const snap = serializeClean();
        if (idx >= 0 && hist[idx] === snap) return;
        hist = hist.slice(0, idx + 1);
        hist.push(snap);
        idx = hist.length - 1;
        updateUndoRedoState();
    }
    function restoreHistory(nextIndex: number) {
        if (nextIndex < 0 || nextIndex >= hist.length) return;
        idx = nextIndex;
        const parser = new DOMParser();
        const doc2 = parser.parseFromString(hist[idx], "text/html");

        // Replace body with clean snapshot
        const newBody = doc2.body;
        doc.body.replaceWith(doc.importNode(newBody, true));

        // Re-attach toolbar + hint + file input to live doc
        doc.body.appendChild(toolbar);
        doc.body.appendChild(hint);
        doc.body.appendChild(fileInput);

        markEditable(doc.body);
        select(null);
        updateUndoRedoState();
        notify();
    }
    function undo() {
        restoreHistory(idx - 1);
    }
    function redo() {
        restoreHistory(idx + 1);
    }

    const notify = (() => {
        let t = 0 as unknown as number;
        let raf = 0 as unknown as number;
        return () => {
            clearTimeout(t as any);
            if (raf) cancelAnimationFrame(raf as any);
            t = window.setTimeout(() => {
                raf = requestAnimationFrame(() => {
                    saveHistory();
                    onChange(serializeClean());
                });
            }, 250);
        };
    })();

    saveHistory();

    function publishSelection() {
        const payload = selected
            ? {
                has: true,
                tagName: selected.tagName,
            }
            : { has: false };
        doc.defaultView?.parent?.postMessage(
            { type: "kloner:selection", meta: payload },
            "*"
        );
    }

    function placeToolbar(target: HTMLElement) {
        const r = target.getBoundingClientRect();
        toolbar.style.display = "flex";
        toolbar.style.visibility = "hidden";
        toolbar.style.left = "0px";
        toolbar.style.top = "0px";

        const tbRect = toolbar.getBoundingClientRect();
        const vw = doc.defaultView!.innerWidth;
        const vh = doc.defaultView!.innerHeight;

        let x = Math.min(Math.max(8, r.left), vw - tbRect.width - 8);
        if (x < 8) x = 8;

        const spaceAbove = r.top;
        const spaceBelow = vh - r.bottom;
        let y: number;

        if (spaceAbove >= tbRect.height + 8) {
            y = r.top - tbRect.height - 8;
        } else if (spaceBelow >= tbRect.height + 8) {
            y = r.bottom + 8;
        } else {
            y = Math.max(8, r.bottom + 8);
            if (y + tbRect.height > vh) y = vh - tbRect.height - 8;
        }

        toolbar.style.left = `${x}px`;
        toolbar.style.top = `${y}px`;
        toolbar.style.visibility = "visible";
    }

    function select(el: HTMLElement | null) {
        if (selected) selected.removeAttribute("data-kloner-sel");
        selected = el;
        if (selected) {
            selected.setAttribute("data-kloner-sel", "1");
            placeToolbar(selected);
        } else {
            toolbar.style.display = "none";
        }
        publishSelection();
    }

    function applyStyleCommand(cmd: any) {
        if (!selected || !cmd || typeof cmd.kind !== "string") return;

        if (cmd.kind === "fontFamily" && typeof cmd.value === "string") {
            selected.style.fontFamily = cmd.value;
        } else if (cmd.kind === "fontSizePx" && typeof cmd.value === "number") {
            selected.style.fontSize = `${cmd.value}px`;
        } else if (cmd.kind === "align") {
            if (
                cmd.value === "left" ||
                cmd.value === "center" ||
                cmd.value === "right"
            ) {
                selected.style.textAlign = cmd.value;
            }
        } else if (cmd.kind === "textColor" && typeof cmd.value === "string") {
            selected.style.color = cmd.value;
        } else if (cmd.kind === "bgColor" && typeof cmd.value === "string") {
            selected.style.backgroundColor = cmd.value;
        } else if (cmd.kind === "transform") {
            if (cmd.value === "uppercase") {
                selected.style.textTransform = "uppercase";
            } else if (cmd.value === "none") {
                selected.style.textTransform = "none";
            }
        } else if (cmd.kind === "weight") {
            if (
                typeof cmd.value === "string" ||
                typeof cmd.value === "number"
            ) {
                (selected.style as any).fontWeight = String(cmd.value);
            }
        } else if (cmd.kind === "letterSpacing" && typeof cmd.value === "string") {
            (selected.style as any).letterSpacing = cmd.value;
        } else {
            return;
        }

        saveHistory();
        notify();
        publishSelection();
    }

    const api: any = (doc.defaultView as any).__klonerApi || {};
    api.clear = () => {
        select(null);
        (doc.activeElement as HTMLElement | null)?.blur?.();
    };
    api.style = (cmd: any) => applyStyleCommand(cmd);
    (doc.defaultView as any).__klonerApi = api;

    doc.addEventListener(
        "click",
        (e) => {
            const t = e.target as HTMLElement;
            if (toolbar.contains(t)) return;
            const block = t.closest(
                "section, article, header, footer, main, button, a, div, li, p, h1, h2, h3, h4, h5"
            ) as HTMLElement | null;
            if (block) select(block);
            else select(null);
        },
        true
    );

    async function requestParentUpload(
        file: File
    ): Promise<{ url: string; path?: string }> {
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const buf = await file.arrayBuffer();
        return new Promise((resolve, reject) => {
            const onMsg = (ev: MessageEvent) => {
                const d = ev.data || {};
                if (d?.type !== "kloner:upload:done" || d?.id !== id) return;
                doc.defaultView?.removeEventListener("message", onMsg as any);
                if (d.ok) {
                    resolve({
                        url: d.url as string,
                        path:
                            typeof d.path === "string"
                                ? (d.path as string)
                                : undefined,
                    });
                } else {
                    reject(
                        new Error(String(d.error || "upload_failed"))
                    );
                }
            };
            doc.defaultView?.addEventListener("message", onMsg as any);
            doc.defaultView?.parent?.postMessage(
                {
                    type: "kloner:upload",
                    id,
                    filename: file.name,
                    contentType: file.type,
                    buffer: buf,
                },
                "*"
            );
        });
    }

    async function pickFileAndUpload(
        anchor: HTMLElement
    ): Promise<{ url: string; path?: string; file: File }> {
        return new Promise((resolve, reject) => {
            fileInput.onchange = async () => {
                const f = (fileInput.files && fileInput.files[0]) || null;
                fileInput.value = "";
                if (!f) return reject(new Error("no_file"));
                if (f.size > 8 * 1024 * 1024) {
                    showHint("Image too large (8MB max).", anchor);
                    return reject(new Error("too_large"));
                }
                if (!/^image\//.test(f.type)) {
                    showHint("Unsupported type.", anchor);
                    return reject(new Error("bad_type"));
                }
                try {
                    const { url, path } = await requestParentUpload(f);
                    resolve({ url, path, file: f });
                } catch (e) {
                    showHint("Upload failed.", anchor);
                    reject(e as any);
                }
            };
            fileInput.click();
        });
    }

    function deleteAssetsForElement(root: HTMLElement) {
        const paths = new Set<string>();

        if (root.tagName === "IMG") {
            const p = (root as HTMLImageElement).getAttribute("data-kloner-path");
            if (p) paths.add(p);
        }

        if (root.hasAttribute("data-kloner-bg-path")) {
            const p = root.getAttribute("data-kloner-bg-path");
            if (p) paths.add(p);
        }

        root.querySelectorAll("img[data-kloner-path]").forEach((img) => {
            const p = img.getAttribute("data-kloner-path");
            if (p) paths.add(p);
        });

        root.querySelectorAll<HTMLElement>("[data-kloner-bg-path]").forEach((el) => {
            const p = el.getAttribute("data-kloner-bg-path");
            if (p) paths.add(p);
        });

        if (paths.size > 0) {
            doc.defaultView?.parent?.postMessage(
                {
                    type: "kloner:delete-assets",
                    paths: Array.from(paths),
                },
                "*"
            );
        }
    }

    const pendingImagePaths: Set<string> = new Set();

    function deleteAssetsByPaths(paths: string[]) {
        if (!paths.length) return;

        for (const p of paths) {
            pendingImagePaths.delete(p);
        }

        doc.defaultView?.parent?.postMessage(
            {
                type: "kloner:delete-assets",
                paths,
            },
            "*"
        );
    }

    function deleteImageOnBlock(block: HTMLElement) {
        const img =
            (block.tagName === "IMG"
                ? (block as HTMLImageElement)
                : (block.querySelector("img") as HTMLImageElement | null)) ?? null;

        if (!img) {
            showHint("Select a block with an <img> to delete.", block);
            return;
        }

        const path = img.getAttribute("data-kloner-path");
        if (path) {
            try {
                deleteAssetsByPaths([path]);
            } catch (err) {
                console.warn(
                    "[deleteImageOnBlock] deleteAssetsByPaths threw synchronously",
                    { path },
                    err
                );
            }
        }

        if (img.hasAttribute("data-kloner-old-path")) {
            img.removeAttribute("data-kloner-old-path");
        }

        if (img.dataset.localImageId) {
            const tempUrl = img.src;
            try {
                URL.revokeObjectURL(tempUrl);
            } catch {
                // ignore
            }
            img.removeAttribute("data-local-image-id");
            img.removeAttribute("data-local-filename");
        }

        img.remove();
        saveHistory();
        notify();
        showHint("Image deleted.", block);
    }

    function pickLocalFile(): Promise<File | null> {
        return new Promise((resolve) => {
            const input = doc.createElement("input");
            input.type = "file";
            input.accept = "image/*";

            input.onchange = () => {
                const file = input.files?.[0] || null;
                resolve(file);
            };

            input.click();
        });
    }

    async function insertImageIntoBlock(block: HTMLElement) {
        const file = await pickLocalFile();
        if (!file) return;

        const tempUrl = URL.createObjectURL(file);
        const img = doc.createElement("img");
        const localId = crypto.randomUUID();

        img.src = tempUrl;
        img.alt = "";
        img.style.display = "block";

        img.style.maxWidth = "100%";
        img.style.height = "auto";
        img.removeAttribute("height");

        img.dataset.localImageId = localId;
        img.dataset.localFilename = file.name || "image";

        const box = cssBox(block);
        if (box.w > 4) {
            img.style.width = `${Math.round(box.w)}px`;
            img.setAttribute("width", String(Math.round(box.w)));
        }

        if (block.firstChild) block.insertBefore(img, block.firstChild);
        else block.appendChild(img);

        saveHistory();
        notify();
        showHint("Image inserted (pending upload).", block);
    }

    async function replaceImage(el: HTMLImageElement) {
        const file = await pickLocalFile();
        if (!file) return;

        const box = cssBox(el);
        const oldPath = el.getAttribute("data-kloner-path") || undefined;

        const tempUrl = URL.createObjectURL(file);
        const localId = crypto.randomUUID();

        el.src = tempUrl;
        el.dataset.localImageId = localId;
        el.dataset.localFilename = file.name || "image";

        if (oldPath) {
            el.setAttribute("data-kloner-old-path", oldPath);
            el.removeAttribute("data-kloner-path");
        }

        if (!el.style.width && !el.getAttribute("width") && box.w > 4) {
            el.style.width = `${Math.round(box.w)}px`;
            el.setAttribute("width", String(Math.round(box.w)));
        }

        el.style.maxWidth = "100%";
        el.style.height = "auto";
        el.removeAttribute("height");

        saveHistory();
        notify();
        showHint("Image replaced (pending upload).", el);
    }

    async function setBlockBackgroundImage(block: HTMLElement) {
        const file = await pickLocalFile();
        if (!file) return;

        const tempUrl = URL.createObjectURL(file);

        const oldPath = block.getAttribute("data-kloner-bg-path") || undefined;
        if (oldPath) {
            block.setAttribute("data-kloner-bg-old-path", oldPath);
            block.removeAttribute("data-kloner-bg-path");
        }

        const cs = doc.defaultView!.getComputedStyle(block);
        if (cs.position === "static") {
            block.style.position = "relative";
        }

        block.style.backgroundImage = `url("${tempUrl}")`;
        block.style.backgroundSize = "cover";
        block.style.backgroundPosition = "center center";
        block.style.backgroundRepeat = "no-repeat";

        const localId =
            typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : String(Date.now());

        // use the same dataset keys as insertImageIntoBlock
        (block.dataset as any).localImageId = localId;
        (block.dataset as any).localFilename = file.name || "background";

        saveHistory();
        notify();
        showHint("Background image set (pending upload).", block);
    }


    function adjustBlockPadding(block: HTMLElement, deltaPx: number) {
        const cs = doc.defaultView!.getComputedStyle(block);
        const current = parseFloat(cs.paddingTop || "0") || 0;
        let next = current + deltaPx;

        if (next < 0) next = 0;
        if (next > 160) next = 160; // hard cap so users don't blow up layout

        const rounded = Math.round(next);
        block.style.padding = `${rounded}px`;

        saveHistory();
        notify();
        showHint(`Padding set to ${rounded}px.`, block);
    }

    function editLink(target: HTMLElement) {
        let linkEl: HTMLAnchorElement | null = null;
        if (target.tagName === "A") {
            linkEl = target as HTMLAnchorElement;
        } else {
            linkEl = target.closest("a") as HTMLAnchorElement | null;
        }
        if (!linkEl) {
            showHint("No link found here.", target);
            return;
        }
        const current = linkEl.getAttribute("href") || "";
        const next = prompt("Link URL (href):", current);
        if (next === null) return;
        if (next.trim() === "") {
            linkEl.removeAttribute("href");
            showHint("Link cleared.", linkEl);
        } else {
            linkEl.setAttribute("href", next.trim());
            showHint("Link updated.", linkEl);
        }
        saveHistory();
        notify();
    }

    function getImageFromSelection(sel: HTMLElement | null): HTMLImageElement | null {
        if (!sel) return null;
        if (sel.tagName === "IMG") return sel as HTMLImageElement;
        return (sel.querySelector("img") as HTMLImageElement | null) ?? null;
    }

    function moveImageLayer(img: HTMLImageElement, direction: "forward" | "backward") {
        const parent = img.parentElement;
        if (!parent) return;

        const siblings = Array.from(parent.children) as HTMLElement[];
        const index = siblings.indexOf(img);
        if (index === -1) return;

        if (direction === "forward") {
            if (index === siblings.length - 1) return;
            const next = siblings[index + 1];
            next.after(img);
        } else {
            if (index === 0) return;
            const prev = siblings[index - 1];
            parent.insertBefore(img, prev);
        }
    }

    function resizeImage(target: HTMLElement, factor: number) {
        const img =
            (target.tagName === "IMG"
                ? (target as HTMLImageElement)
                : (target.querySelector("img") as HTMLImageElement | null)) ?? null;

        if (!img) {
            showHint("Select a block with an <img> to resize.", target);
            return;
        }

        const naturalW =
            Number(img.dataset.klonerBaseWidth) ||
            img.naturalWidth ||
            parseInt(img.getAttribute("width") || "0", 10) ||
            0;
        const naturalH =
            Number(img.dataset.klonerBaseHeight) ||
            img.naturalHeight ||
            parseInt(img.getAttribute("height") || "0", 10) ||
            0;

        if (!naturalW || !naturalH) {
            showHint("Can't determine image size.", img);
            return;
        }

        if (!img.dataset.klonerBaseWidth) {
            img.dataset.klonerBaseWidth = String(naturalW);
            img.dataset.klonerBaseHeight = String(naturalH);
        }

        const currentW =
            parseInt(
                (img.style.width && img.style.width.endsWith("px")
                    ? img.style.width.slice(0, -2)
                    : img.getAttribute("width") || "") || "0",
                10
            ) || naturalW;

        let nextW = Math.round(currentW * factor);
        const minW = Math.max(80, Math.round(naturalW * 0.25));
        const maxW = Math.round(naturalW * 2.5);

        if (nextW < minW) nextW = minW;
        if (nextW > maxW) nextW = maxW;

        img.style.width = `${nextW}px`;
        img.setAttribute("width", String(nextW));
        img.style.maxWidth = "100%";
        img.style.height = "auto";
        img.removeAttribute("height");

        saveHistory();
        notify();
        showHint("Image resized.", img);
    }

    function createTextBox(anchor: HTMLElement) {
        let container: HTMLElement = anchor;
        if (anchor.tagName === "IMG" && anchor.parentElement) {
            container = anchor.parentElement as HTMLElement;
        }

        const cs = doc.defaultView!.getComputedStyle(container);
        if (cs.position === "static") {
            container.style.position = "relative";
        }

        const box = doc.createElement("div");
        box.setAttribute("data-kloner-textbox", "1");
        box.contentEditable = "true";
        box.textContent = "Edit text";

        box.style.position = "absolute";
        box.style.left = "50%";
        box.style.top = "50%";
        box.style.transform = "translate(-50%, -50%)";

        box.style.minWidth = "140px";
        box.style.minHeight = "40px";
        box.style.padding = "10px 12px";
        box.style.borderRadius = "8px";
        box.style.background = "rgba(15,23,42,0.78)";
        box.style.color = "#f9fafb";
        box.style.fontSize = "16px";
        box.style.lineHeight = "1.4";
        box.style.boxShadow = "0 12px 25px rgba(15,23,42,0.35)";
        box.style.resize = "both";
        box.style.overflow = "auto";
        box.style.zIndex = "20";

        container.appendChild(box);
        markEditable(box);

        select(box);
        saveHistory();
        notify();
        showHint("Text box added. Click to edit, drag corner to resize.", box);
    }

    function handleAction(act: string | null, sourceEl: HTMLElement) {
        if (!act) return;

        if (act === "close") {
            (doc.defaultView as any).__klonerApi?.clear();
            return;
        }
        if (!selected && act !== "img-insert" && act !== "img-bg") return;

        if (act === "del") {
            if (!selected) return;
            deleteAssetsForElement(selected);

            const parent = selected.parentElement;
            selected.remove();
            select(null);
            parent?.focus?.();
            saveHistory();
            notify();
            return;
        }

        if (act === "dup") {
            if (!selected) return;
            const clone = selected.cloneNode(true) as HTMLElement;
            selected.insertAdjacentElement("afterend", clone);
            markEditable(clone);
            select(clone);
            saveHistory();
            notify();
            return;
        }

        if (act === "box-add") {
            if (!selected) return;
            createTextBox(selected);
            return;
        }

        if (act === "pad-more") {
            if (!selected) return;
            adjustBlockPadding(selected, 8);
            return;
        }

        if (act === "pad-less") {
            if (!selected) return;
            adjustBlockPadding(selected, -8);
            return;
        }

        if (act === "img-insert") {
            if (!selected) return;
            insertImageIntoBlock(selected).catch(() => { });
            return;
        }

        if (act === "img-bg") {
            if (!selected) return;
            setBlockBackgroundImage(selected).catch(() => { });
            return;
        }

        if (act === "img-replace") {
            const img = getImageFromSelection(selected);
            if (!img) {
                showHint("No <img> here. Use Insert image.", selected!);
                return;
            }
            replaceImage(img);
            return;
        }

        if (act === "img-del") {
            if (!selected) return;
            deleteImageOnBlock(selected);
            return;
        }

        if (act === "img-alt") {
            const img = getImageFromSelection(selected);
            if (!img) {
                showHint("Select a block with an <img>.", selected!);
                return;
            }
            const next = prompt("Alt text:", img.getAttribute("alt") || "");
            if (next !== null) {
                img.setAttribute("alt", next);
                saveHistory();
                notify();
                showHint("ALT updated.", img);
            }
            return;
        }

        if (act === "img-front") {
            const img = getImageFromSelection(selected);
            if (!img) {
                showHint("Select a block with an <img> to bring forward.", selected!);
                return;
            }
            moveImageLayer(img, "forward");
            saveHistory();
            notify();
            return;
        }

        if (act === "img-back") {
            const img = getImageFromSelection(selected);
            if (!img) {
                showHint("Select a block with an <img> to send backward.", selected!);
                return;
            }
            moveImageLayer(img, "backward");
            saveHistory();
            notify();
            return;
        }

        if (act === "img-grow") {
            if (!selected) return;
            const img = getImageFromSelection(selected);
            if (!img) {
                showHint("Select a block with an <img> to resize.", selected);
                return;
            }
            resizeImage(selected, 1.1);
            return;
        }

        if (act === "img-shrink") {
            if (!selected) return;
            const img = getImageFromSelection(selected);
            if (!img) {
                showHint("Select a block with an <img> to resize.", selected);
                return;
            }
            resizeImage(selected, 0.9);
            return;
        }

        if (act === "link") {
            if (!selected) return;
            editLink(selected);
            return;
        }
    }

    const actionListener = (e: Event) => {
        const target = e.target as HTMLElement;
        const btn = target.closest("[data-act]") as HTMLElement | null;
        if (!btn) return;
        const act = btn.getAttribute("data-act");
        e.preventDefault();
        e.stopPropagation();
        handleAction(act, btn);
    };

    toolbar.addEventListener("click", actionListener);

    const mo = new MutationObserver(() => notify());
    mo.observe(doc.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
    });
    doc.addEventListener("input", notify, true);

    doc.addEventListener("keydown", (e) => {
        const key = e.key.toLowerCase();
        const mod = e.metaKey || e.ctrlKey;
        if (mod && key === "z") {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
            return;
        }
        if (e.key === "Escape")
            (doc.defaultView as any).__klonerApi?.clear();
        if ((key === "backspace" || key === "delete") && selected) {
            const active = doc.activeElement as HTMLElement | null;
            if (
                !active?.isContentEditable &&
                active?.tagName !== "INPUT" &&
                active?.tagName !== "TEXTAREA"
            ) {
                e.preventDefault();
                const parent = selected.parentElement;
                selected.remove();
                (doc.defaultView as any).__klonerApi?.clear();
                parent?.focus?.();
                saveHistory();
                notify();
            }
        }
    });

    updateUndoRedoState();
    publishSelection();
}
