// app/site/[siteId]/edit/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { SiteConfig, Section, PageConfig } from "@/lib/siteConfig";
import { SiteRenderer } from "@/components/site/SiteRenderer";
import CenterLoader from "@/components/ui/CenterLoader";

type LoadedSite = {
    config: SiteConfig;
    overridesCss: string;
};

type ViewportMode = "mobile" | "tablet" | "desktop";

export default function EditSitePage() {
    const params = useParams<{ siteId: string }>();
    const siteId = params.siteId;
    const [data, setData] = useState<LoadedSite | null>(null);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState("");
    const [activePageId, setActivePageId] = useState<string | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [viewportMode, setViewportMode] = useState<ViewportMode>("desktop");

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

    const updateConfig = (updater: (c: SiteConfig) => SiteConfig) => {
        setData((prev) =>
            prev ? { ...prev, config: updater(prev.config) } : prev
        );
    };

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
                sections.map((s): any =>
                    s.id === id
                        ? {
                            ...s,
                            props: {
                                ...s.props,
                                ...patch,
                            },
                        }
                        : s
                )
            )
        );
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

    return (
        <main className="min-h-screen bg-neutral-50">
            <div className="mx-auto max-w-7xl py-6 px-4 lg:px-8 flex flex-col gap-4">
                <header className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div>
                            <h1 className="text-xl font-semibold text-neutral-800">
                                Edit site
                            </h1>
                            <p className="text-xs text-neutral-500">
                                Adjust colors, text and blocks. All changes are stored as JSON.
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
                    {/* Controls */}
                    {sidebarOpen && (
                        <div className="space-y-4">
                            {/* Page picker */}
                            <section className="rounded-xl bg-white border border-neutral-200 p-4">
                                <h2 className="text-sm font-semibold text-neutral-800">
                                    Page
                                </h2>
                                <div className="mt-3 space-y-2">
                                    {pages.length === 0 ? (
                                        <div className="text-xs text-neutral-500 space-y-2">
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
                                                onChange={(e) =>
                                                    setActivePageId(
                                                        e.target.value
                                                    )
                                                }
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
                                </div>
                            </section>

                            {/* Sections */}
                            <section className="rounded-xl bg-white border border-neutral-200 p-4">
                                <h2 className="text-sm font-semibold text-neutral-800">
                                    Sections
                                </h2>
                                <div className="mt-3 space-y-3">
                                    {sections.map((s: Section, idx: number) => (
                                        <div
                                            key={s.id}
                                            className="rounded-lg border border-neutral-200 p-3 text-xs space-y-2 bg-neutral-50"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-semibold text-neutral-800">
                                                    {s.type.toUpperCase()} #
                                                    {idx + 1}
                                                </span>
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
                                                            sections.length - 1
                                                        }
                                                        className="px-2 py-0.5 rounded border border-neutral-300 text-[11px] disabled:opacity-40"
                                                    >
                                                        ↓
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            removeSection(s.id)
                                                        }
                                                        className="px-2 py-0.5 rounded border border-red-200 text-[11px] text-red-700"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            </div>

                                            {s.type === "hero" && (
                                                <div className="space-y-2">
                                                    <label className="flex flex-col gap-1">
                                                        <span>Title</span>
                                                        <input
                                                            type="text"
                                                            value={
                                                                s.props
                                                                    .title || ""
                                                            }
                                                            onChange={(e) =>
                                                                updateSection(
                                                                    s.id,
                                                                    {
                                                                        title: e
                                                                            .target
                                                                            .value,
                                                                    }
                                                                )
                                                            }
                                                            className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                        />
                                                    </label>
                                                    <label className="flex flex-col gap-1">
                                                        <span>Subtitle</span>
                                                        <textarea
                                                            value={
                                                                s.props
                                                                    .subtitle ||
                                                                ""
                                                            }
                                                            onChange={(e) =>
                                                                updateSection(
                                                                    s.id,
                                                                    {
                                                                        subtitle:
                                                                            e
                                                                                .target
                                                                                .value,
                                                                    }
                                                                )
                                                            }
                                                            className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                            rows={3}
                                                        />
                                                    </label>
                                                    <label className="flex flex-col gap-1">
                                                        <span>
                                                            Primary button label
                                                        </span>
                                                        <input
                                                            type="text"
                                                            value={
                                                                s.props
                                                                    .primaryCta
                                                                    ?.label ||
                                                                ""
                                                            }
                                                            onChange={(e) =>
                                                                updateSection(
                                                                    s.id,
                                                                    {
                                                                        primaryCta:
                                                                        {
                                                                            ...(s
                                                                                .props
                                                                                .primaryCta ||
                                                                            {
                                                                                target:
                                                                                {
                                                                                    kind: "none",
                                                                                },
                                                                            }),
                                                                            label: e
                                                                                .target
                                                                                .value,
                                                                        },
                                                                    }
                                                                )
                                                            }
                                                            className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                        />
                                                    </label>
                                                </div>
                                            )}

                                            {s.type === "text" && (
                                                <div className="space-y-2">
                                                    <label className="flex flex-col gap-1">
                                                        <span>Title</span>
                                                        <input
                                                            type="text"
                                                            value={
                                                                s.props
                                                                    .title || ""
                                                            }
                                                            onChange={(e) =>
                                                                updateSection(
                                                                    s.id,
                                                                    {
                                                                        title: e
                                                                            .target
                                                                            .value,
                                                                    }
                                                                )
                                                            }
                                                            className="rounded border border-neutral-300 px-2 py-1 text-xs"
                                                        />
                                                    </label>
                                                    <label className="flex flex-col gap-1">
                                                        <span>Body</span>
                                                        <textarea
                                                            value={
                                                                s.props
                                                                    .body || ""
                                                            }
                                                            onChange={(e) =>
                                                                updateSection(
                                                                    s.id,
                                                                    {
                                                                        body: e
                                                                            .target
                                                                            .value,
                                                                    }
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
                                                                s.props
                                                                    .title || ""
                                                            }
                                                            onChange={(e) =>
                                                                updateSection(
                                                                    s.id,
                                                                    {
                                                                        title: e
                                                                            .target
                                                                            .value,
                                                                    }
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
                                                                s.props
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
                                                                    }
                                                                )
                                                            }
                                                            className="rounded border border-neutral-300 px-2 py-1 text-xs w-16"
                                                        />
                                                    </label>
                                                </div>
                                            )}
                                        </div>
                                    ))}
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
                                    currentPageId={activePage?.id || undefined}
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
