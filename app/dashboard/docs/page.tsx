// app/dashboard/docs/page.tsx
import Link from "next/link";
import { CheckCircle2, Camera, Rocket, Sparkles, Zap } from "lucide-react";
import CoinLottieBadge from "@/components/tools/CoinLottieBadge";
import { HashScrollHighlighter } from "./HashScrollHighlighter";
import { RightQuickNav } from "./RightQuickNav";

const SECTION_Y = "py-14 sm:py-16";
const SECTION_SCROLL = "scroll-mt-[110px]";

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-white pb-[30px]">
      <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-10 py-8">
        <HashScrollHighlighter />

        {/* IMPORTANT: the right nav must live in the same grid as ALL sections */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr),260px] lg:gap-10">
          {/* LEFT: all content */}
          <div className="min-w-0">
            {/* Hero */}
            <section className="mb-10">
              <div className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-neutral-800 shadow-sm mb-4">
                <span>Kloner · Product Guide</span>
              </div>

              <div className="rounded-3xl border border-neutral-200 bg-white px-6 py-7 sm:px-8 sm:py-9 shadow-sm">
                <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                  Documentation
                </h1>
                <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                  Capture a site, generate an editable preview, customize it,
                  then export or deploy. This page explains the workflow,
                  credits, plans, and guardrails.
                </p>

                <div className="mt-6 flex flex-wrap gap-2.5 text-xs">
                  <Badge label="Website capture" />
                  <Badge label="Editable previews" />
                  <Badge label="Launch-ready output" />
                  <Badge label="Fair-use credits" />
                </div>
              </div>
            </section>

            {/* Features */}
            <section id="features" className={`${SECTION_Y} ${SECTION_SCROLL}`}>
              <SectionHeader
                eyebrow="Core workflow"
                title="Enter. Open. Customize. Deploy."
                description="Four quick steps, no extra ceremony."
              />

              <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                <FeatureCard
                  step="1"
                  title="Enter your URL"
                  body="Paste the site you want to work on."
                />
                <FeatureCard
                  step="2"
                  title="Open in editor"
                  body="We load it into the editor for you."
                />
                <FeatureCard
                  step="3"
                  title="Customize it"
                  body="Change copy, layout, and style."
                />
                <FeatureCard
                  step="4"
                  title="Deploy"
                  body="Ship when the version is ready."
                />
              </div>
            </section>

            {/* Credits */}
            <section id="credits" className={`${SECTION_Y} ${SECTION_SCROLL}`}>
              <SectionHeader
                eyebrow="Monthly usage"
                title="Credits"
                description="Preview credits and AI credits reset on the 1st of every month."
              />

              <div className="mt-6 grid gap-5 md:grid-cols-[1.15fr,0.85fr]">
                <div className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6 shadow-sm">
                  <h3 className="text-sm font-semibold text-neutral-900 mb-3">
                    What uses credits
                  </h3>
                  <div className="space-y-3 text-[12px] text-neutral-700">
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                      <span className="font-semibold text-neutral-900">
                        When you scan a URL: 10 screenshot credits
                      </span>
                    </div>
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                      <span className="font-semibold text-neutral-900">
                        When you generate a website: 15 preview credits
                      </span>
                    </div>
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                      <span className="font-semibold text-neutral-900">
                        AI credits are based on token usage
                      </span>
                    </div>
                  </div>
                  <p className="mt-4 text-[12px] leading-relaxed text-neutral-600">
                    Higher plans give you more monthly usage. Everything resets
                    on the 1st.
                  </p>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
                  <h3 className="text-sm font-semibold text-neutral-900 mb-3">
                    Dashboard example
                  </h3>
                  <div className="space-y-2.5 text-xs">
                    <span className="inline-flex min-h-9 items-center rounded-full bg-neutral-100 px-3 text-neutral-700">
                      Scan credits:&nbsp;
                      <span className="font-semibold text-neutral-900">
                        9/10
                      </span>
                    </span>

                    <span className="inline-flex min-h-9 items-center rounded-full bg-neutral-100 px-3 text-neutral-700">
                      <span className="mr-1 inline-flex items-center">
                        <CoinLottieBadge className="h-5 w-5" />
                      </span>
                      AI credits:&nbsp;
                      <span className="font-semibold text-neutral-900">
                        120/200
                      </span>
                    </span>

                    <p className="text-[11px] leading-relaxed text-neutral-500">
                      This uses the same pill style as the dashboard header.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Plans */}
            <section id="plans" className={`${SECTION_Y} ${SECTION_SCROLL}`}>
              <SectionHeader
                eyebrow="Plans"
                title="Pick based on how often you iterate"
                description="Free for testing. Pro for building. Agency for client throughput."
              />

              <div className="mt-6 grid gap-5 md:grid-cols-3">
                <PlanCard
                  label="Free"
                  highlight={false}
                  description="Try the flow without commitment."
                  bullets={[
                    "Lower monthly usage",
                    "Full core editor access",
                    "Resets on the 1st",
                  ]}
                  cta="Get started"
                  href="/login?mode=signup"
                />
                <PlanCard
                  label="Pro"
                  highlight
                  description="For solo founders and small teams."
                  bullets={[
                    "Higher monthly usage",
                    "Faster iteration cadence",
                    "Advanced editor features",
                  ]}
                  cta="See Pro details"
                  href="/price"
                />
                <PlanCard
                  label="Agency"
                  highlight={false}
                  description="For multi-project and client work."
                  bullets={[
                    "Highest monthly usage",
                    "Client pipeline friendly",
                    "Flexible agreements",
                  ]}
                  cta="Explore Agency"
                  href="/price"
                />
              </div>

              <p className="mt-5 text-[11px] text-neutral-500">
                Enterprise is custom for governance, scale, and workflows.
              </p>
            </section>

            {/* Compare */}
            <section id="compare" className={`${SECTION_Y} ${SECTION_SCROLL}`}>
              <SectionHeader
                eyebrow="Compare"
                title="Shipping tradeoffs"
                description="Fast start vs tailored rebuild, plus hosting choices."
              />

              <div className="mt-6 grid gap-5 md:grid-cols-3 text-[12px] text-neutral-800">
                <article
                  id="cloning-vs-rebuild"
                  className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
                >
                  <h3 className="text-sm font-semibold text-neutral-900 mb-1">
                    Clone vs rebuild
                  </h3>
                  <ul className="space-y-1.5 leading-relaxed">
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>Clone to get structure fast.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>Rebuild for deeper technical control.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>Common: clone first, rebuild the keepers.</span>
                    </li>
                  </ul>
                </article>

                <article
                  id="vercel-vs-netlify"
                  className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
                >
                  <h3 className="text-sm font-semibold text-neutral-900 mb-1">
                    Vercel vs Netlify
                  </h3>
                  <ul className="space-y-1.5 leading-relaxed">
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>Both work well for static + hybrid apps.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>
                        Vercel shines with previews and Next workflows.
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>
                        Netlify is strong for simple git deploy flows.
                      </span>
                    </li>
                  </ul>
                </article>

                <article
                  id="static-vs-ssr"
                  className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
                >
                  <h3 className="text-sm font-semibold text-neutral-900 mb-1">
                    Static vs SSR
                  </h3>
                  <ul className="space-y-1.5 leading-relaxed">
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>Static is cheap, fast, and cache-friendly.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>SSR/ISR helps when content changes often.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>Kloner output supports either path.</span>
                    </li>
                  </ul>
                </article>
              </div>
            </section>

            {/* Safety */}
            <section id="safety" className={`${SECTION_Y} ${SECTION_SCROLL}`}>
              <SectionHeader
                eyebrow="Trust"
                title="Safety, privacy, fair use"
                description="Kloner is a tool. Responsibility stays with the user."
              />

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <FaqBlock
                  title="How Kloner treats other websites"
                  body={[
                    "Works only with publicly accessible content.",
                    "You must follow terms, laws, and licensing.",
                    "Use as a starting point, not a copy-paste shortcut.",
                  ]}
                />
                <FaqBlock
                  title="Privacy and data handling"
                  body={[
                    "Focused on layout and structure, not personal data.",
                    "Captured material stays inside your account.",
                    "Docs avoid exposing sensitive infrastructure details.",
                  ]}
                />
                <FaqBlock
                  title="Guardrails against abuse"
                  body={[
                    "Credits and pacing discourage automated scraping.",
                    "Some advanced actions are paid-tier gated.",
                    "Abuse can be rate-limited or blocked.",
                  ]}
                />
                <FaqBlock
                  title="Working with your team"
                  body={[
                    "Pro and Agency fit collaboration workflows.",
                    "Standardize previews for faster approvals.",
                    "Unusual risk cases should be discussed before scale.",
                  ]}
                />
              </div>
            </section>

            {/* Library */}
            <section
              id="export-options"
              className={`${SECTION_Y} ${SECTION_SCROLL}`}
            >
              <SectionHeader
                eyebrow="Library"
                title="Practical guides"
                description="High-level, non-sensitive guidance for shipping clean exports."
              />

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <LibraryCard
                  id="routing-guides"
                  icon={<Zap className="h-4 w-4" />}
                  title="Routing guides"
                  lines={[
                    "Simple route structures for exports.",
                    "Common pages: home, landing, sub-pages.",
                    "You decide the framework wiring.",
                  ]}
                />
                <LibraryCard
                  id="seo-templates"
                  icon={<Sparkles className="h-4 w-4" />}
                  title="SEO templates"
                  lines={[
                    "Safe defaults for title/description.",
                    "Clarity and relevance over tricks.",
                    "You own SEO strategy and compliance.",
                  ]}
                />
                <LibraryCard
                  id="font-subsetting"
                  icon={<Camera className="h-4 w-4" />}
                  title="Font subsetting"
                  lines={[
                    "Trim weights you do not use.",
                    "Avoid shipping huge families by default.",
                    "Confirm font licensing for exports.",
                  ]}
                />
                <LibraryCard
                  id="image-optimization"
                  icon={<Camera className="h-4 w-4" />}
                  title="Image optimization"
                  lines={[
                    "Right-size images for the layout.",
                    "Compress without obvious artifacts.",
                    "You choose hosting and asset sources.",
                  ]}
                />
                <LibraryCard
                  id="deploy-checklists"
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  title="Deploy checklists"
                  lines={[
                    "Verify links, copy, and key pages.",
                    "Confirm tracking and consent flows.",
                    "Double-check terms and legal basics.",
                  ]}
                />
                <LibraryCard
                  id="export-options-card"
                  icon={<Rocket className="h-4 w-4" />}
                  title="Export options"
                  lines={[
                    "Move preview to your hosting stack.",
                    "Works with Vercel, Netlify, others.",
                    "After export, you control the code.",
                  ]}
                />
              </div>
            </section>

            {/* About */}
            <section id="about" className={`${SECTION_Y} ${SECTION_SCROLL}`}>
              <SectionHeader
                eyebrow="Company"
                title="About Kloner"
                description="Built for fast iteration without losing ownership of output."
              />

              <div className="mt-6 grid gap-6 md:grid-cols-2 text-[12px] text-neutral-800">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900 mb-2">
                    What we focus on
                  </h3>
                  <ul className="space-y-2 leading-relaxed">
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>Speed: get to a working version quickly.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>
                        Guardrails: keep usage on the right side of fair use.
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>Ownership: exportable code you control.</span>
                    </li>
                  </ul>
                </div>

                <div id="contact">
                  <h3 className="text-sm font-semibold text-neutral-900 mb-2">
                    Contact
                  </h3>
                  <p className="text-[12px] text-neutral-700 mb-3 leading-relaxed">
                    For serious evaluations, reach out with your use case so
                    constraints can be validated early.
                  </p>
                  <ul className="space-y-2 text-[12px] text-neutral-700 leading-relaxed">
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>Product feedback and bug reports.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>Agency needs outside standard tiers.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                      <span>Partnership ideas and integrations.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            {/* Partnerships */}
            <section
              id="partnerships"
              className={`${SECTION_Y} ${SECTION_SCROLL}`}
            >
              <SectionHeader
                eyebrow="Partnerships"
                title="Ways to work together"
                description="Three buckets we expect to support as the product matures."
              />

              <div className="mt-6 grid gap-5 md:grid-cols-3 text-[12px] text-neutral-800">
                <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-neutral-900 mb-1">
                    For creators
                  </h3>
                  <p className="text-[12px] text-neutral-700 leading-relaxed">
                    Build landing pages and mini-sites fast, while owning the
                    exports.
                  </p>
                </article>

                <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-neutral-900 mb-1">
                    Affiliates
                  </h3>
                  <Link href={"/affiliate"}>
                    <span className="inline-flex items-center rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50">
                      Apply now ↗
                    </span>
                  </Link>
                  <p className="text-[12px] text-neutral-700 leading-relaxed">
                    Earn high-yield monthly revenue from commissions.
                  </p>
                </article>

                <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-neutral-900 mb-1">
                    For business
                  </h3>
                  <p className="text-[12px] text-neutral-700 leading-relaxed">
                    Seats, SSO, or formal agreements for teams.
                  </p>
                </article>
              </div>
            </section>

            {/* Connect */}
            <section id="connect" className={`${SECTION_Y} ${SECTION_SCROLL}`}>
              <SectionHeader
                eyebrow="Connect"
                title="Stay up to date"
                description="Light placeholders that can evolve into full pages later."
              />

              <div className="mt-6 grid gap-5 md:grid-cols-3 text-[12px] text-neutral-800">
                <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-neutral-900 mb-1">
                    X / Twitter
                  </h3>
                  <p className="text-[12px] text-neutral-700 leading-relaxed">
                    Short updates and work-in-progress demos.
                  </p>
                </article>

                <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-neutral-900 mb-1">
                    Instagram
                  </h3>
                  <p className="text-[12px] text-neutral-700 leading-relaxed">
                    Visual before-and-after project shots.
                  </p>
                </article>

                <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-neutral-900 mb-1">
                    LinkedIn
                  </h3>
                  <p className="text-[12px] text-neutral-700 leading-relaxed">
                    More formal announcements and case studies.
                  </p>
                </article>
              </div>
            </section>

            {/* Quick start */}
            <section
              id="quick-start"
              className={`${SECTION_Y} ${SECTION_SCROLL}`}
            >
              <SectionHeader
                eyebrow="First session"
                title="Get value in 10 minutes"
                description="A simple first run that teaches the product."
              />

              <div className="mt-6 grid gap-4 text-[12px] text-neutral-800 md:grid-cols-3">
                <QuickStep
                  label="Step 1"
                  title="Clone something familiar"
                  body={[
                    "Pick a known site.",
                    "Capture a snapshot, then generate a preview.",
                  ]}
                />
                <QuickStep
                  label="Step 2"
                  title="Make it yours"
                  body={[
                    "Rewrite the headline and CTA.",
                    "Swap one section to match your offer.",
                  ]}
                />
                <QuickStep
                  label="Step 3"
                  title="Decide your tier"
                  body={[
                    "If limits hit but value is clear, upgrade.",
                    "Otherwise, wait for refills and keep testing.",
                  ]}
                />
              </div>
            </section>
          </div>

          {/* RIGHT: sticky anchor list */}
          <div className="hidden lg:block">
            <RightQuickNav />
          </div>
        </div>
      </main>

      {/* <Footer /> */}
    </div>
  );
}

/* ───────────────── helpers & small components ───────────────── */

function Badge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-neutral-800 shadow-sm">
      {label}
    </span>
  );
}

function SectionHeader(props: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500 mb-1">
        {props.eyebrow}
      </p>
      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-900">
        {props.title}
      </h2>
      <p className="mt-2 max-w-2xl text-[12px] sm:text-sm text-neutral-600 leading-relaxed">
        {props.description}
      </p>
    </div>
  );
}

function FeatureCard(props: { step: string; title: string; body: string }) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="inline-flex w-fit rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-700 shadow-sm">
        Step {props.step}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-neutral-900">
        {props.title}
      </h3>
      <p className="mt-2 text-[12px] leading-relaxed text-neutral-700">
        {props.body}
      </p>
    </article>
  );
}

/* Credits visual helpers */

/* Plans */

function PlanCard(props: {
  label: string;
  description: string;
  bullets: string[];
  cta: string;
  href: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex h-full flex-col rounded-2xl border bg-white p-5 shadow-sm ${
        props.highlight
          ? "border-neutral-900 shadow-md shadow-neutral-200"
          : "border-neutral-200"
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-900">
          {props.label}
        </h3>
        {props.highlight && (
          <span className="inline-flex items-center rounded-lg border border-neutral-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-700 shadow-sm">
            Most popular
          </span>
        )}
      </div>
      <p className="text-[12px] text-neutral-600 mb-3 leading-relaxed">
        {props.description}
      </p>
      <ul className="mb-4 space-y-1.5 text-[12px] text-neutral-700 leading-relaxed">
        {props.bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-500 shrink-0" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto">
        <Link
          href={props.href}
          className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50"
        >
          {props.cta}
          <Rocket className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

/* FAQ */

function FaqBlock({ title, body }: { title: string; body: string[] }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-neutral-900 mb-2">{title}</h3>
      <ul className="space-y-2 text-[12px] text-neutral-700 leading-relaxed">
        {body.map((b) => (
          <li key={b} className="flex gap-2">
            <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* Library */

function LibraryCard(props: {
  id: string;
  icon: React.ReactNode;
  title: string;
  lines: string[];
}) {
  return (
    <article
      id={props.id}
      className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-2 flex items-center gap-2">
        <div
          className="inline-flex h-7 w-7 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(0,0,0,0.04)", color: "#404040" }}
        >
          {props.icon}
        </div>
        <h3 className="text-sm font-semibold text-neutral-900">
          {props.title}
        </h3>
      </div>
      <ul className="space-y-2 text-[12px] text-neutral-700 leading-relaxed">
        {props.lines.map((text) => (
          <li key={text} className="flex gap-2">
            <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function QuickStep(props: { label: string; title: string; body: string[] }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex items-center rounded-lg border border-neutral-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-700 shadow-sm">
          {props.label}
        </span>
        <h3 className="text-xs font-semibold text-neutral-900">
          {props.title}
        </h3>
      </div>
      <ul className="space-y-2 text-[12px] text-neutral-700 leading-relaxed">
        {props.body.map((b) => (
          <li key={b} className="flex gap-2">
            <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
