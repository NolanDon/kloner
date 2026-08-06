import type { Metadata } from "next";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { TOOL_HUB_ITEMS } from "@/components/tools/toolRegistry";

function getToolBadgeStyle(badge: string) {
  if (badge.length <= 2) {
    return "min-w-11 px-2 text-[11px] tracking-[0.14em]";
  }

  if (badge.length === 3) {
    return "min-w-11 px-2 text-[10px] tracking-[0.1em]";
  }

  if (badge.length === 4) {
    return "min-w-[3rem] px-2.5 text-[9.5px] tracking-[0.06em]";
  }

  return "min-w-[3.75rem] px-2.5 text-[8.5px] tracking-[0.03em]";
}

export const metadata: Metadata = {
  title: "Tools",
  description:
    "Browse quick web tools on Kloner, including generators for numbers, words, colors, names, titles, codes, and other simple everyday tasks.",
  alternates: {
    canonical: "https://kloner.app/tools",
  },
  openGraph: {
    url: "https://kloner.app/tools",
  },
};

export default function ToolsHubPage() {
  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <NavBar />
      <section className="relative overflow-hidden pt-28 pb-20 px-4 sm:px-6">
        <div
          className="pointer-events-none absolute left-1/2 top-4 h-72 w-72 -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          aria-hidden
          style={{ background: "radial-gradient(circle, rgba(255,141,33,0.18), transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute right-[-6rem] top-28 h-64 w-64 rounded-full opacity-30 blur-3xl"
          aria-hidden
          style={{ background: "radial-gradient(circle, rgba(14,165,233,0.16), transparent 68%)" }}
        />
        <div className="mx-auto max-w-6xl">
          <header className="mb-10 max-w-4xl website-paywall-feature" style={{ animationDelay: "20ms" }}>
            <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4 shadow-[0_12px_24px_rgba(255,141,33,0.16)]">
              <span>Kloner · Tools</span>
            </div>

            <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-7 shadow-[0_24px_72px_rgba(15,23,42,0.08)] sm:px-8 sm:py-9">
              <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                Simple tools in one place, built for quick wins
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                A small collection of quick utilities, all in one crawlable hub. If you want to build tools like this, you can use <a href="https://kloner.app" className="text-[#FF8D21] font-medium">kloner.app</a> to launch apps faster and create your own.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  "Copy-ready",
                  "Fast previews",
                  "More variants",
                  "Browser local",
                ].map((chip, index) => (
                  <span
                    key={chip}
                    className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 shadow-[0_8px_18px_rgba(15,23,42,0.05)] website-paywall-feature"
                    style={{ animationDelay: `${60 + index * 35}ms` }}
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </header>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TOOL_HUB_ITEMS.map((tool, index) => (
              <Link
                key={tool.href}
                href={tool.href}
                className="group relative overflow-hidden rounded-[2rem] border border-neutral-200 bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.07)] transition duration-300 ease-out hover:-translate-y-2 hover:scale-[1.035] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,141,33,0.25)] focus-visible:ring-offset-2 website-paywall-feature"
                style={{ animationDelay: `${100 + index * 38}ms` }}
              >
                <div
                  className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  aria-hidden
                  style={{
                    background: `radial-gradient(1200px circle at 30% -20%, ${tool.tint.glow}, transparent 55%)`,
                  }}
                />
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-1.5"
                  aria-hidden
                  style={{ background: tool.tint.accent }}
                />

                <div className="relative">
                  <div className="flex items-start justify-between gap-4">
                    <div className={`inline-flex h-11 items-center justify-center rounded-2xl whitespace-nowrap font-semibold leading-none ${getToolBadgeStyle(tool.badge)} ${tool.tint.badge} shadow-[0_10px_24px_rgba(15,23,42,0.12)]`}>
                      {tool.badge}
                    </div>
                  </div>
                  <div className="mt-4 text-lg font-semibold text-neutral-950 transition group-hover:text-[#FF8D21]">
                    {tool.label}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-neutral-600">{tool.description}</p>
                  <div
                    className="mt-4 h-px w-full"
                    aria-hidden
                    style={{ background: `linear-gradient(90deg, ${tool.tint.ring}, transparent)` }}
                  />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
