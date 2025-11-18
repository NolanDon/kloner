// components/site/HeroSection.tsx
"use client";

import type { HeroSectionProps, LinkTarget } from "@/lib/siteConfig";

type Props = {
    sectionId: string;
    props: HeroSectionProps;
    resolveHref?: (t: LinkTarget) => string;
};

export function HeroSection({ sectionId, props, resolveHref }: Props) {
    const {
        badge,
        title,
        subtitle,
        primaryCta,
        secondaryCta,
        layout = "centered",
        align = "center",
    } = props;

    const layoutClass =
        layout === "split"
            ? "md:grid md:grid-cols-2 md:gap-12 items-center"
            : "flex flex-col";

    const textAlignClass =
        align === "left" ? "text-left items-start" : "text-center items-center";

    const primaryHref =
        primaryCta && resolveHref
            ? resolveHref(primaryCta.target)
            : primaryCta && primaryCta.target.kind === "external"
                ? primaryCta.target.url
                : "#";

    const secondaryHref =
        secondaryCta && resolveHref
            ? resolveHref(secondaryCta.target)
            : secondaryCta && secondaryCta.target.kind === "external"
                ? secondaryCta.target.url
                : "#";

    const primaryVariant = primaryCta?.variant || "solid";

    const primaryClasses =
        primaryVariant === "solid"
            ? "bg-[color:var(--color-primary)] text-white"
            : primaryVariant === "outline"
                ? "border border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-transparent"
                : "text-[color:var(--color-primary)] bg-transparent";

    return (
        <section
            id={sectionId}
            className="section site-hero py-16"
        >
            <div className={`site-hero-inner ${layoutClass} gap-8`}>
                <div className={`flex flex-col gap-4 ${textAlignClass}`}>
                    {badge ? (
                        <div className="hero-badge text-[11px] tracking-wide uppercase text-[color:var(--color-primary)]">
                            {badge}
                        </div>
                    ) : null}

                    <h1 className="hero-heading-main text-4xl md:text-5xl font-semibold">
                        {title}
                    </h1>

                    {subtitle ? (
                        <p className="hero-subtitle max-w-2xl text-base md:text-lg text-[color:var(--color-body)]">
                            {subtitle}
                        </p>
                    ) : null}

                    {(primaryCta || secondaryCta) && (
                        <div className="mt-4 flex flex-wrap gap-3">
                            {primaryCta ? (
                                <a
                                    href={primaryHref}
                                    className={`hero-cta inline-flex items-center justify-center px-6 py-3 text-xs font-medium rounded-full ${primaryClasses}`}
                                    style={{
                                        borderRadius: "var(--radius-base)",
                                    }}
                                >
                                    {primaryCta.label}
                                </a>
                            ) : null}
                            {secondaryCta ? (
                                <a
                                    href={secondaryHref}
                                    className="inline-flex items-center justify-center px-6 py-3 text-xs font-medium rounded-full border border-black/10 text-neutral-800 bg-white/80 hover:bg-white"
                                    style={{
                                        borderRadius: "var(--radius-base)",
                                    }}
                                >
                                    {secondaryCta.label}
                                </a>
                            ) : null}
                        </div>
                    )}
                </div>

                {layout === "split" && (
                    <div className="mt-8 md:mt-0">
                        {/* simple placeholder for hero media */}
                        <div className="w-full h-56 md:h-64 rounded-2xl bg-white/40 border border-black/5" />
                    </div>
                )}
            </div>
        </section>
    );
}
