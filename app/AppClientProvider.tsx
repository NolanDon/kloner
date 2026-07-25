"use client";

import { ReactNode, Suspense } from "react";
import { UrlOverlayProvider } from "@/components/UrlOverlayProvider";
import { ModalProvider } from "@/components/ui/ModalContext";
import CreditTopupReturnHandler from "@/components/CreditTopupReturnHandler";
import { AnalyticsScripts, ConsentAwareTracking, CookieConsentBanner, CookieConsentProvider } from "@/components/CookieConsent";

export function AppClientProviders({ children }: { children: ReactNode }) {
    return (
        <UrlOverlayProvider>
            <CookieConsentProvider>
                <ModalProvider>
                    <Suspense fallback={null}>
                        <CreditTopupReturnHandler />
                    </Suspense>
                    <ConsentAwareTracking />
                    <AnalyticsScripts />
                    {children}
                    <CookieConsentBanner />
                </ModalProvider>
            </CookieConsentProvider>
        </UrlOverlayProvider>
    );
}
