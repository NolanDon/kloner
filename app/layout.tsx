// app/layout.tsx
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

export const metadata: Metadata = { /* unchanged */ };

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
            {/* Global support chat widget */}
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
