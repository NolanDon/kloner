// components/UrlOverlayProvider.tsx
"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import UrlOverlay from "./UrlOverlay";

type Ctx = {
    openUrlOverlay: () => void;
};

const UrlOverlayContext = createContext<Ctx | null>(null);

export function UrlOverlayProvider({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);

    const value: Ctx = {
        openUrlOverlay: () => setOpen(true),
    };

    return (
        <UrlOverlayContext.Provider value={value}>
            {children}
            <UrlOverlay open={open} onClose={() => setOpen(false)} />
        </UrlOverlayContext.Provider>
    );
}

export function useUrlOverlay() {
    const ctx = useContext(UrlOverlayContext);
    if (!ctx) {
        throw new Error("useUrlOverlay must be used within UrlOverlayProvider");
    }
    return ctx;
}
