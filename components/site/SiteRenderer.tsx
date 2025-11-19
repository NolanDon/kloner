// components/site/SiteRenderer.tsx
"use client";

import React from "react";
import Image from "next/image";
import type {
    SiteConfig,
    Section,
    LinkTarget,
    PageConfig,
} from "@/lib/siteConfig";
import { HeroSection } from "./HeroSection";
import { TextSection } from "./TextSection";
import { GridSection } from "./GridSection";

type Props = {
    config: SiteConfig;
    overridesCss?: string;
    siteId?: string;
    pageSlug?: string;
    disableNavigation?: boolean;
    currentPageId?: string;
    selectedSectionId?: string | null;
    onSelectSection?: (id: string) => void;
    onEditSection?: (id: string, patch: Partial<Section["props"]>) => void;
};


type HeaderProps = {
    pages: PageConfig[];
    currentPageId: string;
    siteName: string;
    siteId?: string;
};

type FooterProps = {
    pages: PageConfig[];
    siteName: string;
    siteId?: string;
};

function buildPageHref(page: PageConfig, siteId?: string) {
    const isHome = page.slug === "home" || page.isHome;
    if (siteId) {
        return isHome ? `/site/${siteId}` : `/site/${siteId}/${page.slug}`;
    }
    return isHome ? "/" : `/${page.slug}`;
}

function SiteHeader({ pages, currentPageId, siteName, siteId }: HeaderProps) {
    return (
        <header className="header-root flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                    <div className="relative h-7 w-7">
                        <Image
                            src="/images/logo.png"
                            alt={siteName}
                            fill
                            className="object-contain"
                        />
                    </div>
                    <span className="text-sm font-semibold">{siteName}</span>
                </div>
            </div>
            <nav className="flex items-center gap-1">
                <div className="flex items-center">
                    {pages.map((p) => (
                        <a
                            key={p.id}
                            href={buildPageHref(p, siteId)}
                            className={
                                "nav-link" +
                                (p.id === currentPageId ? " nav-link--active" : "")
                            }
                        >
                            {p.navLabel || p.title || p.slug}
                        </a>
                    ))}
                </div>
                <div className="nav-right flex items-center gap-2 ml-3">
                    <button
                        type="button"
                        className="auth-btn login text-xs"
                    >
                        Log in
                    </button>
                    <button
                        type="button"
                        className="auth-btn signup text-xs"
                    >
                        Sign up
                    </button>
                </div>
            </nav>
        </header>
    );
}

function SiteFooter({ pages, siteName, siteId }: FooterProps) {
    const year = new Date().getFullYear();
    return (
        <footer className="footer-root">
            <div className="mb-4 flex flex-wrap items-center justify-center gap-4">
                <div className="flex flex-wrap items-center justify-center gap-3">
                    {pages.map((p) => (
                        <a
                            key={p.id}
                            href={buildPageHref(p, siteId)}
                            className="nav-link text-xs"
                        >
                            {p.navLabel || p.title || p.slug}
                        </a>
                    ))}
                </div>
            </div>
            <div className="copyright">
                <div>
                    © {year} {siteName}. All rights reserved.
                </div>
                <div className="mt-1">
                    Built with{" "}
                    <a
                        href="https://kloner.app"
                        target="_blank"
                        rel="noreferrer"
                        className="nav-link text-xs"
                    >
                        Kloner.app
                    </a>
                </div>
            </div>
        </footer>
    );
}

export function SiteRenderer({
    config,
    overridesCss,
    siteId,
    pageSlug,
    disableNavigation,
    currentPageId,
}: Props) {
    const { theme, pages } = config;

    if (!pages || pages.length === 0) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-neutral-100 text-sm text-neutral-500">
                No pages defined for this site.
            </div>
        );
    }

    // page selection priority:
    // 1) explicit currentPageId (editor)
    // 2) pageSlug (public /site/[siteId]/[pageSlug])
    // 3) isHome
    // 4) first page
    const currentPageFromId =
        currentPageId ? pages.find((p) => p.id === currentPageId) : undefined;
    const currentPageFromSlug =
        !currentPageFromId && pageSlug
            ? pages.find((p) => p.slug === pageSlug)
            : undefined;
    const currentPage =
        currentPageFromId ||
        currentPageFromSlug ||
        pages.find((p) => p.isHome) ||
        pages[0];

    const pagesById = React.useMemo(
        () => new Map(pages.map((p) => [p.id, p] as const)),
        [pages]
    );

    const resolveHref = React.useCallback(
        (target: LinkTarget): string => {
            if (disableNavigation) return "#";

            if (!target || target.kind === "none") return "#";

            if (target.kind === "external") {
                return target.url || "#";
            }

            const page = pagesById.get(target.pageId);
            if (!page) return "#";

            const href = buildPageHref(page, siteId);
            return target.hash ? `${href}#${target.hash}` : href;
        },
        [pagesById, siteId, disableNavigation]
    );

    const cssVars: React.CSSProperties = {
        ["--color-primary" as any]: theme.primaryColor,
        ["--color-accent" as any]: theme.accentColor,
        ["--color-bg" as any]: theme.bgColor,
        ["--color-body" as any]: "#555555",
        ["--radius-base" as any]: `${theme.radiusScale * 10}px`,
        ["--font-scale-heading" as any]: theme.fontScaleHeading,
        ["--font-scale-body" as any]: theme.fontScaleBody,
    };

    const renderSection = (section: Section) => {
        switch (section.type) {
            case "hero":
                return (
                    <HeroSection
                        key={section.id}
                        sectionId={section.id}
                        props={section.props}
                        resolveHref={resolveHref}
                    />
                );
            case "text":
                return (
                    <TextSection
                        key={section.id}
                        sectionId={section.id}
                        props={section.props}
                    />
                );
            case "grid":
                return (
                    <GridSection
                        key={section.id}
                        sectionId={section.id}
                        props={section.props}
                    />
                );
            default:
                return null;
        }
    };

    // Block interactions in editor preview
    const handleClickCapture: React.MouseEventHandler<HTMLDivElement> = (e) => {
        if (!disableNavigation) return;
        const target = e.target as HTMLElement | null;
        if (!target) return;
        const interactive = target.closest("a,button,[role='button'],form");
        if (interactive) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    const handleSubmitCapture: React.FormEventHandler<HTMLDivElement> = (e) => {
        if (!disableNavigation) return;
        e.preventDefault();
        e.stopPropagation();
    };

    const isCurrentPageEmpty =
        !currentPage.sections || currentPage.sections.length === 0;

    return (
        <div
            className="site-root min-h-screen bg-[color:var(--color-bg)] relative"
            style={cssVars}
            onClickCapture={handleClickCapture}
            onSubmitCapture={handleSubmitCapture}
        >
            {overridesCss ? (
                <style
                    dangerouslySetInnerHTML={{ __html: overridesCss }}
                    suppressHydrationWarning
                />
            ) : null}

            <div className="w-full max-w-6xl mx-auto px-5 md:px-8 lg:px-10 py-6 md:py-8">
                <SiteHeader
                    pages={pages}
                    currentPageId={currentPage.id}
                    siteName={config.name || "SiteName"}
                    siteId={siteId}
                />

                <main className="mt-4 md:mt-6 relative min-h-[320px]">
                    {isCurrentPageEmpty && disableNavigation && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <div className="rounded-lg bg-black/55 px-4 py-2 text-[11px] text-neutral-200 shadow-lg">
                                This page has no sections yet. Use the sidebar to add blocks.
                            </div>
                        </div>
                    )}

                    {currentPage.sections.map(renderSection)}
                </main>

                <SiteFooter
                    pages={pages}
                    siteName={config.name || "SiteName"}
                    siteId={siteId}
                />
            </div>

            {siteId && !disableNavigation && (
                <a
                    href={`/site/${siteId}/edit`}
                    className="
                        fixed
                        bottom-6 right-6
                        z-50
                        flex items-center gap-3
                        rounded-full
                        px-5 py-3
                        shadow-xl shadow-black/20
                        bg-[#f55f2a]
                        text-white text-sm font-semibold
                        border border-black/10
                        hover:scale-[1.02]
                        active:scale-[0.99]
                        transition-transform
                    "
                >
                    <span className="relative h-7 w-7 shrink-0">
                        <Image
                            src="/images/logo.png"
                            alt="Kloner"
                            fill
                            className="object-contain"
                        />
                    </span>
                    <span>Edit this page in Kloner</span>
                </a>
            )}
        </div>
    );
}
