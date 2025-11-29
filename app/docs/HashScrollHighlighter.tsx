"use client";

import { useEffect } from "react";

export function HashScrollHighlighter() {
    useEffect(() => {
        const handleHash = () => {
            const hash = window.location.hash?.slice(1);
            if (!hash) return;

            const el = document.getElementById(hash);
            if (!el) return;

            // ensure in view (in case link was from another page)
            el.scrollIntoView({ behavior: "smooth", block: "start" });

            el.classList.add("anchor-highlight");
            window.setTimeout(() => {
                el.classList.remove("anchor-highlight");
            }, 1800);
        };

        handleHash(); // on first load
        window.addEventListener("hashchange", handleHash);
        return () => window.removeEventListener("hashchange", handleHash);
    }, []);

    return null;
}
