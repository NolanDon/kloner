import "./globals.css";
import type { Metadata } from "next";
import AuthProviderServer from "@/components/auth/auth-provider.server";
import { Inter } from "next/font/google";
import { AppClientProviders } from "./AppClientProvider";
import ChatWidgetProvider from "@/components/support/ChatWidgetProvider";
import AffiliateRefCapture from "@/components/AffiliateRefCapture";
import { Suspense } from "react";
import StyledJsxRegistry from "./registry";
import Script from "next/script";
import SeoInternalLinks from "@/components/SeoInternalLinks";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "Kloner – AI Website Cloner, Builder and Preview Tool",
    template: "%s | Kloner",
  },
  description:
    "Kloner is a website cloner that lets you capture, edit, and redeploy high-fidelity website layouts with AI. Start a free preview, customize sections, and launch production-ready sites quickly.",
  metadataBase: new URL("https://kloner.app"),
  alternates: {
    canonical: "https://kloner.app",
  },
  openGraph: {
    title: "Kloner – AI Website Builder and Preview Tool",
    description:
      "Website cloner for high-fidelity layouts: capture, edit, and redeploy fast. Start a free preview and launch sites faster.",
    url: "https://kloner.app",
    siteName: "Kloner",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Kloner – AI Website Cloner",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kloner – AI Website Builder and Preview Tool",
    description:
      "Website cloner for high-fidelity layouts: capture, edit, and redeploy fast. Start a free preview and launch sites faster.",
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-white scroll-smooth snap-y snap-mandatory">
        <StyledJsxRegistry>
          <AuthProviderServer>
            <AppClientProviders>
              <Suspense>
                <AffiliateRefCapture />
                {children}
              </Suspense>
              <ChatWidgetProvider />
            </AppClientProviders>
          </AuthProviderServer>
        </StyledJsxRegistry>

        {/*
          Always-rendered internal links for crawlers.
          This protects against "dead end" + "orphan" flags when a crawler doesn't execute JS
          or misses navigation that is conditionally rendered.
        */}
        <SeoInternalLinks />

        {/* Google Analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-FVKJJK0379"
          strategy="afterInteractive"
        />
        <Script src="/ga-init.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
