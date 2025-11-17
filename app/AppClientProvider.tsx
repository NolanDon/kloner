"use client";

import { ReactNode } from "react";
import { UrlOverlayProvider } from "@/components/UrlOverlayProvider";

export function AppClientProviders({ children }: { children: ReactNode }) {
    return <UrlOverlayProvider>{children}</UrlOverlayProvider>;
}