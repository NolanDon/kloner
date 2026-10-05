// app/HomeClient.tsx (CLIENT)
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import Hero from "@/components/Hero";
const StatsStrip = dynamic(() => import("@/components/StatsStrip"));
const HowItWorks = dynamic(() => import("@/components/HowItWorks"));
const Stories = dynamic(() => import("@/components/Stories"));
const WhatsIncluded = dynamic(() => import("@/components/WhatsIncluded"));
const Footer = dynamic(() => import("@/components/Footer"));
const FAQSection = dynamic(() => import("@/components/FaqSection"));
const ParallaxTypeHero = dynamic(() => import("@/components/ParallaxTypeHero"));
const PreviewDashboard = dynamic(() => import("@/components/StartsWithLabs"));
const KlonerExamples = dynamic(() => import("@/components/KlonerExamples"));

export default function HomeClient() {
    return (
        <>
            <NavBar />

            <main className="h-screen snap-y snap-mandatory scroll-smooth motion-reduce:snap-none motion-reduce:scroll-auto">
                <section id="hero" className="snap-start snap-always min-h-screen flex flex-col">
                    <Hero heading="AI Website Cloner — Clone a Website from a URL" subhead="Paste a public website URL to recreate its layout, preview the result, and customize text, images, and sections with AI. Deploy your finished website when it’s ready." />
                </section>

                <section id="preview" className="snap-start snap-always min-h-screen flex flex-col">
                    <PreviewDashboard />
                </section>

                <section id="stats" className="snap-start snap-always flex flex-col">
                    <StatsStrip />
                </section>

                <section id="how-it-works" className="snap-none">
                    <HowItWorks />
                </section>

                <section id="stories" className="snap-start snap-always">
                    <Stories />
                </section>

                <section id="examples" className="snap-start snap-always">
                    <KlonerExamples />
                </section>

                <section id="whats-included" className="snap-start snap-always min-h-screen flex flex-col">
                    <WhatsIncluded />
                </section>

                <section id="faq" className="snap-start snap-always min-h-screen flex flex-col">
                    <FAQSection />
                </section>

                <section id="parallax" className="snap-start snap-always min-h-screen flex flex-col">
                    <ParallaxTypeHero />
                </section>

                <section aria-label="Website cloning guides" className="snap-start bg-white px-6 py-8">
                    <p className="mx-auto max-w-3xl text-center text-neutral-600">
                        Need a walkthrough? <Link href="/blog/clone-website-from-url" className="underline underline-offset-4">Learn how to clone a website from a URL</Link> or review <Link href="/blog/clone-website-free" className="underline underline-offset-4">free preview access and plan limits</Link>.
                    </p>
                </section>

                <section id="footer" className="snap-start snap-always flex flex-col">
                    <Footer showSeoLinks={false} />
                </section>
            </main>
        </>
    );
}
