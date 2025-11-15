// app/legal/kloner-vercel-eula/page.tsx
"use client";

import NavBar from "@/components/NavBar";

const ACCENT = "#f55f2a";

export default function KlonerVercelEulaPage() {
    return (
        <div className="min-h-screen bg-neutral-50 text-neutral-900">
            <NavBar />
            <main className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 pt-[96px] pb-16">
                {/* Eyebrow + title */}
                <section className="mb-8">
                    <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-neutral-700 border border-neutral-200 shadow-sm mb-4">
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span>Kloner · Vercel Integration</span>
                    </div>
                    <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-neutral-900">
                        Kloner + Vercel Integration End User License Agreement
                    </h1>
                    <p className="mt-3 text-sm sm:text-base text-neutral-600 max-w-2xl">
                        This Kloner + Vercel Integration End User License Agreement
                        (&quot;Agreement&quot;) governs your use of the Kloner application in
                        connection with your Vercel account. By connecting Kloner to Vercel,
                        you agree to these terms in addition to the{" "}
                        <a
                            href="/terms"
                            className="font-medium underline"
                            style={{ color: ACCENT }}
                        >
                            Kloner Terms &amp; Conditions
                        </a>{" "}
                        and Vercel&apos;s own terms and policies.
                    </p>
                    <p className="mt-2 text-xs text-neutral-500 max-w-2xl">
                        This page is provided for product usage clarity and does not
                        constitute legal advice. You are responsible for consulting your own
                        legal counsel if needed.
                    </p>
                </section>

                {/* Last updated */}
                <section className="mb-8 text-xs text-neutral-500">
                    <p>Last updated: 15 November 2025</p>
                </section>

                <div className="space-y-8 text-sm leading-relaxed">
                    {/* 1. Scope */}
                    <Section
                        number="1"
                        title="Scope of this Agreement"
                        body={[
                            "This Agreement applies when you authorize Kloner to access or interact with your Vercel account via OAuth or API tokens.",
                            "It governs how Kloner may read from, write to, or otherwise interact with your Vercel projects, deployments, and related resources on your behalf.",
                            "If you do not agree to this Agreement, you must not connect Kloner to Vercel or must immediately disconnect the integration and stop using it.",
                        ]}
                    />

                    {/* 2. Relationship with Vercel */}
                    <Section
                        number="2"
                        title="Relationship with Vercel"
                        body={[
                            "Kloner is an independent product and is not owned, operated, or controlled by Vercel, Inc.",
                            "Vercel is a separate third party. Your use of Vercel is governed solely by your agreements with Vercel, and Kloner does not control or assume responsibility for Vercel’s services, uptime, changes, or policies.",
                            "Nothing in this Agreement creates any partnership, joint venture, or employment relationship between Kloner and Vercel.",
                        ]}
                    />

                    {/* 3. License grant */}
                    <Section
                        number="3"
                        title="License to Use the Integration"
                        body={[
                            "Subject to your continuous compliance with this Agreement and the Kloner Terms & Conditions, Kloner grants you a limited, non-exclusive, non-transferable, revocable license to use the Kloner + Vercel integration solely to deploy and manage projects created or managed through Kloner.",
                            "You may not sublicense, resell, lease, lend, or otherwise commercially exploit the integration separately from Kloner.",
                            "Kloner may modify, suspend, or discontinue any aspect of the integration at any time, without obligation to maintain feature parity or compatibility with past Vercel APIs or behavior.",
                        ]}
                    />

                    {/* 4. Your account responsibility */}
                    <Section
                        number="4"
                        title="Your Vercel Account and Project Responsibility"
                        body={[
                            "You remain solely responsible for your Vercel account, including authentication, billing, usage limits, environment variables, secrets, and all projects and deployments created there.",
                            "You are responsible for any URLs, domains, repositories, configuration, and content you choose to deploy or manage via Vercel using Kloner.",
                            "If you add team members, clients, or collaborators to your Vercel account, you remain responsible for their actions and for ensuring they comply with this Agreement.",
                        ]}
                    />

                    {/* 5. URLs, content, and third-party rights */}
                    <Section
                        number="5"
                        title="URLs, Content, and Third-Party Rights"
                        body={[
                            "You are fully and solely responsible for any URL you paste into Kloner, any content you capture or generate, and anything you choose to deploy to Vercel using that content.",
                            "You must ensure that your use of Kloner and Vercel (including cloning, modifying, and deploying websites) complies with applicable law, the original site’s terms, copyright and trademark laws, and any other third-party rights.",
                            "Kloner does not review, approve, or vet the URLs or content you provide. Kloner has no obligation to monitor your deployments and no responsibility for any legal claims arising from them.",
                        ]}
                    />

                    {/* 6. Credits, billing, and limits */}
                    <Section
                        number="6"
                        title="Credits, Billing, and Usage Limits"
                        body={[
                            "Your use of the Kloner + Vercel integration may consume Kloner preview credits and may also incur charges from Vercel according to your Vercel plan and usage.",
                            "Kloner is not responsible for any charges, overages, or billing disputes with Vercel. Any billing issues related to Vercel must be resolved directly with Vercel.",
                            "Kloner may enforce its own usage limits, credit-based restrictions, or feature gating on the integration (for example, limiting deployment frequency or project count by tier).",
                        ]}
                    />

                    {/* 7. Prohibited use */}
                    <Section
                        number="7"
                        title="Prohibited Use of the Integration"
                        body={[
                            "You may not use the Kloner + Vercel integration to deploy or assist in deploying content that is unlawful, infringing, fraudulent, defamatory, harmful, or otherwise prohibited by applicable law or platform terms.",
                            "You may not use the integration to circumvent Vercel’s own limits, rate limits, or policies, or to interfere with or degrade the performance of Vercel’s services.",
                            "You may not attempt to reverse engineer, exploit, or misuse Kloner’s or Vercel’s APIs, including automated high-volume cloning, scraping, or abusive deployment patterns.",
                        ]}
                    />

                    {/* 8. No warranties */}
                    <Section
                        number="8"
                        title="No Warranties"
                        body={[
                            "The Kloner + Vercel integration is provided on an “as-is” and “as-available” basis, without warranties of any kind, whether express, implied, or statutory.",
                            "Kloner does not warrant that the integration will be uninterrupted, error-free, compatible with all Vercel features, or that it will continue to function if Vercel changes its APIs, pricing, or policies.",
                            "To the maximum extent permitted by law, all implied warranties, including warranties of merchantability, fitness for a particular purpose, and non-infringement, are disclaimed.",
                        ]}
                    />

                    {/* 9. Limitation of liability */}
                    <Section
                        number="9"
                        title="Limitation of Liability"
                        body={[
                            "To the fullest extent permitted by law, Kloner and its owners, employees, contractors, and affiliates are not liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of profits, revenue, data, or goodwill, arising out of or related to your use of the Kloner + Vercel integration.",
                            "Kloner is not responsible for any deployment failures, misconfigurations, downtime, loss of content, domain issues, SSL problems, environment variable mistakes, or any other issues occurring on Vercel or caused by your configuration choices.",
                            "In all cases, Kloner’s total aggregate liability for any claims related to the integration will be limited to the amount you paid to Kloner for access to the integration during the three (3) months immediately preceding the event giving rise to the claim, or, if greater, one hundred U.S. dollars (USD $100).",
                        ]}
                    />

                    {/* 10. Indemnification */}
                    <Section
                        number="10"
                        title="Indemnification"
                        body={[
                            "You agree to defend, indemnify, and hold harmless Kloner and its owners, employees, contractors, and affiliates from and against any and all claims, damages, liabilities, costs, and expenses (including reasonable attorneys’ fees) arising out of or related to:",
                            "• your use of the Kloner + Vercel integration;",
                            "• your URLs, content, deployments, domains, or configurations;",
                            "• any breach of this Agreement or the Kloner Terms & Conditions; or",
                            "• any violation of applicable law or third-party rights by you or by anyone accessing Vercel through your account or credentials.",
                        ]}
                    />

                    {/* 11. Data and privacy */}
                    <Section
                        number="11"
                        title="Data, Tokens, and Privacy"
                        body={[
                            "When you connect Kloner to Vercel, you authorize Kloner to access limited Vercel data and resources necessary to provide the integration, such as project lists, deployments, and configuration relevant to the features you use.",
                            "Kloner uses this access solely to perform actions you initiate or configure (for example, creating a deployment or linking a project).",
                            "Handling of account data and tokens is governed by the Kloner Privacy Policy. You are responsible for revoking the integration from your Vercel account if you no longer wish Kloner to have access.",
                        ]}
                    />

                    {/* 12. Suspension and termination */}
                    <Section
                        number="12"
                        title="Suspension and Termination"
                        body={[
                            "Kloner may suspend or terminate your access to the Kloner + Vercel integration at any time if you violate this Agreement, the Kloner Terms & Conditions, or if your usage is abusive, risky, or otherwise harmful.",
                            "You may disconnect the integration at any time from within Kloner or from your Vercel account settings, but any obligations accrued prior to disconnection (for example, payment obligations) will remain in effect.",
                            "Termination or suspension of the integration does not automatically delete any deployments, projects, or data stored in your Vercel account. You are responsible for managing and removing those resources directly in Vercel.",
                        ]}
                    />

                    {/* 13. Changes to this EULA */}
                    <Section
                        number="13"
                        title="Changes to this Agreement"
                        body={[
                            "Kloner may update or modify this Agreement from time to time, for example to reflect product changes, integration changes, legal requirements, or risk management needs.",
                            "When changes are material, Kloner will update the “Last updated” date above and may notify you through the app or by other reasonable means.",
                            "By continuing to use the Kloner + Vercel integration after changes become effective, you agree to the updated Agreement.",
                        ]}
                    />

                    {/* 14. Contact */}
                    <Section
                        number="14"
                        title="Contact"
                        body={[
                            "If you have questions about this Agreement or about how the Kloner + Vercel integration operates, contact support using the in-app channels or by email at:",
                            "support@kloner.app (or the current support address shown in the app).",
                        ]}
                    />
                </div>
            </main>
        </div>
    );
}

/* ---------- helpers ---------- */

function Section({
    number,
    title,
    body,
}: {
    number: string;
    title: string;
    body: string[];
}) {
    return (
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6 shadow-sm">
            <h2 className="text-sm sm:text-base font-semibold text-neutral-900 mb-2 flex items-baseline gap-2">
                <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-neutral-800"
                    style={{ backgroundColor: "rgba(0,0,0,0.04)" }}
                >
                    {number}
                </span>
                <span>{title}</span>
            </h2>
            <div className="space-y-1.5 text-xs sm:text-sm text-neutral-700">
                {body.map((line) => (
                    <p key={line}>{line}</p>
                ))}
            </div>
        </section>
    );
}
