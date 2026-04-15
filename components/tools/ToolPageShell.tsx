import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { TOOL_BY_SLUG, type ToolConfig, type ToolSlug } from "./toolRegistry";

export function ToolPageShell({
  tool,
  children,
}: {
  tool: ToolConfig;
  children: React.ReactNode;
}) {
  const related = tool.related.map((slug) => TOOL_BY_SLUG[slug]);

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <NavBar />
      <section className="pt-28 pb-20 px-4 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <header className="mb-10 max-w-4xl">
            <div className="mb-4 flex items-center gap-3">
              <Link
                href="/tools"
                className="inline-flex items-center gap-2 rounded-full border border-[#f55f2a] bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white transition duration-200 hover:-translate-y-0.5 hover:bg-[#f3602c]"
              >
                <span aria-hidden>←</span>
                Back to tools
              </Link>
            </div>

            <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-7 sm:px-8 sm:py-9 shadow-sm">
              <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                {tool.h1}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                {tool.intro}
              </p>
              <div className="mt-4 flex flex-wrap gap-3 text-sm text-neutral-600">
                <a href="https://kloner.app" className="font-medium text-[#f55f2a] underline underline-offset-4 decoration-2 hover:decoration-[#f55f2a]">
                  build tools like this
                </a>
                <a href="https://kloner.app" className="font-medium text-[#f55f2a] underline underline-offset-4 decoration-2 hover:decoration-[#f55f2a]">
                  create your own tools
                </a>
                <a href="https://kloner.app" className="font-medium text-[#f55f2a] underline underline-offset-4 decoration-2 hover:decoration-[#f55f2a]">
                  launch apps faster
                </a>
              </div>
            </div>
          </header>

          <div className="rounded-[2.25rem] border border-neutral-200 bg-white p-4 shadow-[0_22px_70px_rgba(15,23,42,0.08)] sm:p-6">
            {children}
          </div>

          <section className="mt-12 max-w-4xl space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">How to use this tool</h2>
            <div className="space-y-3 text-neutral-600">
              {tool.howTo.map((step) => (
                <p key={step} className="leading-7">{step}</p>
              ))}
            </div>
          </section>

          <section className="mt-10 max-w-4xl space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">Use cases</h2>
            <div className="space-y-3 text-neutral-600">
              {tool.useCases.map((item) => (
                <p key={item} className="leading-7">{item}</p>
              ))}
            </div>
          </section>

          <section className="mt-10 max-w-4xl space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">Why this tool is useful</h2>
            <div className="space-y-3 text-neutral-600">
              {tool.whyUseful.map((item) => (
                <p key={item} className="leading-7">{item}</p>
              ))}
            </div>
          </section>

          <section className="mt-10 max-w-4xl space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">FAQ</h2>
            <div className="space-y-3">
              {tool.faqs.map((faq) => (
                <details key={faq.q} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                  <summary className="cursor-pointer list-none font-medium text-neutral-900">{faq.q}</summary>
                  <p className="mt-3 text-sm leading-7 text-neutral-600">{faq.a}</p>
                </details>
              ))}
            </div>
          </section>

          <section className="mt-10 max-w-4xl space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">Related tools</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {related.map((item) => (
                <Link key={item.slug} href={`/tools/${item.slug}`} className="group rounded-[1.5rem] border border-neutral-200 bg-white p-4 text-sm text-neutral-700 shadow-[0_12px_34px_rgba(15,23,42,0.06)] transition duration-300 ease-out hover:-translate-y-1 hover:scale-[1.02] hover:border-[#f55f2a] hover:shadow-[0_24px_60px_rgba(245,95,42,0.14)]">
                  <div className="font-medium text-neutral-950">{item.title}</div>
                  <div className="mt-2 text-xs uppercase tracking-[0.16em] text-neutral-500">{item.keyword}</div>
                </Link>
              ))}
            </div>
            <p className="text-sm text-neutral-600">
              If you want to build tools like this without starting from scratch, kloner.app can help you launch apps faster and create your own tools.
            </p>
          </section>

        </div>
      </section>
      <Footer />
    </main>
  );
}

export function getToolPath(slug: ToolSlug) {
  return `/tools/${slug}`;
}
