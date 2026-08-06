import type { Metadata } from "next";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { getAllBlogPosts, getBlogIndexUrl, getReadingTimeMinutes } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Articles on AI app cloning, website cloning, fast MVP testing, and practical AI agents for building and shipping products.",
  alternates: { canonical: getBlogIndexUrl() },
  openGraph: { url: getBlogIndexUrl() },
};

export default function BlogIndexPage() {
  const posts = getAllBlogPosts();

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <NavBar />

      <section className="pt-28 pb-20 px-4">
        <div className="mx-auto max-w-6xl">
          <header className="mb-10 max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
              <span>Kloner · Blog</span>
            </div>

            <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-7 sm:px-8 sm:py-9 shadow-sm">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">Blog</h1>
                  <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                    Practical articles on cloning sites responsibly, shipping quick MVPs, and using AI agents to accelerate product work.
                  </p>
                </div>

                <div className="mt-1 inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm">
                  {posts.length} posts
                </div>
              </div>
            </div>
          </header>

          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => {
              const minutes = getReadingTimeMinutes(p.markdown);
              return (
                <Link
                  key={p.slug}
                  href={`/blog/${p.slug}`}
                  className={[
                    "group relative overflow-hidden rounded-2xl border border-black/10 bg-white p-6 shadow-sm",
                    "transition duration-200 hover:-translate-y-0.5 hover:shadow-md",
                    "hover:border-[rgba(255,141,33,0.35)]",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,141,33,0.25)] focus-visible:ring-offset-2",
                  ].join(" ")}
                >
                  <div
                    className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                    aria-hidden
                    style={{
                      background:
                        "radial-gradient(1200px circle at 30% -20%, rgba(255,141,33,0.14), transparent 55%)",
                    }}
                  />

                  <div className="relative">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-2">
                        <span className="rounded-full border border-neutral-200 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-neutral-700 shadow-sm">
                          {p.publishedAt}
                        </span>
                        <span className="rounded-full border border-neutral-200 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-neutral-700 shadow-sm">
                          {minutes} min read
                        </span>
                      </div>

                      <span className="text-[11px] font-semibold text-[rgba(255,141,33,1)]">
                        Read →
                      </span>
                    </div>

                    <div className="mt-4 text-[17px] font-semibold tracking-tight text-neutral-900">
                      {p.title}
                    </div>
                    <p className="mt-2 text-sm text-neutral-600 leading-6">{p.description}</p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {p.tags.slice(0, 4).map((t) => (
                        <span
                          key={`${p.slug}-${t}`}
                          className="rounded-full border border-[rgba(255,141,33,0.22)] bg-[rgba(255,141,33,0.08)] px-2.5 py-1 text-[11px] font-medium text-[rgba(255,141,33,1)]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
