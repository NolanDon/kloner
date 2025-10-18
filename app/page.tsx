
import NavBar from "@/components/NavBar";
import Hero from "@/components/Hero";
import StatsStrip from "@/components/StatsStrip";
import HowItWorks from "@/components/HowItWorks";
import Stories from "@/components/Stories";
import WhatsIncluded from "@/components/WhatsIncluded";
import WhatWeTest from "@/components/WhatWeTest";
import Footer from "@/components/Footer";
import StartsWithLabs from "@/components/StartsWithLabs";
import FAQSection from "@/components/FaqSection";
import ParallaxTypeHero from "@/components/ParallaxTypeHero";
import MembershipHero from "@/components/MembershipHero";

export default function Page() {
  return (
    <main>
      <NavBar />
      <Hero />
      <StartsWithLabs />
      <StatsStrip />
      <HowItWorks />
      <Stories />
      <WhatsIncluded />
      <MembershipHero />
      <FAQSection />
      <WhatWeTest />
      <ParallaxTypeHero />
      <Footer />
    </main>
  );
}
