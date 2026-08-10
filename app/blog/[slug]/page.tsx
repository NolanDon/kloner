import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import BlogUrlCta from "@/components/blog/BlogUrlCta";
import Markdown from "@/components/blog/Markdown";
import {
  getAllBlogPosts,
  getBlogPostBySlug,
  getBlogPostUrl,
  getReadingTimeMinutes,
  getSiteUrl,
} from "@/lib/blog";
import { buildMetaDescription } from "@/lib/seo";

export function generateStaticParams() {
  return getAllBlogPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);
  if (!post) return {};

  const url = getBlogPostUrl(post.slug);
  const metaDescription = buildMetaDescription([
    post.description,
    "Read the guide on Kloner for practical steps, examples, and launch-ready advice.",
  ]);
  return {
    title: post.title,
    description: metaDescription,
    alternates: { canonical: url },
    openGraph: {
      url,
      type: "article",
      title: post.title,
      description: metaDescription,
      siteName: "Kloner",
      images: [
        {
          url: "/images/opengraph.jpg",
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: metaDescription,
      images: ["/images/opengraph.jpg"],
    },
  };
}

function stripLeadingTitle(markdown: string, title: string): string {
  const input = String(markdown || "");
  const lines = input.split("\n");
  const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLine === -1) return input;

  const firstLine = lines[firstContentLine]!.trim();
  const normalizedTitle = String(title || "")
    .trim()
    .toLowerCase();
  const normalizedHeading = firstLine
    .replace(/^#{1,6}\s+/, "")
    .trim()
    .toLowerCase();

  if (!firstLine.startsWith("#") || normalizedHeading !== normalizedTitle) {
    return input;
  }

  const nextLines = [
    ...lines.slice(0, firstContentLine),
    ...lines.slice(firstContentLine + 1),
  ];

  return nextLines.join("\n").replace(/^\s*\n/, "");
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);
  if (!post) notFound();

  const minutes = getReadingTimeMinutes(post.markdown);
  const url = getBlogPostUrl(post.slug);
  const metaDescription = buildMetaDescription([
    post.description,
    "Read the guide on Kloner for practical steps, examples, and launch-ready advice.",
  ]);
  const authorName = "Kloner Editorial";
  const authorRole = "Written for builders";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: metaDescription,
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

  const recent = getAllBlogPosts()
    .filter((p) => p.slug !== post.slug)
    .slice(0, 3);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <NavBar />

      <section className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <header className="relative mt-4 overflow-hidden rounded-[2rem] border border-neutral-200 bg-white shadow-sm">
            <div
              className="absolute inset-0"
              aria-hidden
              style={{
                background:
                  "radial-gradient(1200px circle at 30% -20%, rgba(255,141,33,0.14), transparent 55%), linear-gradient(135deg, rgba(255,255,255,0.98), rgba(250,250,249,0.98), rgba(244,244,245,0.94))",
              }}
            />

            <div className="relative px-6 py-8 sm:px-8 sm:py-10 lg:px-10">
              <div className="flex items-start justify-between gap-6 flex-wrap">
                <Link
                  href="/blog"
                  className="text-sm font-medium text-neutral-600 hover:text-neutral-900"
                >
                  ← Back to blog
                </Link>
              </div>

              <div className="mt-10 max-w-4xl">
                <div className="flex items-center gap-3">
                  <div className="relative h-11 w-11 overflow-hidden rounded-full border border-neutral-200 bg-white shadow-sm">
                    <Image
                      src="/images/testimonial-avatar.jpg"
                      alt={authorName}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-neutral-900">
                      {authorName}
                    </div>
                    <div className="text-xs text-neutral-500">{authorRole}</div>
                  </div>
                </div>

                <h1 className="mt-5 text-[32px] tracking-tight text-neutral-900 sm:text-[40px] lg:text-[48px]">
                  {post.title}
                </h1>
                <div className="mt-4 inline-flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                  <span className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 font-medium text-neutral-700 shadow-sm">
                    {post.publishedAt}
                  </span>
                  <span className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 font-medium text-neutral-700 shadow-sm">
                    {minutes} min read
                  </span>
                </div>
                <p className="mt-4 max-w-3xl text-base leading-7 text-neutral-600 sm:text-lg">
                  {post.description}
                </p>
              </div>
            </div>
          </header>

          <div className="mx-auto mt-8 h-px max-w-7xl bg-neutral-200" />

          <div className="mx-auto mt-8 max-w-5xl px-1 sm:px-2 lg:px-4">
            <BlogUrlCta
              title="Clone this idea from a URL"
              description="Paste your website below and Kloner will get you started."
            />
          </div>

          <article className="mx-auto mt-8 max-w-5xl px-1 sm:px-2 lg:px-4">
            <Markdown markdown={stripLeadingTitle(post.markdown, post.title)} />
          </article>

          <div className="mx-auto mt-10 max-w-5xl px-1 sm:px-2 lg:px-4">
            <BlogUrlCta
              title="Start your version from a URL"
              description="If you’ve read this far, you can turn any public reference into a signup-ready project in a few seconds."
            />
          </div>

          {recent.length ? (
            <div className="mx-auto mt-16 max-w-7xl">
              <div className="text-sm font-semibold text-neutral-900">
                Recent posts
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {recent.map((p) => (
                  <Link
                    key={p.slug}
                    href={`/blog/${p.slug}`}
                    className={[
                      "group rounded-2xl border border-black/10 bg-white px-4 py-4 shadow-sm",
                      "transition hover:-translate-y-0.5 hover:shadow-md hover:border-[rgba(255,141,33,0.35)]",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,141,33,0.25)] focus-visible:ring-offset-2",
                    ].join(" ")}
                  >
                    <div className="text-sm font-semibold text-neutral-900">
                      {p.title}
                    </div>
                    <div className="mt-1 text-xs text-neutral-600">
                      {p.description}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Footer />
    </main>
  );
}
