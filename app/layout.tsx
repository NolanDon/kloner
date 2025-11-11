import "./globals.css";
import type { Metadata } from "next";
import AuthProviderServer from "@/components/auth/auth-provider.server";

export const metadata: Metadata = {
  metadataBase: new URL("https://kloner.app"),
  title: "Kloner | Clone any website in minutes",
  description:
    "Paste a URL to generate a clean preview, inspect pages, and deploy to Vercel or Netlify in one click.",
  applicationName: "Kloner",
  keywords: [
    "website cloner",
    "clone website",
    "HTML to Next.js",
    "instant preview",
    "deploy to Vercel",
    "Netlify deploy",
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
      </head>
      <body>
        <AuthProviderServer>{children}</AuthProviderServer>
      </body>
    </html>
  );
}
