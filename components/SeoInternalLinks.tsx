import React from "react";

type LinkItem = { label: string; href: string };

const CORE_LINKS: LinkItem[] = [
  { label: "Home", href: "/" },
  { label: "Blog", href: "/blog" },
  { label: "Pricing", href: "/price" },
  { label: "Compare", href: "/compare" },
  { label: "Community Builds", href: "/community-builds" },
  { label: "Partners", href: "/partners" },
  { label: "Contact", href: "/contact" },
  { label: "Terms", href: "/terms" },
  { label: "Kloner Vercel EULA", href: "/legal/kloner-vercel-eula" },
];

// A small set of distinct, maintained website guides complements the product pages.
const AFFECTED_BLOG_POSTS: LinkItem[] = [
  { label: "How to clone a website", href: "/blog/how-to-clone-a-website" },
  { label: "Clone a website from a URL", href: "/blog/clone-website-from-url" },
  { label: "Free website preview and plan limits", href: "/blog/clone-website-free" },
  { label: "Website cloner vs website downloader", href: "/blog/website-cloner-vs-website-downloader" },
  { label: "Clone a WordPress website", href: "/blog/clone-wordpress-website" },
];

function InlineLinks({ links }: { links: LinkItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {links.map((l) => (
        <li key={l.href}>
          <a
            href={l.href}
            className="text-neutral-600 hover:text-neutral-900 underline-offset-4 hover:underline"
          >
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function SeoInternalLinks({
  variant = "footer",
}: {
  variant?: "footer" | "standalone";
}) {
  const shellClassName =
    variant === "standalone"
      ? "border-t border-neutral-200 bg-white"
      : "mt-8 md:mt-10 pt-6 border-t border-neutral-200/70";

  const containerClassName =
    variant === "standalone" ? "container-soft py-6" : "";

  return (
    <div className={shellClassName}>
      <div className={containerClassName}>
        <div className="text-xs text-neutral-500">Quick links</div>
        <div className="mt-2 text-sm">
          <InlineLinks links={CORE_LINKS} />
        </div>

        <div className="mt-5 text-xs text-neutral-500">Popular guides</div>
        <div className="mt-2 text-sm">
          <InlineLinks links={AFFECTED_BLOG_POSTS} />
        </div>

      </div>
    </div>
  );
}
