// src/components/PreviewEditor.tsx
"use client";

import { ensureSessionAndCsrf } from "@/app/login/LoginForm";
import { useEffect, useMemo, useRef, useState, useCallback, ChangeEvent } from "react";
import Image from "next/image";

type Device = "desktop" | "tablet" | "mobile";
type ViewMode = "code" | "preview" | "screenshot";

type EditorPage = {
    id: string; // should match data-route when possible
    label: string;
    html: string;
    screenshotUrl?: string;
};

export type SeoMeta = {
    title: string;
    description: string;
    ogImageUrl: string;
    faviconUrl: string;
};

type Props = {
    initialHtml: string;
    sourceImage?: string;
    onClose: () => Promise<void> | void;
    onExport: (html: string, name?: string) => Promise<void>;
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

const FONT_SIZE_PRESETS = [
    { id: "xs", label: "XS", px: 12 },
    { id: "sm", label: "S", px: 14 },
    { id: "md", label: "M", px: 16 },
    { id: "lg", label: "L", px: 20 },
    { id: "xl", label: "XL", px: 28 },
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

// 3) single entry point you call before saving/exporting HTML
export function sanitizeExportHtml(html: string): string {
    if (!html) return html;
    let out = html;

    // order matters: first remove scripts, then strip editor artifacts
    out = stripScripts(out);
    out = stripEditorArtifacts(out);

    return out;
}


function injectClientRouter(html: string): string {
    if (!html) return html;

    // clean up editor junk and any previous route CSS before injecting the SPA router
    let out = stripEditorArtifacts(html);

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

  function setActiveRoute(path) {
    path = normalizePath(path);
    var pages = document.querySelectorAll("main.page-root");
    var found = false;

    pages.forEach(function (el) {
      var route = normalizePath(el.getAttribute("data-route") || "/");
      if (route === path) {
        el.classList.add("is-active");
        found = true;
      } else {
        el.classList.remove("is-active");
      }
    });

    if (!found) {
      pages.forEach(function (el) {
        var route = normalizePath(el.getAttribute("data-route") || "/");
        el.classList.toggle("is-active", route === "/");
      });
    }
  }

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

    // Insert CSS into <head>
    if (out.includes("</head>")) {
        out = out.replace("</head>", routerCss + "\n</head>");
    } else if (out.includes("<head>")) {
        out = out.replace("<head>", "<head>\n" + routerCss + "\n");
    } else {
        out = routerCss + "\n" + out;
    }

    // Insert script before </body>
    if (out.includes("</body>")) {
        out = out.replace("</body>", routerScript + "\n</body>");
    } else {
        out = out + "\n" + routerScript;
    }

    return out;
}

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
    const [selectionMeta, setSelectionMeta] = useState<SelectionMeta>({ has: false });
    const [htmlDraft, setHtmlDraft] = useState<string>("");
    const [previewHtml, setPreviewHtml] = useState<string>("");
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [iframeKey, setIframeKey] = useState<number>(0);
    const [derivedPages, setDerivedPages] = useState<EditorPage[]>([]);
    const [activePageId, setActivePageId] = useState<string>("");
    const [activeSeoMetaByPage, setActiveSeoMetaByPage] =
        useState<SeoMetaByPage | null>(null);

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


    const devicePx =
        device === "desktop" ? 1440 : device === "tablet" ? 768 : 390;


    const emptyMeta: SeoMeta = {
        title: "",
        description: "",
        ogImageUrl: "",
        faviconUrl: "",
    };


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

    const setCurrentSeoMeta = useCallback(
        (updater: SeoMeta | ((prev: SeoMeta) => SeoMeta)) => {
            setSeoMetaByPage((prev) => {
                const prevMap: SeoMetaByPage = prev || {};
                const prevForPage = prevMap[currentPageKey] ?? emptyMeta;

                const nextForPage =
                    typeof updater === "function"
                        ? (updater as (p: SeoMeta) => SeoMeta)(prevForPage)
                        : updater;

                const faviconUrl = nextForPage.faviconUrl;

                // Start with this page’s updated meta (title/desc per-page)
                let nextMap: SeoMetaByPage = {
                    ...prevMap,
                    [currentPageKey]: nextForPage,
                };

                // If favicon is set here, propagate it to all pages so it’s global.
                if (faviconUrl && faviconUrl.trim() !== "") {
                    nextMap = Object.fromEntries(
                        Object.entries(nextMap).map(([key, val]) => [
                            key,
                            key === currentPageKey
                                ? val
                                : { ...val, faviconUrl },
                        ]),
                    );
                }

                return nextMap;
            });
        },
        [currentPageKey],
    );


    const theme = useMemo(
        () => deriveThemeFromInitialHtml(initialHtml),
        [initialHtml],
    );

    function MetaSettings({
        draftId,
        meta,
        uploadFileToUserBlob,
        onSaveMeta,
    }: {
        draftId?: string;
        meta: SeoMeta;
        uploadFileToUserBlob: (file: File, draftId: string) => Promise<UploadedAsset>;
        onSaveMeta?: (meta: SeoMeta) => Promise<void> | void;
    }) {
        const [uploading, setUploading] = useState(false);

        // local UX state
        const [saving, setSaving] = useState(false);
        const [justSaved, setJustSaved] = useState(false);

        // local form copy so typing doesn’t fight parent state
        const [draftMeta, setDraftMeta] = useState<SeoMeta>(meta);

        // when page / meta changes, re-seed the form
        useEffect(() => {
            setDraftMeta(meta);
        }, [meta]);

        const handleMetaChange = (key: keyof SeoMeta, value: string) => {
            setDraftMeta((prev) => ({ ...prev, [key]: value }));
        };

        const handleMetaSaveClick = async () => {
            if (!onSaveMeta) {
                console.warn("[MetaSettings] onSaveMeta is undefined – no persistence wired");
                return;
            }

            setSaving(true);
            setJustSaved(false);
            try {
                await onSaveMeta(draftMeta);
                setJustSaved(true);
                setTimeout(() => setJustSaved(false), 1500);
            } catch (err) {
                console.error("Failed to save SEO meta", err);
                alert("Failed to save metadata. See console for details.");
            } finally {
                setSaving(false);
            }
        };

        const uploadFavicon = async (e: ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // Clear input for next upload
            if (!file || !draftId) return;
            if (!file.type.startsWith("image/")) {
                alert("Please upload a valid image file for the favicon.");
                return;
            }

            setUploading(true);
            try {
                const { url } = await uploadFileToUserBlob(file, draftId);
                setDraftMeta((prev) => ({ ...prev, faviconUrl: url }));
                alert("Favicon uploaded successfully!");
            } catch (error) {
                console.error("Favicon upload failed:", error);
                alert("Favicon upload failed. See console for details.");
            } finally {
                setUploading(false);
            }
        };

        return (
            <div className="space-y-4">
                <h3 className="text-lg font-bold">SEO & Site Metadata 📊</h3>

                <UiBtn
                    variant="outline"
                    onClick={() => doSave()}
                    disabled={closing || savingDraft}
                    ariaBusy={savingDraft}
                >
                    {savingDraft ? "💾 Saving…" : "💾 Save draft"}
                </UiBtn>
                <UiBtn
                    variant="filled"
                    onClick={() => setExportPrompt(true)}
                    disabled={closing || exporting}
                    ariaBusy={exporting}
                >
                    {exporting ? "🚀 Exporting…" : "🚀 Export to Vercel"}
                </UiBtn>
                <UiBtn
                    variant="outline-quiet"
                    onClick={() => {
                        if (dirty) setClosePrompt(true);
                        else performClose("discard");
                    }}
                    disabled={closing}
                    ariaBusy={closing}
                >
                    ❌ Close
                </UiBtn>

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
                        value={draftMeta.title}
                        onChange={(e) => handleMetaChange("title", e.target.value)}
                        placeholder="E.g. My Amazing Website"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm p-2 border"
                        maxLength={60}
                        autoComplete="off"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        Used in browser tabs and search results. (Max 60 characters)
                    </p>
                </div>

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
                        value={draftMeta.description}
                        onChange={(e) => handleMetaChange("description", e.target.value)}
                        placeholder="A short, catchy summary of this page..."
                        rows={2}
                        className="mt-1 min-h-[100px] block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm p-2 border"
                        maxLength={160}
                        autoComplete="off"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        Used for search snippet. (Max 160 characters)
                    </p>
                </div>

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
                        value={draftMeta.ogImageUrl}
                        onChange={(e) =>
                            handleMetaChange("ogImageUrl", e.target.value)
                        }
                        placeholder="https://example.com/share.png"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm p-2 border"
                        autoComplete="off"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        URL for the image displayed when sharing on platforms like Twitter/Facebook.
                    </p>
                </div>

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
                            className={`cursor-pointer inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md shadow-sm text-white ${uploading
                                ? "bg-gray-400"
                                : "bg-orange-600 hover:bg-orange-700"
                                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500`}
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


                <div className="pt-2">
                    <button
                        type="button"
                        onClick={handleMetaSaveClick}
                        disabled={saving}
                        className={`inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition ${saving
                            ? "bg-emerald-50 text-emerald-700 cursor-not-allowed"
                            : justSaved
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-300"
                                : "bg-emerald-600 text-white hover:brightness-95"
                            }`}
                    >
                        {saving
                            ? "Saving..."
                            : justSaved
                                ? "Saved Changes!"
                                : "Save Changes"}
                    </button>
                </div>
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
        setApplyingPreview(true);
        const nextHtml = snapshotFromIframeOrDraft();
        setHtmlDraft(nextHtml);
        setPreviewHtml(nextHtml);
        emitLive(nextHtml);
        setDirty(false);
        window.setTimeout(() => setApplyingPreview(false), 450);
    }

    async function doSave(options?: { applyToPreview?: boolean }) {
        if (savingDraft) return;
        setSavingDraft(true);
        try {
            const nextHtml = snapshotFromIframeOrDraft();
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

    async function doExport() {
        if (exporting) return;
        setExportNote("");
        setExporting(true);
        try {
            if (dirty) {
                await doSave({ applyToPreview: true });
            }

            const baseHtmlRaw = snapshotFromIframeOrDraft();
            const baseHtml = (baseHtmlRaw || previewHtml || "").trim();

            const hasMultiPage =
                baseHtml.includes('class="page-root"') &&
                baseHtml.includes("data-route=");

            const finalHtml = hasMultiPage
                ? injectClientRouter(baseHtml)
                : stripEditorArtifacts(baseHtml);

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

    function sanitizeName(name: string) {
        const base = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
        return base.slice(-64) || "image";
    }

    async function uploadFileToUserBlob(
        file: File,
        draftId: string
    ): Promise<UploadedAsset> {

        console.log("renderId for upload:", draftId);

        const csrf = await ensureSessionAndCsrf();
        const safeName = sanitizeName(file.name || "upload.bin");

        const res = await fetch(
            `/api/user-blob/upload-url?filename=${encodeURIComponent(
                safeName
            )}&renderId=${encodeURIComponent(draftId)}`,
            {
                method: "POST",
                headers: {
                    "content-type": file.type || "application/octet-stream",
                    ...(csrf ? { "x-csrf": csrf } : {}),
                },
                credentials: "include",
                body: file,
            }
        );

        const j = await res.json().catch(() => ({} as any));

        if (!res.ok || !j?.url || !j?.path) {
            throw new Error(j?.error || "storage_upload_failed");
        }

        return {
            url: j.url as string,
            path: j.path as string,
        };
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
                    setClosePrompt(false);
                    await doSave();
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

    return (
        <div
            ref={containerRef}
            tabIndex={-1}
            className="fixed inset-0 z-[9999] bg-black/50"
        >
            <div className="absolute inset-4 overflow-auto">
                <div
                    className="bg-white rounded-xl shadow-xl grid grid-cols-[minmax(320px,360px),1fr] gap-4 p-4 max-lg:grid-cols-1"
                    style={{
                        transform: `scale(${uiScale})`,
                        transformOrigin: "top left",
                        width: `${100 / uiScale}%`,
                        height: `${100 / uiScale}%`,
                    }}
                >
                    <aside className="flex flex-col min-w-0 overflow-auto pr-1 max-lg:order-2">

                        {/* NEW: Style/Meta Toggle */}
                        <div className="inline-flex rounded-md shadow-sm mb-4">
                            <button
                                onClick={() => setSidePanelMode("style")}
                                className={`px-3 py-1 text-sm font-medium rounded-l-md transition-colors ${sidePanelMode === "style"
                                    ? "bg-accent text-white"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                            >
                                ✨ Styles
                            </button>
                            <button
                                onClick={() => setSidePanelMode("meta")}
                                className={`px-3 py-1 text-sm font-medium rounded-r-md transition-colors ${sidePanelMode === "meta"
                                    ? "bg-accent text-white"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                            >
                                📝 Meta
                            </button>

                            {/* <button
                                type="button"
                                onClick={() =>
                                    setControlsCollapsed((v) => !v)
                                }
                                disabled={closing}
                                className={`ml-2 px-3 py-1 text-sm font-medium rounded-md transition-colors ${controlsCollapsed
                                    ? "bg-accent text-white"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                            >
                                {controlsCollapsed ? "Show Controls" : "Collapse Controls"}
                            </button> */}
                        </div>

                        {/* Compact header + toggle – always visible */}
                        <div className="sticky top-0 z-10 flex items-center justify-between bg-white/95 pb-2 backdrop-blur-sm">

                            {/* Compact header + toggle – always visible */}
                            <div className="flex items-center justify-between w-full">
                                {/* <div className="flex items-center gap-2">
                                    <div className="relative h-[30px] w-[30px]">
                                        <Image
                                            src={logo}
                                            alt="kloner logo"
                                            fill
                                            priority
                                            className="object-contain"
                                        />
                                    </div>
                                    <span className="text-[10px] font-medium text-neutral-500 lg:hidden">
                                        Editor control
                                    </span>
                                </div> */}

                                {sidePanelMode === "meta" && (
                                    <MetaSettings
                                        key={currentPageKey}
                                        draftId={draftId}
                                        meta={currentSeoMeta}
                                        uploadFileToUserBlob={uploadFileToUserBlob}
                                        onSaveMeta={async (meta) => {
                                            setSeoMetaByPage((prev) => {
                                                const prevMap: SeoMetaByPage = prev || {};
                                                const faviconUrl = meta.faviconUrl?.trim() || "";

                                                let next: SeoMetaByPage = {
                                                    ...prevMap,
                                                    [currentPageKey]: meta,
                                                };

                                                // favicon is global: propagate across pages if set
                                                if (faviconUrl) {
                                                    next = Object.fromEntries(
                                                        Object.entries(next).map(([key, val]) => [
                                                            key,
                                                            key === currentPageKey ? val : { ...val, faviconUrl },
                                                        ]),
                                                    );
                                                }

                                                if (onSaveMeta) {
                                                    void onSaveMeta(
                                                        currentPageKey === SINGLE_PAGE_KEY ? null : currentPageKey,
                                                        meta,
                                                        next,
                                                    );
                                                }

                                                return next;
                                            });
                                        }}
                                    />
                                )}

                            </div>

                            <div className="flex items-center gap-2">
                                {/* <div className="relative h-[30px] w-[30px]">
                                    <Image
                                        src={logo}
                                        alt="kloner logo"
                                        fill
                                        priority
                                        className="object-contain"
                                    />
                                </div> */}
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
                                            className={`px-3 py-1 text-sm font-medium rounded-l-md transition-colors ${mode === "preview"
                                                ? "bg-accent text-white"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                        >
                                            ✍️ Preview
                                        </button>
                                        <button
                                            onClick={() =>
                                                handleModeClick("screenshot")
                                            }
                                            disabled={closing}
                                            className={`px-3 py-1 text-sm font-medium rounded-r-md transition-colors ${mode === "screenshot"
                                                ? "bg-accent text-white"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                        >
                                            👁️ Screenshot
                                        </button>

                                        {/* <UiBtn
                                            pressed={mode === "preview"}
                                            onClick={() =>
                                                handleModeClick("preview")
                                            }
                                            disabled={closing}
                                        >
                                            Editable preview
                                        </UiBtn>
                                        <UiBtn
                                            pressed={mode === "screenshot"}
                                            onClick={() =>
                                                handleModeClick("screenshot")
                                            }
                                            disabled={closing}
                                        >
                                            Screenshot
                                        </UiBtn> */}
                                    </div>
                                </div>

                                <div className="mb-3">
                                    <div className="text-xs font-semibold text-neutral-500 mb-1">
                                        Device
                                    </div>
                                    {/* <div className="flex flex-wrap gap-1">
                                        <UiBtn
                                            pressed={device === "desktop"}
                                            onClick={() =>
                                                setDevice("desktop")
                                            }
                                            disabled={closing}
                                        >
                                            Desktop
                                        </UiBtn>
                                        <UiBtn
                                            pressed={device === "tablet"}
                                            onClick={() =>
                                                setDevice("tablet")
                                            }
                                            disabled={closing}
                                        >
                                            Tablet
                                        </UiBtn>
                                        <UiBtn
                                            pressed={device === "mobile"}
                                            onClick={() =>
                                                setDevice("mobile")
                                            }
                                            disabled={closing}
                                        >
                                            Mobile
                                        </UiBtn>
                                    </div> */}
                                    <div className="inline-flex rounded-md shadow-sm">
                                        <button
                                            onClick={() => handleDeviceChange("desktop")}
                                            className={`p-2 text-lg rounded-l-md transition-colors ${device === "desktop"
                                                ? "bg-blue-600 text-white"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                            title="Desktop"
                                        >
                                            💻
                                        </button>
                                        <button
                                            onClick={() => handleDeviceChange("tablet")}
                                            className={`p-2 text-lg transition-colors ${device === "tablet"
                                                ? "bg-blue-600 text-white"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                            title="Tablet"
                                        >
                                            📱
                                        </button>
                                        <button
                                            onClick={() => handleDeviceChange("mobile")}
                                            className={`p-2 text-lg rounded-r-md transition-colors ${device === "mobile"
                                                ? "bg-blue-600 text-white"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                            title="Mobile"
                                        >
                                            🤳
                                        </button>
                                    </div>
                                </div>

                                <div className="mb-3">
                                    <div className="text-xs font-semibold text-neutral-500 mb-1">
                                        Actions
                                    </div>

                                    {/* MATCHES 1) EXACT LOOK + FEEL */}
                                    <div className="flex flex-wrap items-center gap-1">

                                        {/* Save Draft */}
                                        <button
                                            onClick={() => doSave()}
                                            disabled={closing || savingDraft}
                                            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors
                ${savingDraft
                                                    ? "bg-accent text-white opacity-80 cursor-not-allowed"
                                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                        >
                                            {savingDraft ? "💾 Saving…" : "💾 Save draft"}
                                        </button>

                                        {/* Export to Vercel */}
                                        <button
                                            onClick={() => setExportPrompt(true)}
                                            disabled={closing || exporting}
                                            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors
                ${exporting
                                                    ? "bg-accent text-white opacity-80 cursor-not-allowed"
                                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                }`}
                                        >
                                            {exporting ? "🚀 Exporting…" : "🚀 Export to Vercel"}
                                        </button>



                                        {/* Spacer */}
                                        <span className="ml-auto text-xs text-slate-500 self-center">
                                            v{version}
                                        </span>



                                        <div className="flex items-center gap-1 text-sm text-slate-500 mt-3">
                                            <div className="text-xs font-semibold text-neutral-500 mb-1">
                                                UI Scale
                                            </div>

                                            <button
                                                className="px-2 py-1 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50"
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
                                                className="px-2 py-1 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50"
                                                onClick={() =>
                                                    setUiScale((s) => Math.min(1.25, +(s + 0.05).toFixed(2)))
                                                }
                                                disabled={closing}
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>

                                    {exportNote && (
                                        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[12px] text-amber-800">
                                            {exportNote}
                                        </div>
                                    )}
                                </div>


                                {/* Selection styling sidebar */}
                                {mode === "preview" && (
                                    <div className="mb-3 border-t pt-3 mt-2">
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
                                                    Size
                                                </div>
                                                <div className="flex flex-wrap gap-1">
                                                    {FONT_SIZE_PRESETS.map(
                                                        (s) => (
                                                            <button
                                                                key={s.id}
                                                                type="button"
                                                                className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
                                                                disabled={
                                                                    closing
                                                                }
                                                                onClick={() =>
                                                                    sendStyleCommand(
                                                                        {
                                                                            kind: "fontSizePx",
                                                                            value: s.px,
                                                                        }
                                                                    )
                                                                }
                                                            >
                                                                {s.label}
                                                            </button>
                                                        )
                                                    )}
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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
                                                    className="px-2 py-1 rounded border border-neutral-300 bg-white text-[10px] hover:bg-neutral-50 active:scale-[.98] disabled:opacity-40"
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

                                                        {/* Theme font families */}
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
                                                        )}
                                                    </div>
                                                )}

                                            {/* Image size */}
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
                                            </div>


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

                                            {/* Text wrapping */}
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
                                            </div>
                                        </div>
                                    </div>
                                )}


                                <div className="block lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 border-t border-neutral-200 px-4 py-3">
                                    <div className="flex flex-col gap-2">

                                        {/* Apply to preview (TOP) */}
                                        <button
                                            onClick={applyDraftToPreview}
                                            disabled={closing || !dirty}
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

                                        {/* Close (BOTTOM) */}
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
                                        Edit in Preview or Code, apply with “Apply
                                        changes to preview”, then save or export.
                                    </div>
                                )}
                            </>
                        )}
                    </aside>

                    {/* Right / canvas */}
                    <section
                        className="relative bg-slate-50 rounded-lg border overflow-hidden flex flex-col max-lg:order-1"
                        onPointerDown={(e) => {
                            if (!(e.target as HTMLElement).closest("iframe"))
                                tryClearIframeSelection();
                        }}
                    >

                        {allPages && allPages.length > 1 && (
                            <div className="flex items-center gap-2 ml-2 mt-2">
                                <label className="text-xs font-medium text-gray-700">Page:</label>
                                <select
                                    value={activePageId}
                                    onChange={(e) => setActivePageId(e.target.value)}
                                    className="px-2 py-1 text-sm rounded-md border border-gray-300"
                                >
                                    {allPages.map((p) => (
                                        <option key={p.id} value={p.id}>{p.label}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        {/* Page selector
                        <span className="m-2 text-[10px] font-medium text-neutral-500 lg:hidden">
                            Pages
                        </span>
                        {allPages && allPages.length > 0 && (
                            <div className="mb-3">
                                <div className="flex flex-wrap gap-1">
                                    {allPages.map((p) => (
                                        <UiBtn
                                            key={p.id}
                                            pressed={p.id === activePageId}
                                            onClick={() =>
                                                setActivePageId(p.id)
                                            }
                                            disabled={closing}
                                        >
                                            {p.label || p.id}
                                        </UiBtn>
                                    ))}
                                </div>
                            </div>
                        )} */}
                        {activeSourceImage && mode !== "screenshot" && (
                            <img
                                src={activeSourceImage}
                                alt="reference"
                                className="absolute right-3 top-3 h-28 w-auto rounded border shadow pointer-events-none max-sm:hidden"
                            />
                        )}

                        {(mode === "preview" || mode === "code") && (
                            <div className="flex-1 overflow-auto p-3 sm:p-6">
                                <div
                                    className="mx-auto bg-white border rounded-lg shadow-sm"
                                    style={{
                                        width: devicePx,
                                        minWidth: 320,
                                        maxWidth: "100%",
                                    }}
                                >
                                    <iframe
                                        key={iframeKey}
                                        ref={iframeRef}
                                        className="w-full h-[70vh] sm:h-[80vh] border-0 rounded"
                                        title="KlonerPreview"
                                        sandbox="allow-same-origin"
                                        srcDoc={
                                            renderHtml ||
                                            "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>"
                                        }
                                        onLoad={() => {
                                            const doc =
                                                iframeRef.current
                                                    ?.contentDocument;
                                            if (!doc) return;
                                            doc
                                                .querySelectorAll(
                                                    ".kloner-toolbar"
                                                )
                                                .forEach((n) => n.remove());
                                            doc
                                                .querySelectorAll(
                                                    ".kloner-style-panel"
                                                )
                                                .forEach((n) => n.remove());
                                            if (mode === "preview") {
                                                injectEditableOverlay(
                                                    doc,
                                                    (updated) => {
                                                        setHtmlDraft(updated);
                                                    }
                                                );
                                                iframeRef.current?.contentWindow?.focus();
                                            }
                                        }}
                                    />
                                </div>
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

                        <div className="hidden lg:block mb-3">
                            {/* Utility Buttons: Increased size and a cohesive look (using lg:px-4 lg:py-2.5 lg:text-base) */}

                            {/* Main Action Button: HUGE size and full width */}
                            <button
                                onClick={applyDraftToPreview}
                                disabled={closing || !dirty}
                                aria-busy={applyingPreview}
                                // Increased padding (px-4 py-4) and font size (text-xl/text-2xl) to make it HUGE
                                className={`rounded px-4 py-4 text-xl w-full transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-neutral-300 active:scale-[.99] ${dirty
                                    ? "bg-emerald-600 text-white hover:brightness-95 shadow-lg" // Added shadow for emphasis
                                    : "bg-emerald-50 text-emerald-700 pointer-events-none" // Added pointer-events-none when up to date
                                    }`}
                                title="Apply current draft to the live preview"
                            >
                                {applyingPreview
                                    ? "🔄 Updating preview…"
                                    : dirty
                                        ? "🔥 Apply changes to preview" // Changed text and added emoji for urgency
                                        : "✅ Preview is up to date"}
                            </button>
                            <button
                                onClick={() => {
                                    if (dirty) setClosePrompt(true);
                                    else performClose("discard");
                                }}
                                disabled={closing}
                                className={`w-full px-3 py-3 text-lg mt-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-300 active:scale-[.99] ${closing
                                    ? "bg-accent text-white opacity-80 cursor-not-allowed"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                            >
                                ❌ Close Editor
                            </button>
                        </div>
                    </section>
                </div>

                {/* close/save/discard prompt */}
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
                                    className="px-2.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-50 active:scale-[.98]"
                                    onClick={() => setClosePrompt(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 rounded border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 active:scale-[.98]"
                                    onClick={() => performClose("discard")}
                                >
                                    Discard
                                </button>
                                <button
                                    type="button"
                                    className="px-2.5 py-1.5 rounded border border-transparent bg-neutral-900 text-white hover:brightness-110 active:scale-[.98]"
                                    onClick={() => performClose("save")}
                                >
                                    Save & close
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* export confirmation */}
                {exportPrompt && (
                    <div className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/40">
                        <div className="bg-white rounded-lg shadow-xl p-4 w-full max-w-sm border border-neutral-200">
                            <div className="text-xs font-semibold text-neutral-900 mb-2">
                                Deploy to Vercel?
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
                                    type="button"
                                    className="px-2.5 py-1.5 rounded border border-transparent bg-neutral-900 text-white hover:brightness-110 active:scale-[.98] disabled:opacity-60 flex items-center gap-2"
                                    onClick={async () => {
                                        setExportPrompt(false);
                                        await doExport();
                                    }}
                                    disabled={exporting}
                                >
                                    {exporting && <Spinner size={14} />} Deploy now
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
        "inline-flex items-center justify-center gap-2 transition active:scale-[.99] focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:opacity-60 disabled:cursor-not-allowed text-xs";

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

/* ------------------------ in-iframe edit layer ------------------------ */
function injectEditableOverlay(
    doc: Document,
    onChange: (updatedHtml: string) => void
) {
    doc.querySelectorAll(".kloner-toolbar").forEach((n) => n.remove());
    doc.querySelectorAll(".kloner-style-panel").forEach((n) => n.remove());

    const style = doc.createElement("style");
    style.textContent = `
    :root { --amber-50:#FFFBEB; --amber-200:#FDE68A; --amber-700:#B45309; --rose-50:#FFF1F2; --rose-200:#FECDD3; --rose-700:#BE123C; --slate-700:#334155; --slate-300:#cbd5e1; }
    [data-kloner-sel]{ outline:2px dashed #10b981 !important; outline-offset:2px !important; }
    .kloner-toolbar{
      position:fixed;
      z-index:2147483647;
      display:none;
      flex-wrap:wrap;
      gap:6px;
      padding:6px 8px;
      background:#020617;
      color:#e5e7eb;
      border-radius:10px;
      font:11px/1.2 system-ui,-apple-system,Segoe UI,Roboto;
      box-shadow:0 10px 30px rgba(0,0,0,.25);
      max-width:calc(100vw - 16px);
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
    }
    .kbtn-close{ background:#0f172a; color:#fff; border-color:#0f172a; }
    .kbtn-edit{ background:var(--amber-50); color:var(--amber-700); border-color:var(--amber-200); }
    .kbtn-del{  background:var(--rose-50);  color:var(--rose-700);  border-color:var(--rose-200); }
    .kbtn-img { background:#ecfeff; color:#155e75; border-color:#a5f3fc; }
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
    doc.body.appendChild(fileInput);

    const hint = doc.createElement("div");
    hint.className = "khint";
    hint.style.display = "none";
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
    toolbar.innerHTML = `
    <button class="kbtn kbtn-close" data-act="close">Close</button>
    <button class="kbtn kbtn-edit" data-act="dup">Duplicate</button>
    <button class="kbtn kbtn-del"  data-act="del">Delete block</button>
    <button class="kbtn kbtn-img"  data-act="img-insert">Insert image</button>
    <button class="kbtn kbtn-img"  data-act="img-replace">Replace image</button>
    <button class="kbtn kbtn-img"  data-act="img-del">Delete image</button>
    <button class="kbtn kbtn-img"  data-act="img-alt">ALT text</button>
    <button class="kbtn kbtn-img"  data-act="link">Link</button>
  `;

    doc.body.appendChild(toolbar);

    let selected: HTMLElement | null = null;

    function serializeClean(): string {
        const docClone = doc.documentElement.cloneNode(true) as HTMLElement;
        const body = (docClone as HTMLHtmlElement).querySelector("body")!;
        body.querySelectorAll(".kloner-toolbar").forEach((n) => n.remove());
        body.querySelectorAll(".kloner-style-panel").forEach((n) => n.remove());
        body.querySelectorAll("[data-kloner-sel]").forEach((n) =>
            (n as HTMLElement).removeAttribute("data-kloner-sel")
        );
        body.querySelectorAll("[contenteditable]").forEach((n) =>
            (n as HTMLElement).removeAttribute("contenteditable")
        );
        return "<!doctype html>\n" + (docClone as any).outerHTML;
    }

    let hist: string[] = [];
    let idx = -1;
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
        doc.body.replaceWith(doc.importNode(doc2.body, true));
        doc.body.appendChild(toolbar);
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
    function updateUndoRedoState() {
        // reserved for future undo/redo UI
    }
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

    function deleteImageOnBlock(block: HTMLElement) {
        const img =
            (block.tagName === "IMG"
                ? (block as HTMLImageElement)
                : (block.querySelector("img") as HTMLImageElement | null)) ??
            null;

        if (!img) {
            showHint("Select a block with an <img> to delete.", block);
            return;
        }

        const path = img.getAttribute("data-kloner-path");
        if (path) {
            doc.defaultView?.parent?.postMessage(
                {
                    type: "kloner:delete-assets",
                    paths: [path],
                },
                "*"
            );
        }

        img.remove();
        saveHistory();
        notify();
        showHint("Image deleted.", block);
    }

    async function insertImageIntoBlock(block: HTMLElement) {
        const { url, path } = await pickFileAndUpload(block);

        const img = doc.createElement("img");
        img.src = url;
        img.alt = "";
        img.style.display = "block";
        if (path) img.setAttribute("data-kloner-path", path);

        const box = cssBox(block);
        if (box.w > 4) img.setAttribute("width", String(Math.round(box.w)));
        if (box.h > 4) img.setAttribute("height", String(Math.round(box.h)));

        if (block.firstChild) block.insertBefore(img, block.firstChild);
        else block.appendChild(img);
        saveHistory();
        notify();
        showHint("Image inserted.", block);
    }

    async function replaceImage(el: HTMLImageElement) {
        const box = cssBox(el);
        const oldPath = el.getAttribute("data-kloner-path") || undefined;
        const { url, path } = await pickFileAndUpload(el);

        if (!el.getAttribute("width") && !el.style.width)
            el.setAttribute("width", `${Math.round(box.w)}`);
        if (!el.getAttribute("height") && !el.style.height)
            el.setAttribute("height", `${Math.round(box.h)}`);

        // delete old asset if we had one
        if (oldPath) {
            doc.defaultView?.parent?.postMessage(
                {
                    type: "kloner:delete-assets",
                    paths: [oldPath],
                },
                "*"
            );
        }

        el.src = url;
        if (path) el.setAttribute("data-kloner-path", path);

        saveHistory();
        notify();
        showHint("Image replaced.", el);
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

    function handleAction(act: string | null, sourceEl: HTMLElement) {
        if (!act) return;

        if (act === "close") {
            (doc.defaultView as any).__klonerApi?.clear();
            return;
        }
        if (!selected) return;

        if (act === "del") {
            const parent = selected.parentElement;
            selected.remove();
            select(null);
            parent?.focus?.();
            saveHistory();
            notify();
            return;
        }
        if (act === "dup") {
            const clone = selected.cloneNode(true) as HTMLElement;
            selected.insertAdjacentElement("afterend", clone);
            markEditable(clone);
            select(clone);
            saveHistory();
            notify();
            return;
        }
        if (act === "img-insert") {
            insertImageIntoBlock(selected).catch(() => { });
            return;
        }
        if (act === "img-replace") {
            const img =
                (selected.tagName === "IMG"
                    ? (selected as HTMLImageElement)
                    : (selected.querySelector("img") as HTMLImageElement | null)) ??
                null;
            if (!img) {
                showHint("No <img> here. Use Insert image.", selected);
                return;
            }
            replaceImage(img);
            return;
        }
        if (act === "img-del") {
            deleteImageOnBlock(selected);
            return;
        }
        if (act === "img-alt") {
            const img =
                (selected.tagName === "IMG"
                    ? (selected as HTMLImageElement)
                    : (selected.querySelector("img") as HTMLImageElement | null)) ??
                null;
            if (!img) {
                showHint("Select a block with an <img>.", selected);
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
        if (act === "link") {
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
