"use client";

import React from "react";

type TextSectionProps = {
    sectionId: string;
    props: any;
};

export function TextSection({ sectionId, props }: TextSectionProps) {
    const { title, body, align } = props || {};
    const alignValue = (align || "left") as "left" | "center" | "right";

    const alignClass =
        alignValue === "center"
            ? "text-center"
            : alignValue === "right"
                ? "text-right"
                : "text-left";

    return (
        <section
            id={sectionId}
            className={`text-section flex flex-col gap-3 ${alignClass}`}
        >
            {title && (
                <h2
                    className="text-section-title text-[length:var(--font-scale-heading)] font-[var(--font-weight-heading)]"
                    dangerouslySetInnerHTML={{ __html: title }}
                />
            )}
            {body && (
                <div
                    className="text-section-body text-[length:var(--font-scale-body)] font-[var(--font-weight-body)] leading-relaxed space-y-3"
                    dangerouslySetInnerHTML={{ __html: body }}
                />
            )}
        </section>
    );
}
