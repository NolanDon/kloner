// components/Footer.tsx
// Server-first footer that always outputs crawlable <a href="..."> links in the initial HTML.
// - Removes '/dashboard/docs#...' for public SEO. Uses real external links for social.
// - Keeps mobile accordion via <details>/<summary> (no client JS needed, still crawlable).
// - Always includes a non-collapsible "Quick links" row for crawlers and users.

import React from "react";

type LinkItem = { label: string; href: string; external?: boolean };

const FOOTER_SECTIONS: Array<{ title: string; items: LinkItem[]; note?: { atIndex: number; text: string } }> = [
  {
    title: "Product",
    items: [
      { label: "How it Works", href: "/#how-it-works" },
      { label: "Examples", href: "/#examples" },
      { label: "FAQ", href: "/#faq" },
      { label: "Pricing", href: "/price" },
      { label: "Blog", href: "/blog" },
      { label: "Community builds", href: "/community-builds" },
      { label: "Docs", href: "/dashboard/docs" },
    ],
  },
  {
    title: "Company",
    items: [
      { label: "Contact", href: "/contact" },
      { label: "Partners", href: "/partners" },
      { label: "Terms", href: "/terms" },
      { label: "Kloner Vercel EULA", href: "/legal/kloner-vercel-eula" },
    ],
  },
  {
    title: "Compare",
    items: [
      { label: "Compare", href: "/compare" },
      { label: "Docs", href: "/dashboard/docs" },
    ],
  },
  {
    title: "Resources",
    items: [
      { label: "YouTube", href: "https://www.youtube.com/@klonerapp", external: true },
      { label: "Vercel", href: "https://vercel.com", external: true },
    ],
  },
];

function slugify(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function isExternalHref(href: string) {
  return /^https?:\/\//i.test(href);
}

function FooterLink({ item }: { item: LinkItem }) {
  const external = item.external || isExternalHref(item.href);
  if (external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-neutral-800 text-neutral-700 text-[15px] md:text-[inherit]"
      >
        {item.label}
      </a>
    );
  }
  return (
    <a href={item.href} className="hover:text-neutral-800 text-neutral-800 text-[15px] md:text-[inherit]">
      {item.label}
    </a>
  );
}

export default function Footer() {
  return (
    <footer className="relative bg-white text-neutral-800 rounded-t-[3rem] overflow-hidden">
      <div className="container-soft pt-10 md:pt-16 pb-8">
        <div className="relative">
          <div className="flex justify-center">
            <h2
              className="
                inline-block text-center whitespace-nowrap select-none
                leading-[0.88] pt-1 md:pt-3 font-black tracking-tight
                text-[clamp(3.25rem,17vw,22rem)]
                text-transparent bg-clip-text
              "
              style={{
                backgroundImage:
                  "linear-gradient(90deg, #7a2e18 0%, #d44b1c 30%, #ff6f3d 60%, #ffb36b 100%)",
                backgroundSize: "100% 100%",
                backgroundRepeat: "no-repeat",
              }}
            >
              kloner
            </h2>
          </div>
        </div>

        {/* Always-visible quick links to guarantee crawler-visible internal outlinks */}
        <nav aria-label="Footer quick links" className="mt-6 md:mt-8">
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
            <li>
              <a href="/" className="text-neutral-700 hover:text-neutral-900">
                Home
              </a>
            </li>
            <li>
              <a href="/price" className="text-neutral-700 hover:text-neutral-900">
                Pricing
              </a>
            </li>
            <li>
              <a href="/dashboard/docs" className="text-neutral-700 hover:text-neutral-900">
                Docs
              </a>
            </li>
            <li>
              <a href="/blog" className="text-neutral-700 hover:text-neutral-900">
                Blog
              </a>
            </li>
            <li>
              <a href="/login" className="text-neutral-700 hover:text-neutral-900">
                Login
              </a>
            </li>
            <li>
              <a href="/community-builds" className="text-neutral-700 hover:text-neutral-900">
                Community
              </a>
            </li>
            <li>
              <a href="/terms" className="text-neutral-700 hover:text-neutral-900">
                Terms
              </a>
            </li>
          </ul>
        </nav>

        <div className="mt-8 grid gap-4 md:gap-10 md:grid-cols-5 text-sm">
          {FOOTER_SECTIONS.map((sec) => (
            <FooterSection key={sec.title} title={sec.title} items={sec.items} note={sec.note} />
          ))}
        </div>

        <div className="mt-8 md:mt-10 text-xs text-neutral-500">
          © {new Date().getFullYear()} Kloner, Inc. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

function FooterSection({
  title,
  items,
  note,
}: {
  title: string;
  items: LinkItem[];
  note?: { atIndex: number; text: string };
}) {
  const id = `footer-${slugify(title)}`;

  return (
    <div className="border-b border-neutral-200/70 py-3 last:border-b-0 md:border-none md:py-0">
      {/* <details> is crawlable and works without JS. Keep open on desktop via CSS. */}
      <details className="group md:open" open>
        <summary
          className="
            list-none cursor-pointer select-none
            w-full md:w-auto flex items-center justify-between gap-3
            md:mb-3 py-3 md:py-0
            text-neutral-800 md:text-neutral-700
          "
          aria-controls={id}
        >
          <span className="text-base md:text-[inherit]">{title}</span>

          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 md:hidden transition-transform group-open:rotate-180"
            stroke="currentColor"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </summary>

        <div id={id} className="md:block">
          <ul className="space-y-3 pb-2 md:pb-0">
            {items.map((item, i) => (
              <li key={`${item.label}-${item.href}`} className="flex items-start gap-2">
                <Chevron />
                <FooterLink item={item} />
                {note && note.atIndex === i ? (
                  <span className="ml-2 text-[11px] md:text-[11px] text-[#ff6f3d] whitespace-nowrap">
                    [{note.text}]
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mt-[2px] h-4 w-4 text-[#ff6f3d] shrink-0"
      stroke="currentColor"
      fill="none"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 12h12" />
      <path d="M12 6l6 6-6 6" />
    </svg>
  );
}
