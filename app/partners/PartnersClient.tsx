"use client";

import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";

const ACCENT = "#FF8D21";

export default function PartnersClient(): JSX.Element {
  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <NavBar />

      <section className="pt-[calc(var(--header-h,56px)+40px)] pb-16 px-6">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight">
            Partnerships
          </h1>
          <p className="mt-3 text-sm md:text-base text-neutral-600 max-w-prose">
            Ways to work with Kloner without touching internal systems. You keep ownership and
            responsibility for URLs, exports, domains, and campaigns.
          </p>

          <section id="creators" className="mt-10 space-y-3">
            <h2 className="text-xl md:text-2xl font-semibold">For creators</h2>
            <p className="text-sm md:text-base text-neutral-600">
              Spin up landing pages for products, launches, and sponsorships. You keep full
              control of your domains, mailing lists, and analytics.
            </p>
          </section>

          <section id="affiliates" className="mt-10 space-y-3">
            <h2 className="text-xl md:text-2xl font-semibold">Affiliates</h2>
            <p className="text-sm md:text-base text-neutral-600">
              Earn recurring commission when teams you refer upgrade to paid plans. We provide
              tracking links and simple copy.
            </p>
          </section>

          <section id="business" className="mt-10 space-y-3">
            <h2 className="text-xl md:text-2xl font-semibold">For agencies and businesses</h2>
            <p className="text-sm md:text-base text-neutral-600">
              Standardize on Kloner for capture and preview, then move exported code into your
              own repos and CI.
            </p>
            <a
              href="/contact"
              className="inline-flex mt-2 text-sm font-medium"
              style={{ color: ACCENT }}
            >
              Talk to us about custom usage
            </a>
          </section>
        </div>
      </section>

      <Footer />
    </main>
  );
}
