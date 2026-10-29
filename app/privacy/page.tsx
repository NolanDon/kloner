import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";

const ACCENT = "#FF8D21";

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
                            Last updated: 29 October 2026
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
                            <p className="mt-2">
                                We also receive information from sign-in providers, payment processors, and services you choose to
                                connect, such as deployment, database, or code-hosting integrations. The information depends on the
                                permissions and features you enable. We may receive payment status and transaction identifiers, but
                                payment card details are handled by the payment processor.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">3. Cookies and Similar Technologies</h2>
                            <p className="mt-2">
                                We use strictly necessary cookies and similar storage for authentication, security, previews, routing,
                                and other core app functions you request. These are always on.
                            </p>
                            <p className="mt-2">
                                Analytics cookies, affiliate cookies, and related tracking storage stay off until you accept them in the
                                cookie banner. If you reject, some features will be limited.
                            </p>
                            <p className="mt-2">
                                You can change your choice any time from the Cookie settings link in the footer.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">4. How We Use Information</h2>
                            <ul className="mt-2 list-disc pl-5 space-y-1.5">
                                <li>Authenticate users and secure sessions.</li>
                                <li>Provide website capture, editing, preview, deployment, and billing features.</li>
                                <li>Store and restore projects, screenshots, and uploads.</li>
                                <li>Send transactional and support emails.</li>
                                <li>Detect abuse, troubleshoot errors, and secure the service.</li>
                                <li>Measure product performance when analytics is enabled.</li>
                                <li>Process payments, administer plans, and provide account-related notices.</li>
                                <li>Enforce our terms, investigate complaints, prevent fraud, and meet legal obligations.</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">5. Sharing and Processors</h2>
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
                            <p className="mt-2">
                                When you use AI-assisted features, prompts, relevant project files, source URLs, and other information
                                needed for the requested task may be sent to AI and infrastructure providers. Connected services receive
                                information needed to perform the action you request. Those providers process information under their own
                                terms and privacy notices, and their handling may differ from ours. We do not use your project content to
                                train our own AI models unless we clearly tell you and provide any choices required by law.
                            </p>
                            <p className="mt-2">
                                We may also disclose information to professional advisers, authorities, or a successor organization in a
                                merger, financing, restructuring, or sale of assets, subject to appropriate safeguards and applicable law.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">6. Projects and Data You Process</h2>
                            <p className="mt-2">
                                Your project content may include submitted URLs, captured page content and screenshots, prompts, generated
                                code, edits, files, and deployment settings. We use this content to provide the features you request,
                                maintain the service, protect it against abuse, and provide support. Access may be available to authorized
                                personnel when needed for support, security, or service operation.
                            </p>
                            <p className="mt-2">
                                If you use Kloner to create or deploy a website or application for other people, you decide what personal
                                data that project collects and how it uses it. You are responsible for giving those people any required
                                privacy notices, obtaining any required permissions, and responding to their privacy requests. This policy
                                describes Kloner’s processing of your account and service data; it does not replace the privacy notice for
                                a site or app you publish.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">7. International Processing</h2>
                            <p className="mt-2">
                                Kloner and its service providers may process information in countries other than the one where you live,
                                including Canada and the United States. Privacy laws and government access rules can differ between
                                countries. Where applicable law restricts an international transfer, we use a recognized transfer
                                mechanism or other safeguard required by that law. You can contact us to ask about safeguards relevant to
                                your information.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">8. Storage and Retention</h2>
                            <p className="mt-2">
                                We retain account and project data while your account is active and as needed to provide the service. If
                                you close your account or make a verified deletion request, we delete or de-identify the information unless
                                we need to retain it for legal, tax, security, dispute-resolution, or enforcement purposes. Operational
                                logs and backups may remain for a limited period as they rotate through normal retention cycles. Billing
                                and consent records may be kept for periods required by law or needed to document our obligations.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">9. Your Choices and Privacy Rights</h2>
                            <p className="mt-2">
                                You can unsubscribe from marketing-style emails using the unsubscribe links in those messages or by
                                adjusting notification settings in your account. You may also contact support to request account closure,
                                data deletion, or access to your data.
                            </p>
                            <p className="mt-2">
                                Depending on where you live, you may have the right to request access to, correction of, deletion of, or a
                                portable copy of your personal information; to object to or restrict certain processing; and to withdraw
                                consent where processing relies on consent. You may also have the right to complain to your local privacy
                                regulator. We may need to verify your identity before completing a request and will respond within the time
                                required by applicable law. We will not unlawfully discriminate against you for exercising a privacy right.
                            </p>
                            <p className="mt-2">
                                These rights may arise under laws such as the GDPR and UK GDPR, Canada’s PIPEDA and provincial privacy
                                laws, Brazil’s LGPD, and U.S. state privacy laws. The specific rights and exceptions vary by location. If
                                you are in the EEA, UK, or Switzerland, you may also complain to your relevant data protection authority;
                                Canadian users may contact the Office of the Privacy Commissioner of Canada or their provincial
                                commissioner, and Brazilian users may contact the ANPD.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">10. Legal Bases Where Required</h2>
                            <p className="mt-2">
                                Where privacy law requires a legal basis, we process information as needed to provide the service and
                                perform our agreement with you; to comply with legal obligations; based on legitimate interests such as
                                securing and improving Kloner, preventing abuse, and handling claims, where those interests are not
                                overridden by your rights; or with your consent, which you can withdraw for future processing. The basis
                                depends on the information and purpose.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">11. Children</h2>
                            <p className="mt-2">
                                Kloner is not designed for children who are below the minimum age permitted to use online services in their
                                location. If you believe a child has provided us personal information, contact us and we will take
                                appropriate steps to review and address it, including deletion where required.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">12. Changes to This Policy</h2>
                            <p className="mt-2">
                                We may update this policy as our service or legal requirements change. We will post the revised policy here
                                and update the date above. If a change materially affects how we use personal information, we will provide
                                notice by email, in the service, or by another reasonable means, and obtain consent where required by law.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">13. Security</h2>
                            <p className="mt-2">
                                We use session cookies, CSRF protection, access controls, and operational monitoring to protect the
                                service. No internet-connected service can guarantee complete security, and we continuously work to reduce
                                risk.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">14. Contact</h2>
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
