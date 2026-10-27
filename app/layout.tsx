import "./globals.css";
import type { Metadata } from "next";
import AuthProviderServer from "@/components/auth/auth-provider.server";
import { AppClientProviders } from "./AppClientProvider";
import DeferredChatWidget from "@/components/support/DeferredChatWidget";
import AffiliateRefCapture from "@/components/AffiliateRefCapture";
import { Suspense } from "react";
import StyledJsxRegistry from "./registry";
import { Inter } from "next/font/google";
import MoqupReferralBanner from "@/components/MoqupReferralBanner";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Kloner – AI Website Cloner",
    template: "%s | Kloner",
  },
  description:
    "Kloner is a website cloner that lets you capture, edit, and redeploy high-fidelity website layouts with AI. Start a free preview, customize sections, and launch production-ready sites quickly.",
  metadataBase: new URL("https://kloner.app"),
  alternates: {
    canonical: "https://kloner.app",
  },
  openGraph: {
    title: "Kloner – AI Website Cloner",
    description:
      "Website cloner for high-fidelity layouts: capture, edit, and redeploy fast. Start a free preview and launch sites faster.",
    url: "https://kloner.app",
    siteName: "Kloner",
    type: "website",
    images: [
      {
          url: "/images/opengraph.jpg",
        width: 1200,
        height: 630,
        alt: "Kloner – AI Website Cloner",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kloner – AI Website Cloner",
    description:
      "Website cloner for high-fidelity layouts: capture, edit, and redeploy fast. Start a free preview and launch sites faster.",
      images: ["/images/opengraph.jpg"],
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
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try { var savedTheme = localStorage.getItem('kloner-theme'); var t = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark'; document.documentElement.dataset.theme = t; document.documentElement.style.colorScheme = t; ${process.env.NODE_ENV === "development" ? "" : "var promoDismissedUntil = Number(localStorage.getItem('kloner-moqup-banner-dismissed-until')); if (Number.isFinite(promoDismissedUntil) && promoDismissedUntil > Date.now()) { document.documentElement.dataset.moqupPromoDismissed = 'true'; document.documentElement.style.setProperty('--moqup-banner-offset', '0px'); }"} } catch (e) { document.documentElement.dataset.theme = 'dark'; document.documentElement.style.colorScheme = 'dark'; }`,
          }}
        />
      </head>
      <body className="bg-white scroll-smooth">
        <StyledJsxRegistry>
          <AuthProviderServer>
            <AppClientProviders>
              <MoqupReferralBanner />
              <Suspense fallback={null}>
                <AffiliateRefCapture />
              </Suspense>
              {children}
              <DeferredChatWidget />
            </AppClientProviders>
          </AuthProviderServer>
        </StyledJsxRegistry>
      </body>
    </html>
  );
}
