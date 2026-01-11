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

const defaultThemeCss = `
.site-root {
  color: var(--color-body);
  font-family: var(--font-family-base);
}

/* Header / nav */
.header-root .site-name {
  color: var(--color-body);
}
.nav-link {
  color: var(--color-body);
}
.nav-link--active {
  background-color: var(--color-primary);
  color: #ffffff;
}
.nav-right .auth-btn.login,
.mobile-auth-btn {
  border: 1px solid color-mix(in srgb, var(--color-primary) 40%, #d4d4d4);
  color: var(--color-body);
  background-color: #ffffff;
}
.nav-right .auth-btn.signup,
.mobile-auth-btn--primary {
  background-color: var(--color-primary);
  color: #ffffff;
}

/* Footer */
.footer-root {
  color: color-mix(in srgb, var(--color-body) 85%, #000000);
}
.footer-link {
  color: inherit;
}

/* Hero */
.hero-root {
  max-width: 56rem;
  margin-left: auto;
  margin-right: auto;
}
.hero-kicker {
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--color-accent) 80%, #6b7280);
}
.hero-title {
  font-size: clamp(2.5rem, var(--font-scale-heading), 3.5rem);
  font-weight: var(--font-weight-heading);
}
.hero-subtitle {
  margin-top: 0.75rem;
  font-size: clamp(0.9rem, var(--font-scale-body), 1.05rem);
  color: color-mix(in srgb, var(--color-body) 70%, #00000022);
}
.hero-cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.5rem;
}
.hero-btn {
  border-radius: 999px;
  padding: 0.55rem 1.4rem;
  font-size: 0.85rem;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
}
.hero-btn--primary {
  background-color: var(--color-primary);
  color: #ffffff;
}
.hero-btn--secondary {
  border-color: color-mix(in srgb, var(--color-primary) 45%, #e5e5e5);
  color: var(--color-body);
  background-color: #ffffff;
}

/* Generic buttons usable anywhere in HTML content */
.btn,
.button {
  border-radius: 999px;
  padding: 0.5rem 1.2rem;
  font-size: 0.85rem;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.btn-primary,
.button-primary {
  background-color: var(--color-primary);
  color: #ffffff;
}
.btn-secondary,
.button-secondary {
  border: 1px solid color-mix(in srgb, var(--color-primary) 45%, #e5e5e5);
  color: var(--color-body);
  background-color: #ffffff;
}

/* Sections */
.section-shell {
  max-width: 60rem;
  margin-left: auto;
  margin-right: auto;
}
`;


type ViewportMode = "mobile" | "tablet" | "desktop";

type SectionAlign = "left" | "center" | "right";


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
    viewportMode?: ViewportMode;
};

type HeaderProps = {
    pages: PageConfig[];
    currentPageId: string;
    siteName: string;
    siteId?: string;
    viewportMode?: ViewportMode;
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

function SiteHeader({
    pages,
    currentPageId,
    siteName,
    siteId,
    viewportMode,
}: HeaderProps) {
    const [mobileOpen, setMobileOpen] = React.useState(false);

    const handleNavClick = () => {
        if (mobileOpen) setMobileOpen(false);
    };

    const desktopBase = "items-center gap-3";
    const mobileBase =
        "flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-900 shadow-sm";

    const desktopNavClass = viewportMode
        ? `${viewportMode === "mobile" ? "hidden" : "flex"} ${desktopBase}`
        : `hidden md:flex ${desktopBase}`;

    const mobileButtonClass = viewportMode
        ? `${viewportMode === "mobile" ? "inline-flex" : "hidden"} ${mobileBase}`
        : `inline-flex md:hidden ${mobileBase}`;

    const mobileMenuClass = viewportMode
        ? `${viewportMode === "mobile" ? "block" : "hidden"
        } absolute left-0 right-0 top-full z-30 mt-2 rounded-2xl border border-neutral-200 bg-white shadow-lg overflow-hidden`
        : "absolute left-0 right-0 top-full z-30 mt-2 rounded-2xl border border-neutral-200 bg-white shadow-lg overflow-hidden md:hidden";

    const visiblePages = pages.filter((p) => !(p as any).hiddenInNav);

    return (
        <header className="header-root relative flex items-center justify-between py-3 md:py-4">
            <div className="flex min-w-0 items-center gap-2">
                <div className="relative h-7 w-7 shrink-0">
                    <Image
                        src="/images/logo.png"
                        alt={siteName}
                        fill
                        className="object-contain"
                    />
                </div>
                <span className="site-name truncate text-sm font-semibold">
                    {siteName}
                </span>
            </div>

            <nav className={desktopNavClass}>
                <div className="flex flex-wrap items-center gap-1">
                    {visiblePages.map((p) => {
                        const active = p.id === currentPageId;
                        return (
                            <a
                                key={p.id}
                                href={buildPageHref(p, siteId)}
                                className={[
                                    "nav-link px-3 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap",
                                    active ? "nav-link--active" : "",
                                ].join(" ")}
                            >
                                {p.navLabel || p.title || p.slug}
                            </a>
                        );
                    })}
                </div>
                <div className="nav-right ml-4 flex items-center gap-2">
                    <button
                        type="button"
                        className="auth-btn login rounded-full px-3 py-1 text-xs"
                    >
                        Log in
                    </button>
                    <button
                        type="button"
                        className="auth-btn signup rounded-full px-3 py-1 text-xs font-semibold"
                    >
                        Sign up
                    </button>
                </div>
            </nav>

            <button
                type="button"
                onClick={() => setMobileOpen((v) => !v)}
                className={mobileButtonClass}
                aria-label="Toggle navigation"
                aria-expanded={mobileOpen}
                data-allow-interaction
            >
                <span className="sr-only">Toggle navigation</span>
                <span className="flex flex-col items-center justify-center gap-[3px]">
                    <span className="block h-[2px] w-4 rounded-full bg-current" />
                    <span className="block h-[2px] w-4 rounded-full bg-current" />
                    <span className="block h-[2px] w-4 rounded-full bg-current" />
                </span>
            </button>

            {mobileOpen && (
                <div className={mobileMenuClass}>
                    <nav className="flex flex-col divide-y divide-neutral-100 text-sm">
                        {visiblePages.map((p) => {
                            const active = p.id === currentPageId;
                            return (
                                <a
                                    key={p.id}
                                    href={buildPageHref(p, siteId)}
                                    onClick={handleNavClick}
                                    className={[
                                        "mobile-nav-link flex items-center justify-between px-4 py-3",
                                        active
                                            ? "mobile-nav-link--active"
                                            : "hover:bg-neutral-50",
                                    ].join(" ")}
                                >
                                    <span>
                                        {p.navLabel || p.title || p.slug}
                                    </span>
                                    {active && (
                                        <span className="mobile-nav-current text-[10px] uppercase tracking-[0.16em]">
                                            Current
                                        </span>
                                    )}
                                </a>
                            );
                        })}
                        <div className="flex items-center gap-2 px-4 py-3">
                            <button
                                type="button"
                                className="mobile-auth-btn flex-1 rounded-full border px-3 py-2 text-xs"
                                onClick={handleNavClick}
                            >
                                Log in
                            </button>
                            <button
                                type="button"
                                className="mobile-auth-btn mobile-auth-btn--primary flex-1 rounded-full px-3 py-2 text-xs font-semibold"
                                onClick={handleNavClick}
                            >
                                Sign up
                            </button>
                        </div>
                    </nav>
                </div>
            )}
        </header>
    );
}

function SiteFooter({ pages, siteName, siteId }: FooterProps) {
    const year = new Date().getFullYear();
    return (
        <footer className="footer-root mt-10 border-t border-neutral-200 pt-6 pb-4 text-center text-xs">
            <div className="mb-3 flex flex-wrap items-center justify-center gap-3">
                {pages.map((p) => (
                    <a
                        key={p.id}
                        href={buildPageHref(p, siteId)}
                        className="footer-link text-[11px]"
                    >
                        {p.navLabel || p.title || p.slug}
                    </a>
                ))}
            </div>
            <div className="copyright">
                © {year} {siteName}. All rights reserved.
            </div>
            <div className="mt-1">
                Built with{" "}
                <a
                    href="https://kloner.app"
                    target="_blank"
                    rel="noreferrer"
                    className="footer-made-by font-medium underline-offset-2 hover:underline"
                >
                    Kloner.app
                </a>
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
    selectedSectionId,
    onSelectSection,
    viewportMode,
}: Props) {
    const { theme, pages } = config;

    const pagesSafe = pages ?? [];

    const pagesById = React.useMemo(
        () => new Map(pagesSafe.map((p) => [p.id, p] as const)),
        [pagesSafe]
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

    if (pagesSafe.length === 0) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-neutral-100 text-sm text-neutral-500">
                No pages defined for this site.
            </div>
        );
    }

    const currentPageFromId =
        currentPageId ? pagesSafe.find((p) => p.id === currentPageId) : undefined;
    const currentPageFromSlug =
        !currentPageFromId && pageSlug
            ? pagesSafe.find((p) => p.slug === pageSlug)
            : undefined;
    const currentPage =
        currentPageFromId ||
        currentPageFromSlug ||
        pagesSafe.find((p) => p.isHome) ||
        pagesSafe[0];

    const baseFontFamily =
        config.theme.fontFamily ||
        "-apple-system, system-ui, BlinkMacSystemFont, 'Segoe UI', sans-serif";

    const cssVars: React.CSSProperties = {
        ["--color-primary" as any]: theme.primaryColor,
        ["--color-accent" as any]: theme.accentColor,
        ["--color-bg" as any]: theme.bgColor,
        ["--color-body" as any]: "#555555",
        ["--radius-base" as any]: `${theme.radiusScale * 10}px`,
        ["--font-scale-heading" as any]: theme.fontScaleHeading,
        ["--font-scale-body" as any]: theme.fontScaleBody,
        ["--font-weight-heading" as any]: theme.headingWeight || "bold",
        ["--font-weight-body" as any]: theme.bodyWeight || "normal",
        ["--font-family-base" as any]: baseFontFamily,
    };

    const renderCoreSection = (section: Section) => {
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

    const renderSectionShell = (section: Section) => {
        const spacing = ((section as any).spacing ||
            "normal") as "none" | "tight" | "normal" | "loose";
        const archived = !!(section as any).archived;
        const align = ((section as any).align ||
            "center") as SectionAlign;

        if (archived && disableNavigation) {
            return null;
        }

        const padClass =
            spacing === "none"
                ? "py-0"
                : spacing === "tight"
                    ? "py-6"
                    : spacing === "loose"
                        ? "py-16"
                        : "py-10";

        const alignClass =
            align === "left"
                ? "text-left items-start"
                : align === "right"
                    ? "text-right items-end"
                    : "text-center items-center";

        const isSelected = selectedSectionId === section.id;

        const handleClick: React.MouseEventHandler<HTMLDivElement> =
            disableNavigation && onSelectSection
                ? (e) => {
                    const target = e.target as HTMLElement | null;
                    const allowed =
                        target?.closest("[data-allow-interaction]");
                    if (allowed) return;
                    e.stopPropagation();
                    onSelectSection(section.id);
                }
                : () => { };

        return (
            <section
                key={section.id}
                data-section-id={section.id}
                className={`section-shell relative ${padClass} ${alignClass} transition-all ${disableNavigation && isSelected
                        ? "ring-2 ring-offset-2 ring-indigo-500 ring-offset-[color:var(--color-bg)]"
                        : ""
                    }`}
                onClick={handleClick}
            >
                {renderCoreSection(section)}
            </section>
        );
    };

    const handleClickCapture: React.MouseEventHandler<HTMLDivElement> = (e) => {
        if (!disableNavigation) return;
        const target = e.target as HTMLElement | null;
        if (!target) return;

        const allowed = target.closest("[data-allow-interaction]");
        if (allowed) return;

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

    const visibleSections = currentPage.sections.filter(
        (s) => !(s as any).archived
    );

    return (
        <div
            className="site-root relative min-h-screen bg-[color:var(--color-bg)]"
            style={{ ...cssVars, fontFamily: baseFontFamily }}
            onClickCapture={handleClickCapture}
            onSubmitCapture={handleSubmitCapture}
        >
            <style
                dangerouslySetInnerHTML={{ __html: defaultThemeCss }}
                suppressHydrationWarning
            />
            {overridesCss ? (
                <style
                    dangerouslySetInnerHTML={{ __html: overridesCss }}
                    suppressHydrationWarning
                />
            ) : null}


            <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-8 md:py-8">
                <SiteHeader
                    pages={pages}
                    currentPageId={currentPage.id}
                    siteName={config.name || "SiteName"}
                    siteId={siteId}
                    viewportMode={viewportMode}
                />

                <main className="relative mt-4 min-h-[320px] md:mt-6">
                    {isCurrentPageEmpty && disableNavigation && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <div className="rounded-lg bg-black/55 px-4 py-2 text-[11px] text-neutral-200 shadow-lg">
                                This page has no sections yet. Use the sidebar
                                to add blocks.
                            </div>
                        </div>
                    )}

                    {visibleSections.map(renderSectionShell)}
                </main>

                <SiteFooter
                    pages={pages}
                    siteName={config.name || "SiteName"}
                    siteId={siteId}
                />
            </div>
        </div>
    );
}
