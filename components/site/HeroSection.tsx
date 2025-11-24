"use client";

import React from "react";
import type { LinkTarget } from "@/lib/siteConfig";

type HeroSectionProps = {
    sectionId: string;
    props: any;
    resolveHref: (target: LinkTarget) => string;
};

export function HeroSection({ sectionId, props, resolveHref }: HeroSectionProps) {
    const {
        kicker,
        title,
        subtitle,
        primaryCta,
        secondaryCta,
        align,
    } = props || {};

    const alignValue = (align || "center") as "left" | "center" | "right";
    const alignClass =
        alignValue === "left"
            ? "items-start text-left"
            : alignValue === "right"
                ? "items-end text-right"
                : "items-center text-center";

    const renderHtml = (value?: string, className?: string) =>
        value ? (
            <div
                className={className}
                dangerouslySetInnerHTML={{ __html: value }}
            />
        ) : null;

    const primaryHref =
        primaryCta && primaryCta.target
            ? resolveHref(primaryCta.target)
            : "#";
    const secondaryHref =
        secondaryCta && secondaryCta.target
            ? resolveHref(secondaryCta.target)
            : "#";

    return (
        <section
            id={sectionId}
            className={`hero-root flex flex-col gap-3 md:gap-4 ${alignClass}`}
        >
            {renderHtml(kicker, "hero-kicker")}
            {renderHtml(title, "hero-title")}
            {renderHtml(subtitle, "hero-subtitle")}

            {(primaryCta?.label || secondaryCta?.label) && (
                <div className="hero-cta-row">
                    {primaryCta?.label && (
                        <a
                            href={primaryHref}
                            className="hero-btn hero-btn--primary"
                            data-allow-interaction
                        >
                            {primaryCta.label}
                        </a>
                    )}
                    {secondaryCta?.label && (
                        <a
                            href={secondaryHref}
                            className="hero-btn hero-btn--secondary"
                            data-allow-interaction
                        >
                            {secondaryCta.label}
                        </a>
                    )}
                </div>
            )}
        </section>
    );
}
