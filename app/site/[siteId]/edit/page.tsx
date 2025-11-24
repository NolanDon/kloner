// app/site/[siteId]/edit/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type {
    SiteConfig,
    Section,
    PageConfig,
    FontSizeToken,
} from "@/lib/siteConfig";
import { SiteRenderer } from "@/components/site/SiteRenderer";
import CenterLoader from "@/components/ui/CenterLoader";

type LoadedSite = {
    config: SiteConfig;
    overridesCss: string;
};

type ViewportMode = "mobile" | "tablet" | "desktop";

const FONT_OPTIONS = [
    {
        label: "System",
        value:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    },
    {
        label: "Inter",
        value:
            "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    },
    {
        label: "Outfit",
        value:
            "'Outfit', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    },
    {
        label: "Poppins",
        value:
            "'Poppins', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    },
    {
        label: "Playfair Display",
        value: "'Playfair Display', 'Times New Roman', serif",
    },
    {
        label: "Roboto",
        value:
            "'Roboto', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    },
    {
        label: "Merriweather",
        value: "'Merriweather', 'Georgia', serif",
    },
    {
        label: "Nunito",
        value:
            "'Nunito', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    },
];

const HEADING_SIZE_OPTIONS: { label: string; value: FontSizeToken }[] = [
    { label: "Small", value: "2xl" },
    { label: "Medium", value: "3xl" },
    { label: "Large", value: "4xl" },
    { label: "Hero", value: "5xl" },
];

const BODY_SIZE_OPTIONS: { label: string; value: FontSizeToken }[] = [
    { label: "Small", value: "sm" },
    { label: "Default", value: "base" },
    { label: "Large", value: "lg" },
    { label: "Extra large", value: "xl" },
];

const SECTION_SPACING_OPTIONS = [
    { label: "None", value: "none" },
    { label: "Tight", value: "tight" },
    { label: "Normal", value: "normal" },
    { label: "Loose", value: "loose" },
] as const;

const SECTION_ALIGN_OPTIONS = [
    { label: "Left", value: "left" },
    { label: "Center", value: "center" },
    { label: "Right", value: "right" },
] as const;

type SectionAlign = (typeof SECTION_ALIGN_OPTIONS)[number]["value"];


type SectionSpacing = (typeof SECTION_SPACING_OPTIONS)[number]["value"];

function createSection(type: Section["type"]): Section {
    const id = `section-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;

    if (type === "hero") {
        return {
            id,
            type: "hero",
            props: {
                title: "Hero heading",
                subtitle: "You can edit this hero text.",
                primaryCta: {
                    label: "Get started",
                    target: { kind: "none" },
                },
            },
        } as any;
    }

    if (type === "text") {
        return {
            id,
            type: "text",
            props: {
                title: "Text section title",
                body: "Write your body copy here.",
            },
        } as any;
    }

    // grid
    return {
        id,
        type: "grid",
        props: {
            title: "Grid section title",
            columns: 3,
            items: [],
        },
    } as any;
}

export default function EditSitePage() {
    const params = useParams<{ siteId: string }>();
    const siteId = params.siteId;
    const [data, setData] = useState<LoadedSite | null>(null);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState("");
    const [activePageId, setActivePageId] = useState<string | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [viewportMode, setViewportMode] =
        useState<ViewportMode>("desktop");
    const [selectedSectionId, setSelectedSectionId] = useState<
        string | null
    >(null);

    const updateConfig = (updater: (c: SiteConfig) => SiteConfig) => {
        setData((prev) =>
            prev ? { ...prev, config: updater(prev.config) } : prev
        );
    };

    const withActivePage = (
        c: SiteConfig,
        fn: (sections: Section[]) => Section[]
    ): SiteConfig => {
        if (!c.pages || c.pages.length === 0) return c;
        const idx = activePageId
            ? c.pages.findIndex((p) => p.id === activePageId)
            : 0;
        if (idx < 0) return c;

        const page = c.pages[idx];
        const updatedPage = { ...page, sections: fn(page.sections) };
        const pages = [...c.pages];
        pages[idx] = updatedPage;
        return { ...c, pages };
    };

    const updateSection = (id: string, patch: Partial<Section["props"]>) => {
        updateConfig((c) =>
            withActivePage(c, (sections) =>
                sections.map((s): Section =>
                    s.id === id
                        ? ({ ...s, props: { ...s.props, ...patch } } as any)
                        : s
                )
            )
        );
    };

    // patch "meta" on the section object (spacing, archived, etc)
    const updateSectionMeta = (
        id: string,
        patch: {
            spacing?: SectionSpacing;
            archived?: boolean;
            align?: SectionAlign;
        }
    ) => {
        updateConfig((c) =>
            withActivePage(c, (sections) =>
                sections.map((s) =>
                    s.id === id ? ({ ...(s as any), ...patch } as any) : s
                )
            )
        );
    };


    const addSection = (type: Section["type"]) => {
        updateConfig((c) =>
            withActivePage(c, (sections) => [...sections, createSection(type)])
        );
    };

    const duplicateSection = (id: string) => {
        updateConfig((c) =>
            withActivePage(c, (sections) => {
                const idx = sections.findIndex((s) => s.id === id);
                if (idx === -1) return sections;
                const original = sections[idx] as any;
                const copy: Section = {
                    ...original,
                    id: `section-${Date.now()
                        .toString(36)
                        .slice(2)}-copy`,
                };
                const arr = [...sections];
                arr.splice(idx + 1, 0, copy);
                return arr;
            })
        );
    };

    const updatePage = (id: string, patch: Partial<PageConfig> & { hiddenInNav?: boolean }) => {
        updateConfig((c) => {
            if (!c.pages) return c;
            return {
                ...c,
                pages: c.pages.map((p) =>
                    p.id === id ? ({ ...(p as any), ...patch } as any) : p
                ),
            };
        });
    };

    const removePage = (id: string) => {
        updateConfig((c) => {
            const pages = c.pages || [];
            if (pages.length <= 1) return c; // don't delete last page
            const nextPages = pages.filter((p) => p.id !== id);
            let nextActive = activePageId;
            if (!nextPages.find((p) => p.id === activePageId)) {
                nextActive = nextPages[0]?.id ?? null;
            }
            setActivePageId(nextActive);
            return { ...c, pages: nextPages };
        });
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/site/${siteId}`, {
                    credentials: "include",
                });
                if (!res.ok) {
                    setErr("Failed to load site");
                    return;
                }
                const j = await res.json();
                if (!cancelled) {
                    const cfg: SiteConfig = j.siteConfig;
                    setData({
                        config: cfg,
                        overridesCss: j.overridesCss || "",
                    });
                    const firstPage = cfg.pages?.[0];
                    if (firstPage) {
                        setActivePageId(firstPage.id);
                    }
                }
            } catch {
                if (!cancelled) setErr("Failed to load site");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [siteId]);

    const addPage = () => {
        updateConfig((c) => {
            const pages = c.pages ?? [];
            const index = pages.length;

            const id = `page-${Date.now().toString(36)}-${index}`;
            const isFirst = index === 0;

            const title = isFirst ? "Home" : `Page ${index + 1}`;
            const slug = isFirst ? "home" : `page-${index + 1}`;

            const newPage: PageConfig = {
                id,
                slug,
                title,
                navLabel: title,
                isHome: isFirst,
                sections: [],
            };

            const nextPages = [...pages, newPage];

            setActivePageId(newPage.id);

            return {
                ...c,
                pages: nextPages,
            };
        });
    };

    const updateTheme = (patch: Partial<SiteConfig["theme"]>) => {
        updateConfig((c) => ({
            ...c,
            theme: { ...c.theme, ...patch },
        }));
    };

    const moveSection = (id: string, dir: "up" | "down") => {
        updateConfig((c) =>
            withActivePage(c, (sections) => {
                const idx = sections.findIndex((s) => s.id === id);
                if (idx === -1) return sections;
                const target = dir === "up" ? idx - 1 : idx + 1;
                if (target < 0 || target >= sections.length) return sections;
                const arr = [...sections];
                const [item] = arr.splice(idx, 1);
                arr.splice(target, 0, item);
                return arr;
            })
        );
    };

    const removeSection = (id: string) => {
        updateConfig((c) =>
            withActivePage(c, (sections) =>
                sections.filter((s) => s.id !== id)
            )
        );
        if (selectedSectionId === id) {
            setSelectedSectionId(null);
        }
    };

    const save = async () => {
        if (!data) return;
        setSaving(true);
        setErr("");
        try {
            const res = await fetch(`/api/site/${siteId}`, {
                method: "PATCH",
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ siteConfig: data.config }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                setErr(j.error || "Save failed");
            }
        } catch {
            setErr("Save failed");
        } finally {
            setSaving(false);
        }
    };

    if (!data) {
        return (
            <main className="min-h-screen flex items-center justify-center">
                <div className="text-sm text-neutral-600">
                    {err || <CenterLoader />}
                </div>
            </main>
        );
    }

    const { config, overridesCss } = data;
    const pages = config.pages || [];
    const activePage =
        pages.find((p) => p.id === activePageId) || pages[0] || null;
    const sections: Section[] = activePage ? activePage.sections : [];

    const viewportWidthClass =
        viewportMode === "mobile"
            ? "max-w-[420px]"
            : viewportMode === "tablet"
                ? "max-w-[900px]"
                : "max-w-[1280px]";

    const currentFontFamily =
        config.theme.fontFamily ||
        FONT_OPTIONS[0].value;

    const currentHeadingSize =
        (config.theme.fontScaleHeading as FontSizeToken | undefined) ||
        HEADING_SIZE_OPTIONS[1].value;
    const currentBodySize =
        (config.theme.fontScaleBody as FontSizeToken | undefined) ||
        BODY_SIZE_OPTIONS[1].value;

    const currentPageMeta = activePage || ({} as PageConfig);
    const currentPageHiddenInNav = (currentPageMeta as any).hiddenInNav;

    return (
        <main className="min-h-screen bg-neutral-50">
            <div className="py-6 px-4 lg:px-8 flex flex-col gap-4">
                <header className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div>
                            <h1 className="text-xl font-semibold text-neutral-800">
                                Edit site
                            </h1>
                            <p className="text-xs text-neutral-500">
                                Adjust layout, theme, and sections. All changes
                                are stored as JSON.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setSidebarOpen((v) => !v)}
                            className="hidden lg:inline-flex items-center rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 bg-white hover:bg-neutral-100"
                        >
                            {sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                        </button>
                        {err && (
                            <span className="text-xs text-red-600 max-w-xs truncate">
                                {err}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={save}
                            disabled={saving}
                            className="rounded-md bg-neutral-900 text-white text-xs px-3 py-1.5 disabled:opacity-60"
                        >
                            {saving ? "Saving…" : "Save changes"}
                        </button>
                    </div>
                </header>

                <div
                    className={`grid grid-cols-1 gap-6 ${sidebarOpen
                        ? "lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]"
                        : "lg:grid-cols-1"
                        }`}
                >
                    {sidebarOpen && (
                        <div className="space-y-4">
                            {/* Page + nav controls */}
                            <section className="rounded-xl bg-white border border-neutral-200 p-4">
                                <h2 className="text-sm font-semibold text-neutral-800">
                                    Page
                                </h2>
                                <div className="mt-3 space-y-3 text-xs">
                                    {pages.length === 0 ? (
                                        <div className="text-neutral-500 space-y-2">
                                            <p>No pages in this site config.</p>
                                            <button
                                                type="button"
                                                onClick={addPage}
                                                className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-800 bg-neutral-50 hover:bg-neutral-100"
                                            >
                                                + Add first page
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <select
                                                className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                                                value={activePage?.id || ""}
                                                onChange={(e) => {
                                                    setActivePageId(
                                                        e.target.value
                                                    );
                                                    setSelectedSectionId(null);
                                                }}
                                            >
                                                {pages.map((p) => (
                                                    <option
                                                        key={p.id}
                                                        value={p.id}
                                                    >
                                                        {p.title || p.slug}
                                                    </option>
                                                ))}
                                            </select>

                                            {/* Current page meta controls */}
                                            {activePage && (
                                                <div className="space-y-2 text-neutral-700">
                                                    <label className="flex flex-col gap-1">
                                                        <span>Page title</span>
                                                        <input
                                                            type="text"
                                                            value={
                                                                activePage.title ||
                                                                ""
                                                            }
                                                            onChange={(e) =>
                                                                updatePage(
                                                                    activePage.id,
                                                                    {
                                                                        title: e
                                                                            .target
                                                                            .value,
                                                                        navLabel:
                                                                            activePage
                                                                                .navLabel ??
                                                                            e
                                                                                .target
                                                                                .value,
                                                                    }
                                                                )
                                                            }
                                                            className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                        />
                                                    </label>
                                                    <label className="flex flex-col gap-1">
                                                        <span>Nav label</span>
                                                        <input
                                                            type="text"
                                                            value={
                                                                activePage.navLabel ||
                                                                activePage.title ||
                                                                activePage.slug
                                                            }
                                                            onChange={(e) =>
                                                                updatePage(
                                                                    activePage.id,
                                                                    {
                                                                        navLabel:
                                                                            e
                                                                                .target
                                                                                .value,
                                                                    }
                                                                )
                                                            }
                                                            className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                        />
                                                    </label>
                                                    <div className="flex items-center justify-between gap-2">
                                                        <label className="inline-flex items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                className="h-3 w-3"
                                                                checked={
                                                                    !currentPageHiddenInNav
                                                                }
                                                                onChange={(
                                                                    e
                                                                ) =>
                                                                    updatePage(
                                                                        activePage.id,
                                                                        {
                                                                            hiddenInNav:
                                                                                !e
                                                                                    .target
                                                                                    .checked,
                                                                        }
                                                                    )
                                                                }
                                                            />
                                                            <span>
                                                                Show in header
                                                                navigation
                                                            </span>
                                                        </label>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                removePage(
                                                                    activePage.id
                                                                )
                                                            }
                                                            className="text-[11px] text-red-600 border border-red-200 rounded px-2 py-0.5 disabled:opacity-50"
                                                            disabled={
                                                                pages.length <=
                                                                1
                                                            }
                                                        >
                                                            Delete page
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            <button
                                                type="button"
                                                onClick={addPage}
                                                className="mt-2 inline-flex items-center justify-center rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-800 bg-neutral-50 hover:bg-neutral-100"
                                            >
                                                + Add page
                                            </button>
                                        </>
                                    )}
                                </div>
                            </section>

                            {/* Theme */}
                            <section className="rounded-xl bg-white border border-neutral-200 p-4">
                                <h2 className="text-sm font-semibold text-neutral-800">
                                    Theme
                                </h2>
                                <div className="mt-3 space-y-3 text-xs text-neutral-700">
                                    <label className="flex flex-col gap-1">
                                        <span>Primary color</span>
                                        <input
                                            type="color"
                                            value={config.theme.primaryColor}
                                            onChange={(e) =>
                                                updateTheme({
                                                    primaryColor:
                                                        e.target.value,
                                                })
                                            }
                                            className="h-8 w-16 cursor-pointer"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span>Accent color</span>
                                        <input
                                            type="color"
                                            value={config.theme.accentColor}
                                            onChange={(e) =>
                                                updateTheme({
                                                    accentColor:
                                                        e.target.value,
                                                })
                                            }
                                            className="h-8 w-16 cursor-pointer"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span>Background color</span>
                                        <input
                                            type="color"
                                            value={config.theme.bgColor}
                                            onChange={(e) =>
                                                updateTheme({
                                                    bgColor: e.target.value,
                                                })
                                            }
                                            className="h-8 w-16 cursor-pointer"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span>Corner radius</span>
                                        <input
                                            type="range"
                                            min={0.5}
                                            max={3}
                                            step={0.1}
                                            value={config.theme.radiusScale}
                                            onChange={(e) =>
                                                updateTheme({
                                                    radiusScale: Number(
                                                        e.target.value
                                                    ),
                                                })
                                            }
                                        />
                                    </label>

                                    <div className="pt-3 mt-2 border-t border-neutral-200 space-y-3">
                                        <label className="flex flex-col gap-1">
                                            <span>Font family</span>
                                            <select
                                                value={currentFontFamily}
                                                onChange={(e) =>
                                                    updateTheme({
                                                        fontFamily:
                                                            e.target.value as any,
                                                    })
                                                }
                                                className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                            >
                                                {FONT_OPTIONS.map((opt) => (
                                                    <option
                                                        key={opt.label}
                                                        value={opt.value}
                                                    >
                                                        {opt.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className="flex flex-col gap-1">
                                            <span>Heading size</span>
                                            <select
                                                value={currentHeadingSize}
                                                onChange={(e) =>
                                                    updateTheme({
                                                        fontScaleHeading:
                                                            e.target
                                                                .value as FontSizeToken,
                                                    })
                                                }
                                                className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                            >
                                                {HEADING_SIZE_OPTIONS.map(
                                                    (opt) => (
                                                        <option
                                                            key={opt.label}
                                                            value={opt.value}
                                                        >
                                                            {opt.label}
                                                        </option>
                                                    )
                                                )}
                                            </select>
                                        </label>

                                        <label className="flex flex-col gap-1">
                                            <span>Body size</span>
                                            <select
                                                value={currentBodySize}
                                                onChange={(e) =>
                                                    updateTheme({
                                                        fontScaleBody:
                                                            e.target
                                                                .value as FontSizeToken,
                                                    })
                                                }
                                                className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                            >
                                                {BODY_SIZE_OPTIONS.map(
                                                    (opt) => (
                                                        <option
                                                            key={opt.label}
                                                            value={opt.value}
                                                        >
                                                            {opt.label}
                                                        </option>
                                                    )
                                                )}
                                            </select>
                                        </label>

                                        <label className="flex flex-col gap-1">
                                            <span>Heading weight</span>
                                            <select
                                                value={
                                                    config.theme
                                                        .headingWeight ||
                                                    "bold"
                                                }
                                                onChange={(e) =>
                                                    updateTheme({
                                                        headingWeight:
                                                            e.target
                                                                .value as any,
                                                    })
                                                }
                                                className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                            >
                                                <option value="normal">
                                                    Normal
                                                </option>
                                                <option value="medium">
                                                    Medium
                                                </option>
                                                <option value="semibold">
                                                    Semibold
                                                </option>
                                                <option value="bold">
                                                    Bold
                                                </option>
                                            </select>
                                        </label>

                                        <label className="flex flex-col gap-1">
                                            <span>Body weight</span>
                                            <select
                                                value={
                                                    config.theme.bodyWeight ||
                                                    "normal"
                                                }
                                                onChange={(e) =>
                                                    updateTheme({
                                                        bodyWeight:
                                                            e.target
                                                                .value as any,
                                                    })
                                                }
                                                className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                            >
                                                <option value="normal">
                                                    Normal
                                                </option>
                                                <option value="medium">
                                                    Medium
                                                </option>
                                                <option value="semibold">
                                                    Semibold
                                                </option>
                                                <option value="bold">
                                                    Bold
                                                </option>
                                            </select>
                                        </label>
                                    </div>
                                </div>
                            </section>

                            {/* Sections */}
                            <section className="rounded-xl bg-white border border-neutral-200 p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <h2 className="text-sm font-semibold text-neutral-800">
                                        Sections
                                    </h2>
                                    <div className="flex flex-wrap gap-1">
                                        <button
                                            type="button"
                                            onClick={() => addSection("hero")}
                                            className="border border-neutral-300 rounded px-2 py-0.5 text-[11px] bg-neutral-50 hover:bg-neutral-100"
                                        >
                                            + Hero
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => addSection("text")}
                                            className="border border-neutral-300 rounded px-2 py-0.5 text-[11px] bg-neutral-50 hover:bg-neutral-100"
                                        >
                                            + Text
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => addSection("grid")}
                                            className="border border-neutral-300 rounded px-2 py-0.5 text-[11px] bg-neutral-50 hover:bg-neutral-100"
                                        >
                                            + Grid
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-3 space-y-3">
                                    {sections.map((s: Section, idx: number) => {
                                        const spacing =
                                            ((s as any).spacing as SectionSpacing) || "normal";
                                        const archived = !!(s as any).archived;
                                        const align = ((s as any).align as SectionAlign) || "center";
                                        const isSelected =
                                            selectedSectionId === s.id;

                                        return (
                                            <div
                                                key={s.id}
                                                className={`rounded-lg border p-3 text-xs space-y-2 bg-neutral-50 transition ${isSelected
                                                    ? "border-neutral-900 shadow-sm"
                                                    : "border-neutral-200"
                                                    } ${archived
                                                        ? "opacity-60"
                                                        : ""
                                                    }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setSelectedSectionId(
                                                                s.id
                                                            )
                                                        }
                                                        className="text-left font-semibold text-neutral-800 flex-1"
                                                    >
                                                        {s.type.toUpperCase()} #
                                                        {idx + 1}
                                                        {archived
                                                            ? " (archived)"
                                                            : ""}
                                                    </button>
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                moveSection(
                                                                    s.id,
                                                                    "up"
                                                                )
                                                            }
                                                            disabled={idx === 0}
                                                            className="px-2 py-0.5 rounded border border-neutral-300 text-[11px] disabled:opacity-40"
                                                        >
                                                            ↑
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                moveSection(
                                                                    s.id,
                                                                    "down"
                                                                )
                                                            }
                                                            disabled={
                                                                idx ===
                                                                sections.length -
                                                                1
                                                            }
                                                            className="px-2 py-0.5 rounded border border-neutral-300 text-[11px] disabled:opacity-40"
                                                        >
                                                            ↓
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                duplicateSection(
                                                                    s.id
                                                                )
                                                            }
                                                            className="px-2 py-0.5 rounded border border-neutral-300 text-[11px]"
                                                        >
                                                            Duplicate
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                removeSection(
                                                                    s.id
                                                                )
                                                            }
                                                            className="px-2 py-0.5 rounded border border-red-200 text-[11px] text-red-700"
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <label className="flex items-center gap-2">
                                                        <span className="whitespace-nowrap">Vertical spacing</span>
                                                        <select
                                                            value={spacing}
                                                            onChange={(e) =>
                                                                updateSectionMeta(s.id, {
                                                                    spacing: e.target.value as SectionSpacing,
                                                                })
                                                            }
                                                            className="rounded border border-neutral-300 px-2 py-0.5 text-[11px]"
                                                        >
                                                            {SECTION_SPACING_OPTIONS.map((opt) => (
                                                                <option key={opt.value} value={opt.value}>
                                                                    {opt.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>

                                                    <label className="flex items-center gap-2">
                                                        <span className="whitespace-nowrap">Align</span>
                                                        <select
                                                            value={align}
                                                            onChange={(e) =>
                                                                updateSectionMeta(s.id, {
                                                                    align: e.target.value as SectionAlign,
                                                                })
                                                            }
                                                            className="rounded border border-neutral-300 px-2 py-0.5 text-[11px]"
                                                        >
                                                            {SECTION_ALIGN_OPTIONS.map((opt) => (
                                                                <option key={opt.value} value={opt.value}>
                                                                    {opt.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>

                                                    <label className="inline-flex items-center gap-2 ml-auto">
                                                        <input
                                                            type="checkbox"
                                                            className="h-3 w-3"
                                                            checked={archived}
                                                            onChange={(e) =>
                                                                updateSectionMeta(s.id, {
                                                                    archived: e.target.checked,
                                                                })
                                                            }
                                                        />
                                                        <span className="whitespace-nowrap">Archive</span>
                                                    </label>
                                                </div>


                                                {s.type === "hero" &&
                                                    (() => {
                                                        const props = s.props as any;
                                                        const primaryTarget = props.primaryCta?.target || { kind: "none" };
                                                        const secondaryTarget = props.secondaryCta?.target || { kind: "none" };

                                                        const primaryKind =
                                                            (primaryTarget.kind as "none" | "external" | "page") || "none";
                                                        const secondaryKind =
                                                            (secondaryTarget.kind as "none" | "external" | "page") ||
                                                            "none";

                                                        const setPrimaryTarget = (next: any) =>
                                                            updateSection(s.id, {
                                                                primaryCta: {
                                                                    ...(props.primaryCta || { label: "Get started" }),
                                                                    target: next,
                                                                } as any,
                                                            });

                                                        const setSecondaryTarget = (next: any) =>
                                                            updateSection(s.id, {
                                                                secondaryCta: {
                                                                    ...(props.secondaryCta || { label: "Learn more" }),
                                                                    target: next,
                                                                } as any,
                                                            });

                                                        return (
                                                            <div className="space-y-2">
                                                                <label className="flex flex-col gap-1">
                                                                    <span>Title (supports HTML)</span>
                                                                    <input
                                                                        type="text"
                                                                        value={props.title || ""}
                                                                        onChange={(e) =>
                                                                            updateSection(s.id, {
                                                                                title: e.target.value,
                                                                            } as any)
                                                                        }
                                                                        className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                                    />
                                                                </label>

                                                                <label className="flex flex-col gap-1">
                                                                    <span>Subtitle (supports HTML)</span>
                                                                    <textarea
                                                                        value={props.subtitle || ""}
                                                                        onChange={(e) =>
                                                                            updateSection(s.id, {
                                                                                subtitle: e.target.value,
                                                                            } as any)
                                                                        }
                                                                        className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                                        rows={3}
                                                                    />
                                                                </label>

                                                                {/* PRIMARY CTA */}
                                                                <label className="flex flex-col gap-1">
                                                                    <span>Primary button label</span>
                                                                    <input
                                                                        type="text"
                                                                        value={props.primaryCta?.label || ""}
                                                                        onChange={(e) =>
                                                                            updateSection(s.id, {
                                                                                primaryCta: {
                                                                                    ...(props.primaryCta || {
                                                                                        target: { kind: "none" },
                                                                                    }),
                                                                                    label: e.target.value,
                                                                                } as any,
                                                                            })
                                                                        }
                                                                        className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                                    />
                                                                </label>

                                                                <div className="flex flex-col gap-1">
                                                                    <span className="text-[11px] text-neutral-700">
                                                                        Primary button link
                                                                    </span>
                                                                    <select
                                                                        value={primaryKind}
                                                                        onChange={(e) => {
                                                                            const kind = e.target
                                                                                .value as "none" | "external" | "page";
                                                                            if (kind === "none") {
                                                                                setPrimaryTarget({ kind: "none" });
                                                                            } else if (kind === "external") {
                                                                                setPrimaryTarget({
                                                                                    kind: "external",
                                                                                    url: primaryTarget.url || "",
                                                                                });
                                                                            } else {
                                                                                const fallbackPageId =
                                                                                    primaryTarget.pageId ||
                                                                                    pages[0]?.id ||
                                                                                    "";
                                                                                setPrimaryTarget({
                                                                                    kind: "page",
                                                                                    pageId: fallbackPageId,
                                                                                });
                                                                            }
                                                                        }}
                                                                        className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                                    >
                                                                        <option value="none">None</option>
                                                                        <option value="external">External URL</option>
                                                                        <option value="page">Page on this site</option>
                                                                    </select>

                                                                    {primaryKind === "external" && (
                                                                        <input
                                                                            type="text"
                                                                            placeholder="https://example.com"
                                                                            value={primaryTarget.url || ""}
                                                                            onChange={(e) =>
                                                                                setPrimaryTarget({
                                                                                    kind: "external",
                                                                                    url: e.target.value,
                                                                                })
                                                                            }
                                                                            className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                                        />
                                                                    )}

                                                                    {primaryKind === "page" && (
                                                                        <select
                                                                            value={primaryTarget.pageId || ""}
                                                                            onChange={(e) =>
                                                                                setPrimaryTarget({
                                                                                    kind: "page",
                                                                                    pageId: e.target.value,
                                                                                })
                                                                            }
                                                                            className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                                        >
                                                                            {pages.map((p) => (
                                                                                <option key={p.id} value={p.id}>
                                                                                    {p.navLabel || p.title || p.slug}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    )}
                                                                </div>

                                                                {/* SECONDARY CTA */}
                                                                <label className="flex flex-col gap-1">
                                                                    <span>Secondary button label</span>
                                                                    <input
                                                                        type="text"
                                                                        value={props.secondaryCta?.label || ""}
                                                                        onChange={(e) =>
                                                                            updateSection(s.id, {
                                                                                secondaryCta: {
                                                                                    ...(props.secondaryCta || {
                                                                                        target: { kind: "none" },
                                                                                    }),
                                                                                    label: e.target.value,
                                                                                } as any,
                                                                            })
                                                                        }
                                                                        className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                                    />
                                                                </label>

                                                                <div className="flex flex-col gap-1">
                                                                    <span className="text-[11px] text-neutral-700">
                                                                        Secondary button link
                                                                    </span>
                                                                    <select
                                                                        value={secondaryKind}
                                                                        onChange={(e) => {
                                                                            const kind = e.target
                                                                                .value as "none" | "external" | "page";
                                                                            if (kind === "none") {
                                                                                setSecondaryTarget({ kind: "none" });
                                                                            } else if (kind === "external") {
                                                                                setSecondaryTarget({
                                                                                    kind: "external",
                                                                                    url: secondaryTarget.url || "",
                                                                                });
                                                                            } else {
                                                                                const fallbackPageId =
                                                                                    secondaryTarget.pageId ||
                                                                                    pages[0]?.id ||
                                                                                    "";
                                                                                setSecondaryTarget({
                                                                                    kind: "page",
                                                                                    pageId: fallbackPageId,
                                                                                });
                                                                            }
                                                                        }}
                                                                        className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                                    >
                                                                        <option value="none">None</option>
                                                                        <option value="external">External URL</option>
                                                                        <option value="page">Page on this site</option>
                                                                    </select>

                                                                    {secondaryKind === "external" && (
                                                                        <input
                                                                            type="text"
                                                                            placeholder="https://example.com"
                                                                            value={secondaryTarget.url || ""}
                                                                            onChange={(e) =>
                                                                                setSecondaryTarget({
                                                                                    kind: "external",
                                                                                    url: e.target.value,
                                                                                })
                                                                            }
                                                                            className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                                        />
                                                                    )}

                                                                    {secondaryKind === "page" && (
                                                                        <select
                                                                            value={secondaryTarget.pageId || ""}
                                                                            onChange={(e) =>
                                                                                setSecondaryTarget({
                                                                                    kind: "page",
                                                                                    pageId: e.target.value,
                                                                                })
                                                                            }
                                                                            className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                                        >
                                                                            {pages.map((p) => (
                                                                                <option key={p.id} value={p.id}>
                                                                                    {p.navLabel || p.title || p.slug}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}

                                                {s.type === "text" && (
                                                    <div className="space-y-2">
                                                        <label className="flex flex-col gap-1">
                                                            <span>Title</span>
                                                            <input
                                                                type="text"
                                                                value={
                                                                    (s.props as any)
                                                                        .title ||
                                                                    ""
                                                                }
                                                                onChange={(e) =>
                                                                    updateSection(
                                                                        s.id,
                                                                        {
                                                                            title:
                                                                                e
                                                                                    .target
                                                                                    .value,
                                                                        } as any
                                                                    )
                                                                }
                                                                className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                            />
                                                        </label>
                                                        <label className="flex flex-col gap-1">
                                                            <span>Body</span>
                                                            <textarea
                                                                value={
                                                                    (s.props as any)
                                                                        .body ||
                                                                    ""
                                                                }
                                                                onChange={(e) =>
                                                                    updateSection(
                                                                        s.id,
                                                                        {
                                                                            body: e
                                                                                .target
                                                                                .value,
                                                                        } as any
                                                                    )
                                                                }
                                                                className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                                rows={4}
                                                            />
                                                        </label>
                                                    </div>
                                                )}

                                                {s.type === "grid" && (
                                                    <div className="space-y-2">
                                                        <label className="flex flex-col gap-1">
                                                            <span>Title</span>
                                                            <input
                                                                type="text"
                                                                value={
                                                                    (s.props as any)
                                                                        .title ||
                                                                    ""
                                                                }
                                                                onChange={(e) =>
                                                                    updateSection(
                                                                        s.id,
                                                                        {
                                                                            title:
                                                                                e
                                                                                    .target
                                                                                    .value,
                                                                        } as any
                                                                    )
                                                                }
                                                                className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                            />
                                                        </label>
                                                        <label className="flex flex-col gap-1">
                                                            <span>Columns</span>
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                max={4}
                                                                value={
                                                                    (s.props as any)
                                                                        .columns ||
                                                                    3
                                                                }
                                                                onChange={(e) =>
                                                                    updateSection(
                                                                        s.id,
                                                                        {
                                                                            columns:
                                                                                Number(
                                                                                    e
                                                                                        .target
                                                                                        .value
                                                                                ),
                                                                        } as any
                                                                    )
                                                                }
                                                                className="rounded border border-neutral-300 px-2 py-1 text-xs w-16"
                                                            />
                                                        </label>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        </div>
                    )}

                    {/* Live preview */}
                    <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
                        <div className="border-b border-neutral-200 px-4 py-2 flex items-center justify-between text-xs text-neutral-500">
                            <span>Live preview</span>
                            <div className="inline-flex items-center rounded-full bg-neutral-100 p-1">
                                {(["mobile", "tablet", "desktop"] as const).map(
                                    (mode) => {
                                        const label =
                                            mode === "mobile"
                                                ? "Mobile"
                                                : mode === "tablet"
                                                    ? "Tablet"
                                                    : "Desktop";
                                        const active =
                                            viewportMode === mode;
                                        return (
                                            <button
                                                key={mode}
                                                type="button"
                                                onClick={() =>
                                                    setViewportMode(mode)
                                                }
                                                className={`px-3 py-1 text-[11px] rounded-full transition ${active
                                                    ? "bg-neutral-900 text-white"
                                                    : "text-neutral-600 hover:bg-neutral-200"
                                                    }`}
                                            >
                                                {label}
                                            </button>
                                        );
                                    }
                                )}
                            </div>
                        </div>
                        <div className="bg-neutral-100 flex justify-center px-4 py-6">
                            <div
                                className={`w-full ${viewportWidthClass} shadow-[0_0_0_1px_rgba(0,0,0,0.08)] rounded-xl overflow-hidden bg-white`}
                            >
                                <SiteRenderer
                                    config={config}
                                    overridesCss={overridesCss}
                                    siteId={siteId}
                                    disableNavigation
                                    currentPageId={activePage?.id}
                                    selectedSectionId={selectedSectionId}
                                    onSelectSection={setSelectedSectionId}
                                    onEditSection={updateSection}
                                    viewportMode={viewportMode}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {!sidebarOpen && (
                    <div className="fixed bottom-4 left-4 lg:hidden">
                        <button
                            type="button"
                            onClick={() => setSidebarOpen(true)}
                            className="rounded-full bg-neutral-900 text-white text-xs px-4 py-2 shadow-lg"
                        >
                            Show controls
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}
