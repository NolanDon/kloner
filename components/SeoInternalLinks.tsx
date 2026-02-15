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

// These are the blog URLs Ahrefs reported as orphans.
// Keeping them here ensures they have guaranteed incoming internal links even if a crawler
// misses the blog index for any reason.
const AFFECTED_BLOG_POSTS: LinkItem[] = [
  { label: "Clone a website from a URL", href: "/blog/clone-a-website-from-a-url" },
  { label: "Clone your next SaaS in minutes", href: "/blog/clone-your-next-saas-in-minutes" },
  { label: "Productionizing AI clones fast", href: "/blog/productionizing-ai-clones-fast" },
  { label: "Best AI website builder for cloning", href: "/blog/best-ai-website-builder-for-cloning" },
  { label: "Website cloning for quick MVPs", href: "/blog/website-cloning-for-quick-mvps" },
  { label: "App cloner", href: "/blog/app-cloner" },
  { label: "How to clone apps", href: "/blog/how-to-clone-apps" },
  {
    label: "AI landing page builder best practices",
    href: "/blog/ai-landing-page-builder-best-practices",
  },
  {
    label: "Market hypotheses with cloned demos",
    href: "/blog/market-hypotheses-with-cloned-demos",
  },
  { label: "Analytics for AI clone ops", href: "/blog/analytics-for-ai-clone-ops" },
  { label: "User research with AI demo clones", href: "/blog/user-research-with-ai-demo-clones" },
  {
    label: "Performance checklist for cloned sites",
    href: "/blog/performance-checklist-for-cloned-sites",
  },
  {
    label: "AI website cloning to production",
    href: "/blog/ai-website-cloning-to-production",
  },
  {
    label: "Preview infrastructure for AI clones",
    href: "/blog/preview-infrastructure-for-ai-clones",
  },
  {
    label: "AI agents for product and growth teams",
    href: "/blog/ai-agents-for-product-and-growth-teams",
  },
  { label: "AI agent feedback loops", href: "/blog/ai-agent-feedback-loops" },
  {
    label: "Validate a market with a fast MVP",
    href: "/blog/validate-a-market-with-a-fast-mvp",
  },
  { label: "Demo operations playbook", href: "/blog/demo-operations-playbook" },
];

function InlineLinks({ links }: { links: LinkItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {links.map((l) => (
        <li key={l.href}>
          <a
            href={l.href}
            tabIndex={-1}
            className="text-neutral-600 hover:text-neutral-900 underline-offset-4 hover:underline"
          >
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function SeoInternalLinks() {
  return (
    <aside aria-hidden="true" className="sr-only">
      <div className="container-soft py-6">
        <div className="text-xs text-neutral-500">Quick links</div>
        <div className="mt-2 text-sm">
          <InlineLinks links={CORE_LINKS} />
        </div>

        <div className="mt-5 text-xs text-neutral-500">Popular guides</div>
        <div className="mt-2 text-sm">
          <InlineLinks links={AFFECTED_BLOG_POSTS} />
        </div>
      </div>
    </aside>
  );
}
