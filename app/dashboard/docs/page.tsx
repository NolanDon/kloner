// app/dashboard/docs/page.tsx
import Link from "next/link";
import {
    CheckCircle2,
    Camera,
    Rocket,
    Sparkles,
    Lock,
    CreditCard,
    Zap,
    Shield,
} from "lucide-react";
import Footer from "@/components/Footer";
import { HashScrollHighlighter } from "./HashScrollHighlighter";
import { RightQuickNav } from "./RightQuickNav";

const ACCENT = "#FF8D21";

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
                            <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                                <span>Kloner · Product Guide</span>
                            </div>

                            <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-7 sm:px-8 sm:py-9 shadow-sm">
                                <h1 className="text-3xl sm:text-4xl tracking-tight text-neutral-900">
                                    Documentation
                                </h1>
                                <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                                    Capture a site, generate an editable preview, customize it, then export or deploy.
                                    This page explains the workflow, credits, plans, and guardrails.
                                </p>

                                <div className="mt-6 flex flex-wrap gap-2.5 text-xs">
                                    <Badge icon={<Camera className="h-3 w-3" />} label="Website capture" />
                                    <Badge icon={<Sparkles className="h-3 w-3" />} label="Editable previews" />
                                    <Badge icon={<Rocket className="h-3 w-3" />} label="Launch-ready output" />
                                    <Badge icon={<Lock className="h-3 w-3" />} label="Fair-use credits" />
                                </div>
                            </div>
                        </section>

                        {/* Features */}
                        <section id="features" className={`${SECTION_Y} ${SECTION_SCROLL}`}>
                            <SectionHeader
                                eyebrow="Core workflow"
                                title="From URL to your version"
                                description="Four steps. The editor stays visual, the output stays yours."
                            />

                            <div className="mt-6 grid gap-5 md:grid-cols-2">
                                <FeatureCard
                                    icon={<Camera className="h-5 w-5" />}
                                    title="1. Capture a URL"
                                    badge="Step 1"
                                    items={[
                                        "We take a snapshot of the page layout.",
                                        "You keep a reference point for comparison.",
                                    ]}
                                />
                                <FeatureCard
                                    icon={<Sparkles className="h-5 w-5" />}
                                    title="2. Generate a preview"
                                    badge="Step 2"
                                    items={[
                                        "Turns the snapshot into editable blocks.",
                                        "Regenerate any time as your direction changes.",
                                    ]}
                                />
                                <FeatureCard
                                    icon={<CheckCircle2 className="h-5 w-5" />}
                                    title="3. Edit visually"
                                    badge="Step 3"
                                    items={[
                                        "Update copy, sections, layout, colors, and CTA hierarchy.",
                                        "Stay in one workspace instead of juggling tools.",
                                    ]}
                                />
                                <FeatureCard
                                    icon={<Rocket className="h-5 w-5" />}
                                    title="4. Export or deploy"
                                    badge="Step 4"
                                    items={[
                                        "Export code or ship through your deployment flow.",
                                        "Duplicate versions without losing earlier work.",
                                    ]}
                                />
                            </div>
                        </section>

                        {/* Credits */}
                        <section id="credits" className={`${SECTION_Y} ${SECTION_SCROLL}`}>
                            <SectionHeader
                                eyebrow="Usage limits"
                                title="Credits are simple"
                                description="Two counters. Clear limits. No silent failures."
                            />

                            <div className="mt-6 grid gap-6 md:grid-cols-[1.35fr,1fr]">
                                <div className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6 shadow-sm">
                                    <h3 className="text-sm font-semibold text-neutral-900 mb-2">
                                        What spends credits
                                    </h3>
                                    <ul className="space-y-2 text-[12px] text-neutral-700 leading-relaxed">
                                        <li>
                                            <span className="font-semibold">Snapshots</span> capture a fresh state of a URL.
                                        </li>
                                        <li>
                                            <span className="font-semibold">Previews</span> generate an editable project from a snapshot.
                                        </li>
                                    </ul>

                                    <h3 className="mt-5 text-sm font-semibold text-neutral-900 mb-2">
                                        Typical daily shape
                                    </h3>
                                    <div className="space-y-2 text-[12px] text-neutral-700">
                                        <TierRow
                                            label="Free"
                                            snapshot="Light daily snapshots"
                                            preview="Enough previews to evaluate"
                                            emphasis
                                        />
                                        <TierRow
                                            label="Pro"
                                            snapshot="Comfortable daily volume"
                                            preview="Active building allowance"
                                        />
                                        <TierRow
                                            label="Agency"
                                            snapshot="Client-scale volume"
                                            preview="High iteration volume"
                                        />
                                        <TierRow
                                            label="Enterprise"
                                            snapshot="Custom"
                                            preview="Custom"
                                        />
                                    </div>

                                    <h3 className="mt-5 text-sm font-semibold text-neutral-900 mb-2">
                                        When you hit the limit
                                    </h3>
                                    <ul className="space-y-2 text-[12px] text-neutral-700 leading-relaxed">
                                        <li>Buttons show the limit state immediately.</li>
                                        <li>Upgrade prompts explain what unlocks.</li>
                                        <li>Credits refill automatically on schedule.</li>
                                    </ul>
                                </div>

                                <div className="space-y-4">
                                    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
                                        <h3 className="text-sm font-semibold text-neutral-900 mb-3">
                                            Demo · Counters
                                        </h3>
                                        <div className="space-y-3 text-xs">
                                            <PlanChip label="Current plan" value="Free" />
                                            <DemoCreditPill label="Snapshot actions" used={2} total={3} />
                                            <DemoCreditPill label="Preview generations" used={4} total={5} />
                                            <p className="mt-2 text-[11px] text-neutral-500">
                                                When a counter hits zero, that action pauses until the refill.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-[12px] text-emerald-900 shadow-sm">
                                        <div className="flex items-start gap-2">
                                            <Shield className="mt-0.5 h-4 w-4" />
                                            <div>
                                                <p className="font-semibold mb-1">
                                                    No credits lost on system errors
                                                </p>
                                                <p className="leading-relaxed">
                                                    If something fails on our side, the attempt should not consume credits.
                                                </p>
                                            </div>
                                        </div>
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
                                        "Limited daily snapshots + previews",
                                        "Full core editor access",
                                        "No payment details",
                                    ]}
                                    cta="Get started"
                                    href="/login?mode=signup"
                                />
                                <PlanCard
                                    label="Pro"
                                    highlight
                                    description="For solo founders and small teams."
                                    bullets={[
                                        "Higher daily allowances",
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
                                        "High-volume usage",
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
                                            <span>Vercel shines with previews and Next workflows.</span>
                                        </li>
                                        <li className="flex gap-2">
                                            <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                                            <span>Netlify is strong for simple git deploy flows.</span>
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
                        <section id="export-options" className={`${SECTION_Y} ${SECTION_SCROLL}`}>
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
                                            <span>Guardrails: keep usage on the right side of fair use.</span>
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
                                        For serious evaluations, reach out with your use case so constraints can be validated early.
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
                        <section id="partnerships" className={`${SECTION_Y} ${SECTION_SCROLL}`}>
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
                                        Build landing pages and mini-sites fast, while owning the exports.
                                    </p>
                                </article>

                                <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                                    <h3 className="text-sm font-semibold text-neutral-900 mb-1">
                                        Affiliates
                                    </h3>
                                    <Link
                                        href={"/affiliate"}
                                    >
                                        <div className="flex items-center bg-accent py-1 px-2 rounded-full justify-between gap-2 mb-1 max-w-[80px]">
                                            <span className="text-[10px] text-white">
                                                Apply Now ↗
                                            </span>
                                        </div>
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
                        <section id="quick-start" className={`${SECTION_Y} ${SECTION_SCROLL}`}>
                            <SectionHeader
                                eyebrow="First session"
                                title="Get value in 10 minutes"
                                description="A simple first run that teaches the product."
                            />

                            <div className="mt-6 grid gap-4 text-[12px] text-neutral-800 md:grid-cols-3">
                                <QuickStep
                                    label="Step 1"
                                    title="Clone something familiar"
                                    body={["Pick a known site.", "Capture a snapshot, then generate a preview."]}
                                />
                                <QuickStep
                                    label="Step 2"
                                    title="Make it yours"
                                    body={["Rewrite the headline and CTA.", "Swap one section to match your offer."]}
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

function Badge({ icon, label }: { icon: React.ReactNode; label: string }) {
    return (
        <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-neutral-800 shadow-sm border border-neutral-200">
            {icon}
            <span>{label}</span>
        </span>
    );
}

function SectionHeader(props: { eyebrow: string; title: string; description: string }) {
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

function AnchorCard({
    href,
    title,
    children,
}: {
    href: string;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <Link
            href={href}
            className="group rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm hover:border-neutral-300 hover:shadow-md transition"
        >
            <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[12px] font-semibold text-neutral-900">{title}</span>
                <span className="text-[10px] text-neutral-400 group-hover:text-neutral-700">
                    Jump ↗
                </span>
            </div>
            <p className="text-[11px] text-neutral-600 leading-relaxed">{children}</p>
        </Link>
    );
}

function FeatureCard(props: {
    icon: React.ReactNode;
    title: string;
    badge: string;
    items: string[];
    demo?: React.ReactNode;
}) {
    return (
        <article className="flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
                <div className="rounded-full p-2 shrink-0" style={{ backgroundColor: "rgba(255,141,33,0.08)" }}>
                    <div className="rounded-full bg-white p-1 shadow-sm" style={{ color: ACCENT }}>
                        {props.icon}
                    </div>
                </div>
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="rounded-full bg-accent text-neutral-50 px-2 py-0.5 text-[10px]">
                            {props.badge}
                        </span>
                        <h3 className="text-sm font-semibold text-neutral-900">{props.title}</h3>
                    </div>
                    <ul className="mt-2 space-y-1.5 text-[12px] text-neutral-700 leading-relaxed">
                        {props.items.map((it) => (
                            <li key={it} className="flex gap-2">
                                <span className="mt-[7px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                                <span>{it}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {props.demo && (
                <div className="mt-4 rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                        Demo
                    </p>
                    {props.demo}
                </div>
            )}
        </article>
    );
}

/* Credits visual helpers */

function PlanChip({ label, value }: { label: string; value: string }) {
    return (
        <div className="inline-flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1 text-[11px] text-neutral-800">
            <CreditCard className="h-3 w-3 text-neutral-500" />
            <span className="font-semibold">{label}</span>
            <span className="text-neutral-500">·</span>
            <span>{value}</span>
        </div>
    );
}

function DemoCreditPill({ label, used, total }: { label: string; used: number; total: number }) {
    const remaining = Math.max(total - used, 0);
    const pct = Math.max(0, Math.min(100, (remaining / total) * 100));

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
                <span className="text-neutral-600">{label}</span>
                <span className="font-semibold text-neutral-900">
                    {remaining}/{total} left
                </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                <div
                    className="h-full rounded-full"
                    style={{
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, ${ACCENT}, #f3b27c)`,
                    }}
                />
            </div>
        </div>
    );
}

function TierRow(props: {
    label: string;
    snapshot: string;
    preview: string;
    emphasis?: boolean;
}) {
    const emphasis = !!props.emphasis;

    return (
        <div
            className={`flex items-center justify-between rounded-xl px-3 py-2 ${emphasis ? "bg-accent text-neutral-50" : "bg-neutral-50 text-neutral-800 border border-neutral-200"
                }`}
        >
            <div className="flex items-center gap-2 text-[11px]">
                <span className="font-semibold">{props.label}</span>
            </div>
            <div className="flex flex-col items-end text-[11px] leading-tight">
                <span className={emphasis ? "text-neutral-50" : "text-neutral-800"}>{props.snapshot}</span>
                <span className={emphasis ? "text-neutral-50" : "text-neutral-800"}>{props.preview}</span>
            </div>
        </div>
    );
}

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
            className={`flex h-full flex-col rounded-2xl border bg-white p-5 shadow-sm ${props.highlight ? "border-neutral-900 shadow-md shadow-neutral-200" : "border-neutral-200"
                }`}
        >
            <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-neutral-900">{props.label}</h3>
                {props.highlight && (
                    <span className="rounded-full whitespace-nowrap bg-accent px-2 py-0.5 text-[10px] font-semibold text-neutral-50">
                        Most popular
                    </span>
                )}
            </div>
            <p className="text-[12px] text-neutral-600 mb-3 leading-relaxed">{props.description}</p>
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
                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-neutral-50 hover:bg-accent/90 transition"
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
        <article id={props.id} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
                <div
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full"
                    style={{ backgroundColor: "rgba(255,141,33,0.08)", color: ACCENT }}
                >
                    {props.icon}
                </div>
                <h3 className="text-sm font-semibold text-neutral-900">{props.title}</h3>
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
                <span className="rounded-full whitespace-nowrap bg-accent px-2 py-0.5 text-[10px] font-semibold text-neutral-50">
                    {props.label}
                </span>
                <h3 className="text-xs font-semibold text-neutral-900">{props.title}</h3>
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
