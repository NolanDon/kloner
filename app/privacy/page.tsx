import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";

const ACCENT = "#f55f2a";

export const metadata: Metadata = {
    title: "Privacy Policy",
    description:
        "Kloner privacy policy: what we collect, how we use it, who we share it with, and how to exercise your rights.",
    alternates: { canonical: "https://kloner.app/privacy" },
    openGraph: { url: "https://kloner.app/privacy" },
};

export default function PrivacyPage(): JSX.Element {
    return (
        <main className="min-h-screen bg-white py-[80px] text-neutral-900">
            <NavBar />
            <div className="pt-28 pb-16 px-4">
                <div className="mx-auto max-w-3xl">
                    <div className="mb-8">
                        <span
                            className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide"
                            style={{ backgroundColor: "#fef3e7", color: ACCENT }}
                        >
                            Legal
                        </span>
                        <h1 className="mt-4 text-3xl sm:text-4xl font-semibold tracking-tight">
                            Privacy Policy
                        </h1>
                        <p className="mt-2 text-sm text-neutral-600">
                            Last updated: 20 May 2026
                        </p>
                    </div>

                    <div className="space-y-8 text-sm leading-relaxed text-neutral-800">
                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">1. Scope</h2>
                            <p className="mt-2">
                                This policy explains how Kloner collects, uses, stores, and shares personal information when you create
                                an account, submit URLs for capture or generation, edit projects, deploy projects, or contact support.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">2. Information We Collect</h2>
                            <p className="mt-2">
                                Depending on how you use Kloner, we may collect identifiers such as your name, email address, account ID,
                                authentication/session data, billing and subscription identifiers, submitted URLs, project files,
                                screenshots, uploaded assets, support messages, and technical data such as IP address, user agent,
                                referer, timestamps, and request identifiers.
                            </p>
                            <p className="mt-2">
                                If analytics are enabled, we may also collect usage and interaction data from Mixpanel and Google
                                Analytics, including page views and click events.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">3. How We Use Information</h2>
                            <ul className="mt-2 list-disc pl-5 space-y-1.5">
                                <li>Authenticate users and secure sessions.</li>
                                <li>Provide website capture, editing, preview, deployment, and billing features.</li>
                                <li>Store and restore projects, screenshots, and uploads.</li>
                                <li>Send transactional and support emails.</li>
                                <li>Detect abuse, troubleshoot errors, and secure the service.</li>
                                <li>Measure product performance when analytics is enabled.</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">4. Sharing and Processors</h2>
                            <p className="mt-2">
                                We use third-party processors to operate the service, including Firebase, Vercel, Stripe, Resend,
                                Mixpanel, Google Analytics, Supabase, Google AI services, and the backend generation service used for
                                crawls and previews. Those providers may process data outside your jurisdiction depending on their
                                infrastructure and settings.
                            </p>
                            <p className="mt-2">
                                We do not sell personal information. We may disclose information where required by law, to protect the
                                service, or to enforce our terms.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">5. Storage and Retention</h2>
                            <p className="mt-2">
                                We retain account, project, and operational data for as long as needed to provide the service, comply with
                                legal obligations, resolve disputes, and enforce agreements. Some analytics, logs, and backups may be
                                retained for a limited operational period even after active deletion requests are processed.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">6. Your Choices and Rights</h2>
                            <p className="mt-2">
                                You can unsubscribe from marketing-style emails using the unsubscribe links in those messages or by
                                adjusting notification settings in your account. You may also contact support to request account closure,
                                data deletion, or access to your data.
                            </p>
                            <p className="mt-2">
                                Where required by law, you may have rights to access, correct, delete, or restrict the processing of your
                                personal information.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">7. Security</h2>
                            <p className="mt-2">
                                We use session cookies, CSRF protection, access controls, and operational monitoring to protect the
                                service. No internet-connected service can guarantee complete security, and we continuously work to reduce
                                risk.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">8. Contact</h2>
                            <p className="mt-2">
                                Questions or requests can be sent through the{" "}
                                <a href="/contact" className="font-medium underline underline-offset-2" style={{ color: ACCENT }}>
                                    contact page
                                </a>
                                .
                            </p>
                        </section>
                    </div>
                </div>
            </div>

            <Footer />
        </main>
    );
}