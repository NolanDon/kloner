// components/site/GridSection.tsx
"use client";

import type { GridSectionProps } from "@/lib/siteConfig";

type Props = {
    sectionId: string;
    props: GridSectionProps;
};

export function GridSection({ sectionId, props }: Props) {
    const { title, layoutHint = "cards", columns = 3, items } = props;

    const isCards = layoutHint !== "list";

    const gridCols =
        columns <= 1
            ? "grid-cols-1"
            : columns === 2
                ? "grid-cols-1 md:grid-cols-2"
                : columns === 3
                    ? "grid-cols-1 md:grid-cols-3"
                    : "grid-cols-1 md:grid-cols-4";

    return (
        <section
            id={sectionId}
            className="section grid-section flex flex-col gap-6 py-16"
        >
            <div className="max-w-5xl mx-auto w-full">
                <h2 className="grid-section-title text-2xl font-semibold mb-2">
                    {title}
                </h2>

                <div
                    className={
                        isCards
                            ? `mt-4 grid gap-6 ${gridCols}`
                            : "mt-4 flex flex-col divide-y divide-black/5"
                    }
                >
                    {items.map((item) =>
                        isCards ? (
                            <article
                                key={item.id}
                                className="grid-card flex flex-col gap-2 rounded-xl border border-black/5 bg-white/80 px-4 py-3"
                                style={{
                                    borderRadius: "var(--radius-base)",
                                    boxShadow: item.highlight
                                        ? "0 10px 35px rgba(0,0,0,0.08)"
                                        : "none",
                                }}
                            >
                                <div className="flex items-center gap-2">
                                    {/* iconKey slot later if you want */}
                                    <h3 className="text-sm font-semibold">
                                        {item.title}
                                    </h3>
                                </div>
                                {item.label ? (
                                    <p className="text-xs text-[color:var(--color-body)]">
                                        {item.label}
                                    </p>
                                ) : null}
                            </article>
                        ) : (
                            <article
                                key={item.id}
                                className="grid-row py-3 flex flex-col gap-1"
                            >
                                <h3 className="text-xs font-medium">
                                    {item.title}
                                </h3>
                                {item.label ? (
                                    <p className="text-[11px] text-[color:var(--color-body)]">
                                        {item.label}
                                    </p>
                                ) : null}
                            </article>
                        )
                    )}
                </div>
            </div>
        </section>
    );
}
