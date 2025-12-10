import NavBar from "@/components/NavBar";

const ACCENT = "#f55f2a";

export default function TermsPage(): JSX.Element {
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
                            Terms and Conditions
                        </h1>
                        <p className="mt-2 text-sm text-neutral-600">
                            Last updated: 14 November 2025
                        </p>
                    </div>

                    <div className="space-y-8 text-sm leading-relaxed text-neutral-800">
                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                1. Acceptance of these Terms
                            </h2>
                            <p className="mt-2">
                                By creating an account, accessing, or using Kloner in any way,
                                you confirm that you have read, understood, and agree to be
                                bound by these Terms and Conditions and by any policies
                                referenced here, including our Privacy Policy.
                            </p>
                            <p className="mt-2">
                                If you do not agree with these Terms, you must not create an
                                account and must not use the service.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                2. Service Description
                            </h2>
                            <p className="mt-2">
                                Kloner provides tools to capture, preview, and customize web
                                pages based on URLs that you provide. The service is a
                                technical tool only. It does not grant you any rights to
                                third-party content, nor does it provide legal advice or legal
                                clearance for any use of that content.
                            </p>
                            <p className="mt-2">
                                Kloner does not monitor or pre-approve the URLs, sites, or
                                content you use with the service, and we do not review or
                                approve any cloned or generated projects you create. You are
                                solely responsible for how you use any previews, screenshots,
                                generated content, or exported projects produced by Kloner.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                3. Eligibility
                            </h2>
                            <p className="mt-2">
                                You may only use Kloner if you are legally able to enter into a
                                binding agreement under the laws of your jurisdiction. By
                                creating an account, you represent and warrant that you meet
                                this requirement.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                4. Your Account
                            </h2>
                            <p className="mt-2">
                                You are responsible for maintaining the confidentiality of your
                                login credentials and for all activity that occurs under your
                                account. You must notify us promptly if you suspect any
                                unauthorized access to your account.
                            </p>
                            <p className="mt-2">
                                We may suspend or terminate your account at any time if we
                                reasonably believe that you have violated these Terms, are
                                using the service in an unlawful or abusive way, or are
                                creating risk or possible legal exposure for Kloner or others.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                5. URLs, Source Sites, and Content Ownership
                            </h2>
                            <p className="mt-2">
                                You are fully and solely responsible for every URL, domain, or
                                resource you submit to Kloner and for the way you use any
                                resulting previews, screenshots, or generated projects.
                            </p>
                            <ul className="mt-2 list-disc pl-5 space-y-1.5">
                                <li>
                                    You acknowledge that all third-party websites, trademarks,
                                    logos, designs, text, images, code, and other materials
                                    remain the property of their respective owners.
                                </li>
                                <li>
                                    You understand that Kloner does not grant you any license to
                                    use third-party content and does not verify that your use of
                                    any content is lawful.
                                </li>
                                <li>
                                    Any legal risk related to the URLs you provide, the content
                                    they contain, or how you use the output from Kloner rests
                                    entirely with you.
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                5A. Your Representations About URLs and Rights
                            </h2>
                            <p className="mt-2">
                                By submitting any URL, domain, or source site to Kloner, you
                                represent and warrant that:
                            </p>
                            <ul className="mt-2 list-disc pl-5 space-y-1.5">
                                <li>
                                    You own the website or have all rights, licenses,
                                    permissions, and authorizations necessary to access, copy,
                                    adapt, or otherwise use that site and its content with
                                    Kloner.
                                </li>
                                <li>
                                    Your use of Kloner with that site will not violate any
                                    applicable law, court order, contract, or third-party terms
                                    of use (including the site&apos;s own terms, policies, and
                                    robots or crawl rules).
                                </li>
                                <li>
                                    You will not use Kloner to copy, clone, reproduce, or
                                    derive from any site in a way that infringes any copyright,
                                    trademark, trade dress, trade secret, or other intellectual
                                    property or proprietary right.
                                </li>
                                <li>
                                    You will not submit URLs or content that you know, or
                                    reasonably should know, you are not permitted to copy,
                                    adapt, or reuse.
                                </li>
                            </ul>
                            <p className="mt-2">
                                These representations and warranties are ongoing. If at any
                                time you no longer have the necessary rights to use a site with
                                Kloner, you must stop using the service with that site and
                                delete any affected projects.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                6. Prohibited Use
                            </h2>
                            <p className="mt-2">
                                You must not use Kloner for any illegal, harmful, or abusive
                                purpose. This includes, without limitation:
                            </p>
                            <ul className="mt-2 list-disc pl-5 space-y-1.5">
                                <li>
                                    Violating any copyright, trademark, trade secret, or other
                                    intellectual property rights.
                                </li>
                                <li>
                                    Violating privacy, publicity, or other personal rights of
                                    third parties.
                                </li>
                                <li>
                                    Scraping, copying, or cloning websites where you do not have
                                    permission to do so under applicable law or the relevant
                                    site terms.
                                </li>
                                <li>
                                    Attempting to bypass technical protections, rate limits, or
                                    security measures on Kloner or on any third-party site.
                                </li>
                                <li>
                                    Uploading or transmitting malicious code, attempting to gain
                                    unauthorized access to any system, or interfering with the
                                    normal operation of Kloner.
                                </li>
                            </ul>
                            <p className="mt-2">
                                We may monitor use of the service for abuse, but we are not
                                obligated to do so. We may remove or disable access to any
                                content or project, and may suspend or terminate accounts, if
                                we reasonably believe there is a violation of these Terms or
                                that your use creates a legal or security risk.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                7. No Legal Advice
                            </h2>
                            <p className="mt-2">
                                Kloner is not a law firm and does not provide legal advice. Any
                                explanations, examples, documentation, or help content that you
                                see in the product or on related sites are for general
                                information only and are not tailored to your situation.
                            </p>
                            <p className="mt-2">
                                You are solely responsible for obtaining your own legal advice
                                regarding whether your use of any cloned or generated site is
                                lawful in your jurisdiction and under any relevant third-party
                                terms or policies.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                8. Plans, Credits, and Limits
                            </h2>
                            <p className="mt-2">
                                Kloner may offer free and paid plans with different limits on
                                usage, such as the number of previews, screenshots, or projects
                                you can create. Any such limits are described in your account
                                or on the pricing page and may change from time to time.
                            </p>
                            <p className="mt-2">
                                We may enforce usage limits or restrict features for
                                operational or security reasons, or if we suspect abuse or
                                misuse of the service.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                9. Third-Party Services
                            </h2>
                            <p className="mt-2">
                                Kloner may integrate with or rely on third-party services such
                                as hosting providers, deployment platforms, analytics tools, and
                                payment processors. Your use of any third-party service is
                                subject to that third party&apos;s own terms and policies.
                            </p>
                            <p className="mt-2">
                                Kloner is not responsible for the acts, omissions, or policies
                                of any third-party service and has no control over their
                                availability, security, or performance.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                10. Data and Privacy
                            </h2>
                            <p className="mt-2">
                                Our handling of personal data is described in our Privacy
                                Policy. By using the service you consent to the collection and
                                use of information as described there.
                            </p>
                            <p className="mt-2">
                                You are responsible for any personal data you upload or process
                                through Kloner and for complying with all applicable data
                                protection and privacy laws that apply to your use of the
                                service.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                11. Disclaimers
                            </h2>
                            <p className="mt-2">
                                Kloner and all related services are provided on an “as is” and
                                “as available” basis, without any warranty of any kind, whether
                                express, implied, or statutory. Without limiting the above, we
                                do not warrant that the service will be uninterrupted, secure,
                                or error-free, or that any output will be accurate, complete, or
                                legally permitted for your intended use.
                            </p>
                            <p className="mt-2">
                                To the maximum extent permitted by law, we disclaim all implied
                                warranties, including any implied warranties of
                                merchantability, fitness for a particular purpose, and
                                non-infringement.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                12. Limitation of Liability
                            </h2>
                            <p className="mt-2">
                                To the maximum extent permitted by law, Kloner, its owner, and
                                its affiliates will not be liable for any indirect, incidental,
                                special, consequential, or punitive damages, or for any loss of
                                profits, revenue, data, or business opportunities, arising out
                                of or related to your use of or inability to use the service,
                                even if we have been advised of the possibility of such
                                damages.
                            </p>
                            <p className="mt-2">
                                To the maximum extent permitted by law, our total cumulative
                                liability for any claim arising out of or relating to the
                                service will not exceed the greater of (a) the total amount you
                                paid for the service in the twelve months before the event
                                giving rise to the liability, or (b) one hundred United States
                                dollars (USD 100).
                            </p>
                            <p className="mt-2">
                                Some jurisdictions do not allow certain limitations of
                                liability. In those cases, these limitations apply only to the
                                extent permitted by the law of that jurisdiction.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                13. Indemnification
                            </h2>
                            <p className="mt-2">
                                You agree to indemnify, defend, and hold harmless Kloner, its
                                owner, and its affiliates from and against any claims, demands,
                                losses, damages, liabilities, costs, and expenses, including
                                reasonable legal fees, arising out of or related to:
                            </p>
                            <ul className="mt-2 list-disc pl-5 space-y-1.5">
                                <li>
                                    Your use of the service, including any URLs, sites, or
                                    content you submit.
                                </li>
                                <li>
                                    Any cloned or generated site, export, or project that you
                                    deploy, host, publish, or share, whether through our
                                    infrastructure or elsewhere.
                                </li>
                                <li>
                                    Your violation of these Terms, of any applicable law, or of
                                    any third-party right (including intellectual property,
                                    privacy, or contract rights).
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                14. Changes to the Service and to these Terms
                            </h2>
                            <p className="mt-2">
                                We may modify, suspend, or discontinue any part of the service
                                at any time. We may also update these Terms from time to time.
                                When we do, we will post the updated version on this page and
                                update the “Last updated” date.
                            </p>
                            <p className="mt-2">
                                If you continue using the service after changes are posted, you
                                are accepting the updated Terms.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                15. Governing Law and Jurisdiction
                            </h2>
                            <p className="mt-2">
                                These Terms are governed by the laws of [INSERT JURISDICTION],
                                without regard to conflict of law principles. Any dispute
                                arising out of or relating to these Terms or the service will
                                be subject to the exclusive jurisdiction of the courts located
                                in [INSERT CITY / REGION], and you and we consent to personal
                                jurisdiction and venue in those courts.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                16. Complaints, Takedowns, and Repeat Infringers
                            </h2>
                            <p className="mt-2">
                                If we receive a complaint or notice that content created,
                                hosted, or deployed through Kloner infringes rights or violates
                                law, we may in our sole discretion remove, disable, or limit
                                access to that content, suspend or terminate the associated
                                account, and/or block the relevant URL or domain from further
                                use with Kloner.
                            </p>
                            <p className="mt-2">
                                We may take these actions without prior notice if we believe it
                                is reasonably necessary to protect third-party rights, comply
                                with law, or protect Kloner from legal or regulatory risk. We
                                may also terminate accounts that are subject to repeated or
                                serious complaints.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                17. Miscellaneous
                            </h2>
                            <p className="mt-2">
                                These Terms, together with any policies or documents that are
                                expressly incorporated by reference, constitute the entire
                                agreement between you and us regarding the service and
                                supersede any prior or contemporaneous agreements on that
                                subject.
                            </p>
                            <p className="mt-2">
                                If any provision of these Terms is found to be invalid or
                                unenforceable, that provision will be enforced to the maximum
                                extent permitted and the remaining provisions will remain in
                                full force and effect.
                            </p>
                            <p className="mt-2">
                                Our failure to enforce any right or provision of these Terms
                                will not be considered a waiver of that right or provision. You
                                may not assign or transfer these Terms or your rights or
                                obligations under them without our prior written consent. We
                                may assign these Terms without restriction, including in
                                connection with a merger, acquisition, or sale of assets.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-base font-semibold text-neutral-900">
                                18. Contact
                            </h2>
                            <p className="mt-2">
                                If you have questions about these Terms, you can contact the
                                service owner using the contact details provided on the
                                website.
                            </p>
                        </section>
                    </div>
                </div>
            </div>
        </main>
    );
}
