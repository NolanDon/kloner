// components/site/TextSection.tsx
"use client";

import React from "react";
import type { TextSectionProps } from "@/lib/siteConfig";

type Props = {
    sectionId: string;
    props: TextSectionProps;
    editing?: boolean;
    onEdit?: (patch: Partial<TextSectionProps>) => void;
};

export function TextSection({ sectionId, props, editing, onEdit }: Props) {
    const { title, body, alignment } = props;

    if (!editing) {
        return (
            <section
                className={`text-section ${alignment === "center"
                        ? "text-center"
                        : alignment === "right"
                            ? "text-right"
                            : "text-left"
                    }`}
            >
                <h2>{title}</h2>
                <p>{body}</p>
            </section>
        );
    }

    // Inline editor mode
    return (
        <section
            className={`text-section relative ${alignment === "center"
                    ? "text-center"
                    : alignment === "right"
                        ? "text-right"
                        : "text-left"
                }`}
        >
            <div className="absolute -top-2 right-0 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-white">
                Text block
            </div>

            <input
                type="text"
                value={title || ""}
                onChange={(e) =>
                    onEdit?.({
                        title: e.target.value,
                    })
                }
                className="w-full bg-transparent border border-white/10 rounded-md px-2 py-1 mb-2 text-sm"
                placeholder="Section title"
            />
            <textarea
                value={body || ""}
                onChange={(e) =>
                    onEdit?.({
                        body: e.target.value,
                    })
                }
                className="w-full bg-transparent border border-white/10 rounded-md px-2 py-1 text-xs min-h-[80px]"
                placeholder="Section body"
            />
        </section>
    );
}
