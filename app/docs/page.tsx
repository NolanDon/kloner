// app/docs/page.tsx
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
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";

const ACCENT = "#f55f2a";

export default function DocsPage() {
    return (
        <div className="min-h-screen bg-neutral-50 text-neutral-900 py-[80px]">
            <NavBar />

            <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 pt-8 pb-20">
                {/* Hero */}
                <section className="mb-10">
                    <div className="inline-flex items-center gap-2 rounded-full bg-accent text-neutral-50 px-3 py-1 text-[11px] mb-4">
                        <span>Kloner · Product Guide</span>
                    </div>

                    <div className="rounded-3xl border border-neutral-200 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 px-6 py-8 sm:px-8 sm:py-10 shadow-sm">
                        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-neutral-900">
                            Documentation
                        </h1>
                        <p className="mt-3 max-w-2xl text-sm sm:text-base text-neutral-600">
                            Kloner lets you capture a website, turn it into an editable preview, and
                            ship a polished version as your own project. This page explains the core
                            features, how credits work, and what the different plans unlock.
                        </p>

                        <div className="mt-6 flex flex-wrap gap-3 text-xs">
                            <Badge icon={<Camera className="h-3 w-3" />} label="Website capture" />
                            <Badge icon={<Sparkles className="h-3 w-3" />} label="Editable previews" />
                            <Badge icon={<Rocket className="h-3 w-3" />} label="Launch-ready output" />
                            <Badge icon={<Lock className="h-3 w-3" />} label="Fair-use credits" />
                        </div>
                    </div>
                </section>

                {/* Quick navigation */}
                <section className="mb-12">
                    <div className="grid gap-3 sm:grid-cols-4 text-xs">
                        <AnchorCard href="#features" title="Features">
                            End-to-end flow from URL capture to launch-ready preview.
                        </AnchorCard>
                        <AnchorCard href="#credits" title="Credit system">
                            How daily usage works and what is included for each tier.
                        </AnchorCard>
                        <AnchorCard href="#plans" title="Payment plans">
                            Overview of Free, Pro, and Agency usage patterns.
                        </AnchorCard>
                        <AnchorCard href="#safety" title="Safety & fairness">
                            How we design Kloner to be safe, fair, and abuse-resistant.
                        </AnchorCard>
                    </div>
                </section>

                {/* Features */}
                <section id="features" className="mb-16">
                    <SectionHeader
                        eyebrow="Core workflow"
                        title="From someone else’s site to your own version"
                        description="Kloner is built around a simple, guided flow: capture, preview, edit, and publish. Each step is designed to be visual, safe, and repeatable."
                    />

                    <div className="mt-6 grid gap-5 md:grid-cols-2">
                        <FeatureCard
                            icon={<Camera className="h-5 w-5" />}
                            title="1. Capture a clean snapshot"
                            badge="Step 1"
                            items={[
                                "Paste any public URL you want to explore.",
                                "Kloner creates a visual snapshot of the page for you.",
                                "You can keep multiple snapshots for the same project and label them however you like.",
                            ]}
                            demo={<DemoScreenshotTile />}
                        />
                        <FeatureCard
                            icon={<Sparkles className="h-5 w-5" />}
                            title="2. Generate an editable preview"
                            badge="Step 2"
                            items={[
                                "Pick any snapshot and tell Kloner to create a preview.",
                                "The preview looks like the original but is now editable inside your workspace.",
                                "You can revisit and regenerate previews as your ideas evolve.",
                            ]}
                            demo={<DemoPreviewTile />}
                        />
                        <FeatureCard
                            icon={<CheckCircle2 className="h-5 w-5" />}
                            title="3. Edit visually"
                            badge="Step 3"
                            items={[
                                "Change copy, swap sections, adjust layouts, and tailor the design to your brand.",
                                "You stay in one focused editor instead of juggling multiple tools.",
                                "Experiment freely: your original snapshot is always preserved as a reference.",
                            ]}
                            demo={<DemoEditorHint />}
                        />
                        <FeatureCard
                            icon={<Rocket className="h-5 w-5" />}
                            title="4. Export or launch"
                            badge="Step 4"
                            items={[
                                "Once you’re happy with the preview, export or connect it to your deployment flow.",
                                "Paid plans unlock direct handoff into supported hosting providers for a smoother launch.",
                                "You can revisit, duplicate, and evolve previous versions without losing your work.",
                            ]}
                            demo={<DemoDeployCTA />}
                        />
                    </div>
                </section>

                {/* Credits */}
                <section id="credits" className="mb-16">
                    <SectionHeader
                        eyebrow="Usage limits"
                        title="How the credit system works"
                        description="Credits keep usage predictable and fair. They also create natural upgrade points for teams that outgrow the Free tier."
                    />

                    <div className="mt-6 grid gap-6 md:grid-cols-[1.4fr,1fr]">
                        {/* Explanation */}
                        <div className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6 shadow-sm">
                            <h3 className="text-sm font-semibold text-neutral-900 mb-2">
                                Two things that use credits
                            </h3>
                            <ul className="space-y-2 text-xs text-neutral-700">
                                <li>
                                    <span className="font-semibold">Snapshot actions</span> – every
                                    time you ask Kloner to capture a fresh snapshot of a URL, it uses
                                    a small number of credits.
                                </li>
                                <li>
                                    <span className="font-semibold">Preview generations</span> – each
                                    time you spin up a new editable preview from a snapshot, it uses
                                    another small batch of credits.
                                </li>
                            </ul>

                            <h3 className="mt-4 text-sm font-semibold text-neutral-900 mb-2">
                                Typical daily allowances
                            </h3>
                            <div className="space-y-2 text-xs text-neutral-700">
                                <TierRow
                                    label="Free"
                                    snapshot="A handful of snapshots / day"
                                    preview="Enough previews to test the product"
                                    emphasis
                                />
                                <TierRow
                                    label="Pro"
                                    snapshot="Comfortable daily snapshot allowance"
                                    preview="Generous preview allowance for active builders"
                                />
                                <TierRow
                                    label="Agency"
                                    snapshot="High volume for client work"
                                    preview="High volume for project iterations"
                                />
                                <TierRow
                                    label="Enterprise"
                                    snapshot="Tailored to your team"
                                    preview="Tailored to your workloads"
                                />
                            </div>

                            <h3 className="mt-5 text-sm font-semibold text-neutral-900 mb-2">
                                What happens when credits run out
                            </h3>
                            <ul className="space-y-2 text-xs text-neutral-700">
                                <li>
                                    Snapshot and preview buttons clearly show when you’ve hit your
                                    daily limit on the current plan.
                                </li>
                                <li>
                                    Instead of silently failing, Kloner shows a gentle upgrade prompt
                                    that explains what you’d gain by moving up a tier.
                                </li>
                                <li>
                                    Credits automatically refill on a rolling daily basis, so casual
                                    users can keep using the Free plan without friction.
                                </li>
                            </ul>
                        </div>

                        {/* Demo / visualizer */}
                        <div className="space-y-4">
                            <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
                                <h3 className="text-sm font-semibold text-neutral-900 mb-3">
                                    Demo · Credit counters
                                </h3>
                                <div className="space-y-3 text-xs">
                                    <PlanChip label="Current plan" value="Free" />
                                    <DemoCreditPill
                                        label="Snapshot actions"
                                        used={2}
                                        total={3}
                                    />
                                    <DemoCreditPill
                                        label="Preview generations"
                                        used={4}
                                        total={5}
                                    />
                                    <p className="mt-2 text-[11px] text-neutral-500">
                                        Once a counter reaches zero, Kloner pauses that action for the
                                        day and guides you toward either upgrading or trying again
                                        tomorrow.
                                    </p>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs text-emerald-900 shadow-sm">
                                <div className="flex items-start gap-2">
                                    <Shield className="mt-0.5 h-4 w-4" />
                                    <div>
                                        <p className="font-semibold mb-1">
                                            Fairness principle: no credits lost on system errors
                                        </p>
                                        <p>
                                            If something on our side fails, that attempt doesn’t count
                                            against your daily credits. Credits are meant to reflect
                                            successful work, not failed attempts.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Plans */}
                <section id="plans" className="mb-16">
                    <SectionHeader
                        eyebrow="Monetization"
                        title="Plan overview"
                        description="Kloner is usable on Free, and intentionally rewarding on paid tiers. The idea is simple: real value at every level, and extra power as you grow."
                    />

                    <div className="mt-6 grid gap-5 md:grid-cols-3">
                        <PlanCard
                            label="Free"
                            highlight={false}
                            description="Perfect for quick experiments and trying Kloner without commitment."
                            bullets={[
                                "Limited daily snapshots and previews",
                                "Core editor experience included",
                                "No payment details required",
                                "Good for solo testing and personal tinkering",
                            ]}
                            cta="Get started free"
                            href="/signup"
                        />
                        <PlanCard
                            label="Pro"
                            highlight
                            description="Built for solo founders, freelancers, and small product teams."
                            bullets={[
                                "Higher daily allowances",
                                "Priority processing windows",
                                "Access to more advanced editor capabilities",
                                "Support for streamlined launch workflows",
                            ]}
                            cta="See Pro details"
                            href="/pricing"
                        />
                        <PlanCard
                            label="Agency"
                            highlight={false}
                            description="For agencies and studios cloning and customizing sites for clients."
                            bullets={[
                                "High-volume usage patterns supported",
                                "Agency-friendly credit allowances",
                                "Features designed for client delivery pipelines",
                                "Flexible options for custom agreements",
                            ]}
                            cta="Explore Agency options"
                            href="/pricing"
                        />
                    </div>

                    <p className="mt-4 text-[11px] text-neutral-500">
                        Enterprise discussions focus on scale, governance, and custom workflows.
                        Reach out through in-app contact options if you need something beyond the
                        standard tiers.
                    </p>
                </section>

                {/* Safety & fairness (non-technical) */}
                <section id="safety" className="mb-16">
                    <SectionHeader
                        eyebrow="Trust & boundaries"
                        title="Safety, privacy, and fair use"
                        description="Kloner is designed to be useful for builders while respecting websites, users, and hosting providers."
                    />

                    <div className="mt-6 grid gap-5 md:grid-cols-2">
                        <FaqBlock
                            title="How Kloner treats other websites"
                            body={[
                                "Kloner only works with publicly accessible content.",
                                "You are responsible for ensuring that your use respects the original website’s terms, local laws, and any relevant licensing.",
                                "We encourage users to treat Kloner as a starting point for their own original work, not a way to pass off someone else’s site as-is.",
                            ]}
                        />
                        <FaqBlock
                            title="Privacy and data handling"
                            body={[
                                "Kloner focuses on page visuals and layout, not on tracking individual visitors or private user data.",
                                "Captured material is kept inside your account and used to power your previews and projects.",
                                "We do not expose internal implementation details or any sensitive infrastructure information in public docs.",
                            ]}
                        />
                        <FaqBlock
                            title="Guardrails against abuse"
                            body={[
                                "Daily credits and sensible pacing are built in to discourage automated abuse and scraping behavior.",
                                "Certain advanced actions are locked to paid plans where there is a clearer accountability trail.",
                                "Suspicious or abusive usage patterns can be rate-limited or blocked to protect the platform and other users.",
                            ]}
                        />
                        <FaqBlock
                            title="Working with your team"
                            body={[
                                "Pro and Agency tiers are designed for collaborative workflows while still keeping one clear account owner.",
                                "Teams can standardize on Kloner for consistent previews and faster client sign-offs.",
                                "If your use case is unusual or high-risk, talk to us before scaling up, so we can help design an appropriate setup.",
                            ]}
                        />
                    </div>
                </section>

                {/* Library: export + routing, SEO, fonts, images, deploy */}
                <section id="export-options" className="mb-16">
                    <SectionHeader
                        eyebrow="Library"
                        title="Export options and practical guides"
                        description="These sections stay high-level and are written for both technical and non-technical users. They describe responsibilities and tradeoffs without exposing internal systems."
                    />

                    <div className="mt-6 grid gap-5 md:grid-cols-2">
                        <LibraryCard
                            id="routing-guides"
                            icon={<Zap className="h-4 w-4" />}
                            title="Routing guides"
                            lines={[
                                "Explains how exported projects can be organised into simple, predictable routes.",
                                "Covers common patterns such as home pages, landing pages, and basic sub-pages.",
                                "You decide how to wire these routes into your own framework or hosting provider.",
                            ]}
                        />
                        <LibraryCard
                            id="seo-templates"
                            icon={<Sparkles className="h-4 w-4" />}
                            title="SEO templates"
                            lines={[
                                "Outlines safe defaults for titles, descriptions, and basic on-page structure.",
                                "Focuses on clarity and relevance, not on exploiting search engines.",
                                "You remain responsible for any SEO strategy, claims, and compliance.",
                            ]}
                        />
                        <LibraryCard
                            id="font-subsetting"
                            icon={<Camera className="h-4 w-4" />}
                            title="Font subsetting"
                            lines={[
                                "Describes why trimming unused font weights and character sets improves load time.",
                                "Avoids bundling full font families when only a few styles are needed.",
                                "You are responsible for licensing any fonts you choose to use in exports.",
                            ]}
                        />
                        <LibraryCard
                            id="image-optimization"
                            icon={<Camera className="h-4 w-4" />}
                            title="Image optimization"
                            lines={[
                                "Explains basic sizing, compression, and responsive image ideas in plain language.",
                                "Encourages you to keep file sizes reasonable without damaging clarity.",
                                "You choose where images are hosted and remain responsible for the assets you upload.",
                            ]}
                        />
                        <LibraryCard
                            id="deploy-checklists"
                            icon={<CheckCircle2 className="h-4 w-4" />}
                            title="Deploy checklists"
                            lines={[
                                "Provides simple pre-launch checks: links working, copy reviewed, legal pages present.",
                                "Highlights that you must verify any tracking pixels, consent flows, and policies.",
                                "Reminds you to confirm that the project respects all relevant terms and regulations.",
                            ]}
                        />
                        <LibraryCard
                            id="export-options-card"
                            icon={<Rocket className="h-4 w-4" />}
                            title="Export options"
                            lines={[
                                "Summarises the main ways to move from preview to your own hosting environment.",
                                "Keeps the language platform-agnostic so you can choose Vercel, Netlify, or others.",
                                "Clarifies that once exported, you own and control the project code and its use.",
                            ]}
                        />
                    </div>
                </section>

                {/* Gentle “how to get value fast” section */}
                <section id="quick-start" className="mb-10">
                    <SectionHeader
                        eyebrow="First session"
                        title="A simple way to get value in 10 minutes"
                        description="If you’re new to Kloner, this is a straightforward flow to run on your first day."
                    />

                    <div className="mt-6 grid gap-4 text-xs text-neutral-800 md:grid-cols-3">
                        <QuickStep
                            label="Step 1"
                            title="Clone something familiar"
                            body={[
                                "Pick a site you already know well.",
                                "Capture a snapshot and generate a preview.",
                            ]}
                        />
                        <QuickStep
                            label="Step 2"
                            title="Make it yours"
                            body={[
                                "Change the headline to match your product.",
                                "Swap one section to reflect your own offer.",
                            ]}
                        />
                        <QuickStep
                            label="Step 3"
                            title="Decide if you need more"
                            body={[
                                "If you hit limits but see value, upgrade straight from the prompts.",
                                "If not, let credits reset and keep exploring at your own pace.",
                            ]}
                        />
                    </div>
                </section>
            </main>
            <Footer />
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
            <p className="mt-1 max-w-2xl text-xs sm:text-sm text-neutral-600">
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
                <span className="text-[12px] font-semibold text-neutral-900">
                    {title}
                </span>
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
                <div
                    className="rounded-full p-2 shrink-0"
                    style={{ backgroundColor: "rgba(245,95,42,0.08)" }}
                >
                    <div className="rounded-full bg-white p-1 shadow-sm" style={{ color: ACCENT }}>
                        {props.icon}
                    </div>
                </div>
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="rounded-full bg-accent text-neutral-50 px-2 py-0.5 text-[10px] font-semibold">
                            {props.badge}
                        </span>
                        <h3 className="text-sm font-semibold text-neutral-900">
                            {props.title}
                        </h3>
                    </div>
                    <ul className="mt-2 space-y-1.5 text-[11px] text-neutral-700">
                        {props.items.map((it) => (
                            <li key={it} className="flex gap-2">
                                <span className="mt-[3px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
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

/* Demo components (visual only) */

function DemoScreenshotTile() {
    return (
        <div className="flex items-center gap-3">
            <div className="h-10 w-16 rounded-lg bg-gradient-to-br from-neutral-200 to-neutral-100 border border-neutral-200" />
            <div className="flex-1">
                <div className="h-2.5 w-20 rounded bg-neutral-200 mb-1" />
                <div className="h-2 w-32 rounded bg-neutral-100" />
            </div>
        </div>
    );
}

function DemoPreviewTile() {
    return (
        <div className="flex items-center gap-3">
            <div className="h-10 w-16 rounded-lg bg-gradient-to-br from-white to-neutral-100 border border-neutral-200 shadow-sm" />
            <div className="flex-1">
                <div className="inline-flex items-center gap-1 rounded-full bg-accent text-white px-2 py-0.5 text-[10px] mb-1">
                    <Sparkles className="h-3 w-3" />
                    <span>Preview created</span>
                </div>
                <div className="h-2 w-28 rounded bg-neutral-100" />
            </div>
        </div>
    );
}

function DemoEditorHint() {
    return (
        <div className="space-y-2 text-[11px]">
            <p className="text-neutral-600">
                Edit headings, paragraphs, and sections visually. Kloner keeps your working
                version and your original snapshot separate.
            </p>
        </div>
    );
}

function DemoDeployCTA() {
    return (
        <div className="flex items-center justify-between gap-3 text-[11px]">
            <div className="text-neutral-600">
                <p className="font-semibold text-neutral-800">Ready to launch?</p>
                <p className="text-[11px] text-neutral-600">
                    Paid plans unlock direct integrations with popular hosting platforms.
                </p>
            </div>
            <button
                className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm"
                style={{ backgroundColor: ACCENT }}
                type="button"
            >
                <Rocket className="h-3 w-3" />
                <span>See launch options</span>
            </button>
        </div>
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

function DemoCreditPill({
    label,
    used,
    total,
}: {
    label: string;
    used: number;
    total: number;
}) {
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
                        background: `linear-gradient(90deg, ${ACCENT}, #f97316)`,
                    }}
                />
            </div>
        </div>
    );
}

function TierRow({
    label,
    snapshot,
    preview,
    emphasis,
}: {
    label: string;
    snapshot: string;
    preview: string;
    emphasis?: boolean;
}) {
    return (
        <div
            className={`flex items-center justify-between rounded-xl px-3 py-2 ${emphasis
                ? "bg-accent text-neutral-50"
                : "bg-neutral-50 text-neutral-800 border border-neutral-200"
                }`}
        >
            <div className="flex items-center gap-2 text-[11px]">
                <span className="font-semibold">{label}</span>
            </div>
            <div className="flex flex-col items-end text-[11px]">
                <span className="text-neutral-400">
                    <span className={emphasis ? "text-neutral-50" : "text-neutral-800"}>
                        {snapshot}
                    </span>
                </span>
                <span className="text-neutral-400">
                    <span className={emphasis ? "text-neutral-50" : "text-neutral-800"}>
                        {preview}
                    </span>
                </span>
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
            className={`flex h-full flex-col rounded-2xl border bg-white p-5 shadow-sm ${props.highlight
                ? "border-neutral-900 shadow-md shadow-neutral-200"
                : "border-neutral-200"
                }`}
        >
            <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-neutral-900">{props.label}</h3>
                {props.highlight && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-neutral-50">
                        Most popular
                    </span>
                )}
            </div>
            <p className="text-xs text-neutral-600 mb-3">{props.description}</p>
            <ul className="mb-4 space-y-1.5 text-[11px] text-neutral-700">
                {props.bullets.map((b) => (
                    <li key={b} className="flex gap-2">
                        <span className="mt-[5px] h-1 w-1 rounded-full bg-neutral-500 shrink-0" />
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

/* FAQ / text blocks */

function FaqBlock({ title, body }: { title: string; body: string[] }) {
    return (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-neutral-900 mb-1">{title}</h3>
            <ul className="space-y-1.5 text-[11px] text-neutral-700">
                {body.map((b) => (
                    <li key={b} className="flex gap-2">
                        <span className="mt-[5px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                        <span>{b}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/* Library cards */

function LibraryCard({
    id,
    icon,
    title,
    lines,
}: {
    id: string;
    icon: React.ReactNode;
    title: string;
    lines: string[];
}) {
    return (
        <article
            id={id}
            className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
        >
            <div className="mb-2 flex items-center gap-2">
                <div
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full"
                    style={{ backgroundColor: "rgba(245,95,42,0.08)", color: ACCENT }}
                >
                    {icon}
                </div>
                <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
            </div>
            <ul className="space-y-1.5 text-[11px] text-neutral-700">
                {lines.map((text) => (
                    <li key={text} className="flex gap-2">
                        <span className="mt-[5px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                        <span>{text}</span>
                    </li>
                ))}
            </ul>
        </article>
    );
}

function QuickStep(props: {
    label: string;
    title: string;
    body: string[];
}) {
    return (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-2">
                <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-neutral-50">
                    {props.label}
                </span>
                <h3 className="text-xs font-semibold text-neutral-900">{props.title}</h3>
            </div>
            <ul className="space-y-1.5 text-[11px] text-neutral-700">
                {props.body.map((b) => (
                    <li key={b} className="flex gap-2">
                        <span className="mt-[5px] h-1 w-1 rounded-full bg-neutral-400 shrink-0" />
                        <span>{b}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
