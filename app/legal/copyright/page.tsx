import type { Metadata } from "next";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Copyright and Abuse Policy",
  description: "How to report copyright infringement, privacy concerns, abuse, or illegal content involving Kloner.",
  alternates: { canonical: "https://kloner.app/legal/copyright" },
};

export default function CopyrightPolicyPage(): JSX.Element {
  return (
    <main className="min-h-screen bg-white py-[80px] text-neutral-900">
      <NavBar />
      <div className="px-4 pb-16 pt-28">
        <article className="mx-auto max-w-3xl space-y-8 text-sm leading-relaxed text-neutral-800">
          <header>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#FF8D21]">Legal</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Copyright and Abuse Policy</h1>
            <p className="mt-3 text-neutral-600">Last updated: 11 November 2026</p>
          </header>

          <section>
            <h2 className="text-lg font-semibold text-neutral-950">Report an issue</h2>
            <p className="mt-2">
              Rights holders, users, and other affected people can submit copyright, privacy, abuse, or illegal-content reports through the{" "}
              <Link className="font-medium underline underline-offset-2" href="/contact">Kloner contact form</Link>. Choose the closest report type and include the information requested below. Kloner may ask for more information before acting.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-950">Copyright notices</h2>
            <p className="mt-2">To help us review a copyright claim, include:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Your name, mailing address, telephone number, and email address.</li>
              <li>Identification of the copyrighted work you say is infringed.</li>
              <li>The Kloner project, page, or material at issue and enough information for us to locate it, such as its URL or project ID.</li>
              <li>A statement that you have a good-faith belief the use is not authorized by the rights holder, its agent, or law.</li>
              <li>A statement that the information is accurate and, under penalty of perjury, that you are the rights holder or authorized to act for them.</li>
              <li>Your physical or electronic signature.</li>
            </ul>
            <p className="mt-2">
              We review complete notices, may disable access to reported material, and may notify the affected user with the notice or a summary. We may request clarification or reject notices that are incomplete, abusive, or clearly invalid. Knowingly false claims may have legal consequences.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-950">Responses and counter-notices</h2>
            <p className="mt-2">
              If your material is disabled, you may reply through the contact form with the project or notice details and explain why you believe the material was removed by mistake or misidentification. If you submit a formal counter-notice, include your signature, identify the removed material and its former location, provide your name, mailing address, telephone number, and email address, and include the statements and jurisdiction consent required by applicable law. We may forward a counter-notice to the reporting party and restore material only when permitted and appropriate.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-950">Repeat-infringer policy</h2>
            <p className="mt-2">
              Kloner records substantiated copyright notices and other reliable evidence of infringement associated with an account. We consider the number, seriousness, and circumstances of incidents, including credible counter-notices or corrections. In appropriate circumstances, we may warn, restrict, suspend, or terminate an account and may block a source domain. Serious violations may result in immediate action. We may correct records when a notice is withdrawn, shown to be mistaken, or resolved.
            </p>
          </section>

          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-neutral-800">
            <h2 className="font-semibold text-neutral-950">Important</h2>
            <p className="mt-2">
              This page describes Kloner’s reporting and review process. It does not state that Kloner has registered a designated agent with the U.S. Copyright Office or that a particular statutory safe harbor applies. Those questions require review of Kloner’s service and legal setup.
            </p>
          </section>

          <p className="text-xs text-neutral-500">This policy is an operational description, not legal advice.</p>
        </article>
      </div>
      <Footer />
    </main>
  );
}
