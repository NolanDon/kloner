// components/site/TextSection.tsx
"use client";

import type { TextSectionProps } from "@/lib/siteConfig";

type Props = {
    sectionId: string;
    props: TextSectionProps;
};

export function TextSection({ sectionId, props }: Props) {
    const { title, body, alignment } = props;

    const alignClass =
        alignment === "center"
            ? "text-center items-center"
            : alignment === "right"
                ? "text-right items-end"
                : "text-left items-start";

    return (
        <section
            id={sectionId}
            className="section text-section flex justify-center py-16"
        >
            <div
                className={`text-section-inner flex flex-col gap-4 max-w-3xl ${alignClass}`}
            >
                <h2 className="text-section-title text-2xl md:text-3xl font-semibold">
                    {title}
                </h2>
                <p className="text-section-body text-base leading-relaxed text-[color:var(--color-body)] whitespace-pre-line">
                    {body}
                </p>
            </div>
        </section>
    );
}
