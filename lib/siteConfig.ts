// lib/siteConfig.ts

// High-level theme tokens. Users only choose from safe knobs.
export type FontSizeToken = "xs" | "sm" | "base" | "lg" | "xl" | "2xl";
export type FontWeightToken = "normal" | "medium" | "semibold" | "bold";

export type ThemeTokens = {
    primaryColor: string;
    accentColor: string;
    bgColor: string;
    fontScaleBody: FontSizeToken;
    fontScaleHeading: FontSizeToken;
    headingWeight: FontWeightToken;
    bodyWeight: FontWeightToken;
    radiusScale: number;
    fontFamily?: "system" | "inter" | "outfit";
};

// Internal vs external link targets, no raw href strings in components
export type LinkTarget =
    | { kind: "none" }
    | { kind: "internal"; pageId: string; hash?: string | null }
    | { kind: "external"; url: string };


export type HeroSection = {
    type: "hero";
    id: string;
    props: HeroSectionProps;
};

export type TextSection = {
    type: "text";
    id: string;
    props: TextSectionProps;
};

export type GridSection = {
    type: "grid";
    id: string;
    props: GridSectionProps;
};

// NEW: header section
export type HeaderLink = {
    id: string;
    label: string;
    target: LinkTarget;
    emphasis?: boolean; // e.g. primary CTA
};

export type HeaderSectionProps = {
    logoText?: string;
    logoSubtext?: string;
    links: HeaderLink[];
    align?: "left" | "center" | "spread"; // spread = nav links spread between logo and ctas
    sticky?: boolean;
};

export type HeroSectionProps = {
    badge?: string;
    title: string;
    subtitle?: string;
    primaryCta?: {
        label: string;
        target: LinkTarget;
        variant?: "solid" | "outline" | "ghost";
    };
    secondaryCta?: {
        label: string;
        target: LinkTarget;
    };
    layout?: "centered" | "split" | "left";
    align?: "left" | "center";
};

export type TextSectionProps = {
    title: string;
    body: string;
    alignment: "left" | "center" | "right";
    titleSize?: FontSizeToken;
    bodySize?: FontSizeToken;
    titleWeight?: FontWeightToken;
    bodyWeight?: FontWeightToken;
};

export type GridItem = {
    id: string;
    title: string;
    label?: string;
    iconKey?: string;
    highlight?: boolean;
};

export type GridSectionProps = {
    title: string;
    layoutHint?: "cards" | "list";
    columns?: number;
    items: GridItem[];
};

export type Section =
    | { type: "header"; id: string; props: HeaderSectionProps }
    | { type: "hero"; id: string; props: HeroSectionProps }
    | { type: "text"; id: string; props: TextSectionProps }
    | { type: "grid"; id: string; props: GridSectionProps };

export type PageConfig = {
    id: string;
    slug: string;
    title: string;
    navLabel?: string;
    isHome?: boolean;
    sections: Section[];
};

export type SiteConfig = {
    id: string;
    name: string;
    theme: ThemeTokens;
    pages: PageConfig[];
};


// If you already have a safeSiteConfig, keep it but make sure it returns SiteConfig
export function safeSiteConfig(raw: unknown): SiteConfig {
    // plug in your zod or runtime validation here
    return raw as SiteConfig;
}
