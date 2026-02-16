"use client";

import { ReactNode } from "react";
import { UrlOverlayProvider } from "@/components/UrlOverlayProvider";
import { ModalProvider } from "@/components/ui/ModalContext";
import MixpanelClient from "@/components/MixpanelClient";
import MixpanelAutocapture from "@/components/MixpanelAutocapture";

export function AppClientProviders({ children }: { children: ReactNode }) {
    return (
        <UrlOverlayProvider>
            <ModalProvider>
                <MixpanelClient />
                <MixpanelAutocapture />
                {children}
            </ModalProvider>
        </UrlOverlayProvider>
    );
}
