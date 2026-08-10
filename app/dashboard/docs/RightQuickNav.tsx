// app/dashboard/docs/RightQuickNav.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";

type NavItem = {
    id: string;
    label: string;
};

export function RightQuickNav() {
    const items: NavItem[] = useMemo(
        () => [
            { id: "features", label: "Features" },
            { id: "credits", label: "Credit system" },
            { id: "plans", label: "Payment plans" },
            { id: "compare", label: "Compare" },
            { id: "safety", label: "Safety" },
            { id: "export-options", label: "Library" },
            { id: "about", label: "About" },
            { id: "partnerships", label: "Partnerships" },
            { id: "connect", label: "Connect" },
            { id: "quick-start", label: "Quick start" },
        ],
        [],
    );

    const [activeId, setActiveId] = useState<string>("features");
    const activeLockRef = useRef(false);
    const lockTimerRef = useRef<number | null>(null);

    useEffect(() => {
        const ids = items.map((x) => x.id);
        const els = ids
            .map((id) => document.getElementById(id))
            .filter(Boolean) as HTMLElement[];

        if (!els.length) return;

        const io = new IntersectionObserver(
            (entries) => {
                if (activeLockRef.current) return;

                const visible = entries
                    .filter((e) => e.isIntersecting)
                    .sort((a, b) => (b.intersectionRatio ?? 0) - (a.intersectionRatio ?? 0));

                if (visible[0]?.target?.id) {
                    setActiveId(visible[0].target.id);
                }
            },
            {
                root: null,
                threshold: [0.15, 0.25, 0.4, 0.6],
                rootMargin: "-15% 0px -70% 0px",
            },
        );

        els.forEach((el) => io.observe(el));

        return () => {
            io.disconnect();
            if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current);
        };
    }, [items]);

    const jumpTo = (id: string) => {
        const el = document.getElementById(id);
        if (!el) return;

        activeLockRef.current = true;
        setActiveId(id);

        // keep hash in URL without forcing a hard jump
        if (typeof window !== "undefined") {
            window.history.pushState(null, "", `#${id}`);
        }

        el.scrollIntoView({ behavior: "smooth", block: "start" });

        el.classList.add("anchor-highlight");
        window.setTimeout(() => el.classList.remove("anchor-highlight"), 1800);

        if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current);
        lockTimerRef.current = window.setTimeout(() => {
            activeLockRef.current = false;
        }, 700);
    };

    return (
        <aside className="hidden lg:block">
            <div className="sticky top-[92px]">
                <div className="rounded-2xl border border-neutral-200 bg-white/90 shadow-sm backdrop-blur px-3 py-3">
                    <div className="flex items-center justify-between gap-2 px-1 pb-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                            On this page
                        </p>
                        <span className="text-[10px] text-neutral-400">Jump</span>
                    </div>

                    <nav className="flex flex-col gap-1">
                        {items.map((it) => {
                            const isActive = activeId === it.id;

                            return (
                                <Link
                                    key={it.id}
                                    href={`#${it.id}`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        jumpTo(it.id);
                                    }}
                                    className={[
                                        "group relative flex items-center justify-between gap-2 rounded-xl px-2.5 py-2",
                                        "transition will-change-transform",
                                        isActive
                                            ? "bg-accent text-white shadow-sm"
                                            : "text-neutral-700 hover:bg-accent/50 hover:text-white",
                                    ].join(" ")}
                                >
                                    <span
                                        className={[
                                            "text-[12px] font-semibold transition",
                                            isActive ? "translate-x-0" : "translate-x-0 group-hover:translate-x-[2px]",
                                        ].join(" ")}
                                    >
                                        {it.label}
                                    </span>

                                    <span
                                        className={[
                                            "inline-flex items-center justify-center rounded-lg border px-2 py-1 text-[10px] transition",
                                            isActive
                                                ? "border-white/15 bg-white/10 text-white"
                                                : "border-neutral-200 bg-white text-neutral-500 group-hover:text-neutral-900",
                                        ].join(" ")}
                                    >
                                        <ArrowUpRight className="h-3 w-3" />
                                    </span>

                                    <span
                                        className={[
                                            "pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 rounded-full transition",
                                            isActive ? "h-7 w-1 bg-white/70" : "h-0 w-0 bg-transparent",
                                        ].join(" ")}
                                    />
                                </Link>
                            );
                        })}
                    </nav>
                </div>
            </div>
        </aside>
    );
}
