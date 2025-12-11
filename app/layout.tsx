import "./globals.css";
import type { Metadata } from "next";
import AuthProviderServer from "@/components/auth/auth-provider.server";
import { Inter } from "next/font/google";
import { AppClientProviders } from "./AppClientProvider";
import ChatWidgetProvider from "@/components/support/ChatWidgetProvider";

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
    "Kloner lets you capture, edit, and redeploy high-fidelity website layouts with AI. Start a free preview, customize sections, and launch production-ready sites quickly.",
  metadataBase: new URL("https://kloner.app"),
  openGraph: {
    title: "Kloner – AI Website Builder and Preview Tool",
    description:
      "Capture, edit, and redeploy high-fidelity website layouts with AI. Start a free preview and launch sites faster.",
    url: "https://kloner.app",
    siteName: "Kloner",
    type: "website",
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
        <AuthProviderServer>
          <AppClientProviders>
            {children}
            <ChatWidgetProvider />
          </AppClientProviders>
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
