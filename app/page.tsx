import NavBar from "@/components/NavBar";
import Hero from "@/components/Hero";
import StatsStrip from "@/components/StatsStrip";
import HowItWorks from "@/components/HowItWorks";
import Stories from "@/components/Stories";
import WhatsIncluded from "@/components/WhatsIncluded";
import WhatWeTest from "@/components/WhatWeTest";
import Footer from "@/components/Footer";
import FAQSection from "@/components/FaqSection";
import ParallaxTypeHero from "@/components/ParallaxTypeHero";
import MembershipHero from "@/components/MembershipHero";
import PreviewDashboard from "@/components/StartsWithLabs";

export default function Page() {
  return (
    <>
      {/* Nav stays normal; sections below are snap targets */}
      <NavBar />

      {/* Scroll container with snap + smooth scroll */}
      <main className="h-screen snap-y snap-mandatory scroll-smooth">
      {/* <main> */}
        <section
          id="hero"
          className="snap-start snap-always min-h-screen flex flex-col"
        >
          <Hero />
        </section>

        <section
          id="preview"
          className="snap-start snap-always min-h-screen flex flex-col"
        >
          <PreviewDashboard />
        </section>

        <section
          id="stats"
          className="snap-start snap-always min-h-screen flex flex-col"
        >
          <StatsStrip />
        </section>
        <section
          id="how-it-works"
          className="snap-none"
        >
          <HowItWorks />
        </section>

        <section
          id="stories"
          className="snap-start snap-always min-h-screen flex flex-col"
        >
          <Stories />
        </section>

        <section
          id="whats-included"
          className="snap-start snap-always min-h-screen flex flex-col"
        >
          <WhatsIncluded />
        </section>

        <section
          id="membership"
          className="snap-start snap-always min-h-screen flex flex-col"
        >
          <MembershipHero />
        </section>

        <section
          id="faq"
          className="snap-start snap-always min-h-screen flex flex-col"
        >
          <FAQSection />
        </section>

        <section
          id="what-we-test"
          className="snap-start snap-always min-h-screen flex flex-col"
        >
          <WhatWeTest />
        </section>

        <section
          id="parallax"
          className="snap-start snap-always min-h-screen flex flex-col"
        >
          <ParallaxTypeHero />
        </section>

        <section
          id="footer"
          className="snap-start snap-always min-h-screen flex flex-col"
        >
          <Footer />
        </section>
      </main>
    </>
  );
}
