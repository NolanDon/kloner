"use client";

import { ReactNode, Suspense } from "react";
import { UrlOverlayProvider } from "@/components/UrlOverlayProvider";
import { ModalProvider } from "@/components/ui/ModalContext";
import MixpanelClient from "@/components/MixpanelClient";
import MixpanelAutocapture from "@/components/MixpanelAutocapture";
import CreditTopupReturnHandler from "@/components/CreditTopupReturnHandler";

export function AppClientProviders({ children }: { children: ReactNode }) {
    return (
        <UrlOverlayProvider>
            <ModalProvider>
                <Suspense fallback={null}>
                    <CreditTopupReturnHandler />
                </Suspense>
                <Suspense fallback={null}>
                    <MixpanelClient />
                </Suspense>
                <MixpanelAutocapture />
                {children}
            </ModalProvider>
        </UrlOverlayProvider>
    );
}
