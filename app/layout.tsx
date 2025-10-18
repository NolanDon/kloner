
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Overdrive | Home",
  description: "Overdrive-style landing built with Next.js, TS, Tailwind, Framer Motion",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
