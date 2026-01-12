"use client";

import { ReactNode } from "react";
import { UrlOverlayProvider } from "@/components/UrlOverlayProvider";
import { ModalProvider } from "@/components/ui/ModalContext";

export function AppClientProviders({ children }: { children: ReactNode }) {
    return (
        <UrlOverlayProvider>
            <ModalProvider>
                {children}
            </ModalProvider>
        </UrlOverlayProvider>
    );
}