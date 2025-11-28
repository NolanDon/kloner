// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import AuthProviderServer from "@/components/auth/auth-provider.server";
import { Inter } from "next/font/google";
import { AppClientProviders } from "./AppClientProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://kloner.app"),
  title: "Kloner | Clone any website in minutes",
  description:
    "Paste a URL to generate a clean preview, inspect pages, and deploy to Vercel or Netlify in one click.",
  applicationName: "Kloner",
  keywords: [
    "website cloner",
    "clone website",
    "URL to Website",
    "instant preview",
    "deploy to Vercel",
    "Vercel deploy",
  ],
  authors: [{ name: "Kloner" }],
  creator: "Kloner",
  publisher: "Kloner",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "https://kloner.app/",
    siteName: "Kloner",
    title: "Kloner — Clone any website in minutes",
    description:
      "Paste a URL, get a live preview, then deploy to Vercel or Netlify with one click.",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "Kloner preview dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kloner — Clone any website in minutes",
    description:
      "Paste a URL, get a live preview, then deploy to Vercel or Netlify with one click.",
    images: ["/og.jpg"],
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
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
        <AuthProviderServer>
          <AppClientProviders>{children}</AppClientProviders>
        </AuthProviderServer>

        {/* Google Analytics */}
        <script
          async
          src="https://www.googletagmanager.com/gtag/js?id=G-FVKJJK0379"
        />

        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'G-FVKJJK0379', {
                page_path: window.location.pathname,
              });
            `,
          }}
        />
      </body>
    </html>
  );
}

