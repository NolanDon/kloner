import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import Markdown from "@/components/blog/Markdown";
import {
  getAllBlogPosts,
  getBlogPostBySlug,
  getBlogPostUrl,
  getReadingTimeMinutes,
  getSiteUrl,
} from "@/lib/blog";

export function generateStaticParams() {
  return getAllBlogPosts().map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const post = getBlogPostBySlug(params.slug);
  if (!post) return {};

  const url = getBlogPostUrl(post.slug);
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      url,
      type: "article",
      title: post.title,
      description: post.description,
      siteName: "Kloner",
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: ["/opengraph-image"],
    },
  };
}

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = getBlogPostBySlug(params.slug);
  if (!post) notFound();

  const minutes = getReadingTimeMinutes(post.markdown);
  const url = getBlogPostUrl(post.slug);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    url,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt || post.publishedAt,
    author: {
      "@type": "Organization",
      name: "Kloner",
      url: getSiteUrl(),
    },
    publisher: {
      "@type": "Organization",
      name: "Kloner",
      url: getSiteUrl(),
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
  };

  const recent = getAllBlogPosts().filter((p) => p.slug !== post.slug).slice(0, 3);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <NavBar />

      <section className="pt-28 pb-20 px-4">
        <div className="mx-auto max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
            <span>Kloner · Blog</span>
          </div>

          <header className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-6 sm:px-8 sm:py-7 shadow-sm">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <Link href="/blog" className="text-sm font-semibold text-neutral-700 hover:text-neutral-900">
                ← Back to blog
              </Link>

              <div className="inline-flex items-center gap-2">
                <span className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm">
                  {post.publishedAt}
                </span>
                <span className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm">
                  {minutes} min read
                </span>
              </div>
            </div>
          </header>

          <article className="mt-6 rounded-3xl border border-black/10 bg-white px-6 py-7 sm:px-8 sm:py-9 shadow-sm">
            <Markdown markdown={post.markdown} />
          </article>

          {recent.length ? (
            <div className="mt-10">
              <div className="text-sm font-semibold text-neutral-900">Recent posts</div>
              <div className="mt-4 grid gap-3">
                {recent.map((p) => (
                  <Link
                    key={p.slug}
                    href={`/blog/${p.slug}`}
                    className={[
                      "group rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-sm",
                      "transition hover:-translate-y-0.5 hover:shadow-md hover:border-[rgba(245,95,42,0.35)]",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(245,95,42,0.25)] focus-visible:ring-offset-2",
                    ].join(" ")}
                  >
                    <div className="text-sm font-semibold text-neutral-900">{p.title}</div>
                    <div className="mt-1 text-xs text-neutral-600">{p.description}</div>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Footer />
    </main>
  );
}
