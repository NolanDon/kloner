'use client';

import dynamic from 'next/dynamic';
import NavBar from '@/components/NavBar';
import Hero from '@/components/Hero';
import PreviewDashboard from '@/components/StartsWithLabs';
import WebsiteClonerFaq from '@/components/WebsiteClonerFaq';
const HowItWorks = dynamic(() => import('@/components/HowItWorks'));
const Stories = dynamic(() => import('@/components/Stories'));
const WhatsIncluded = dynamic(() => import('@/components/WhatsIncluded'));
const ParallaxTypeHero = dynamic(() => import('@/components/ParallaxTypeHero'));
const Footer = dynamic(() => import('@/components/Footer'));

export default function WebsiteClonerClient() {
  return <><NavBar /><main className="h-screen snap-y snap-mandatory scroll-smooth motion-reduce:snap-none motion-reduce:scroll-auto">
    <section id="hero" className="snap-start snap-always min-h-screen flex flex-col"><Hero heading="AI Website Cloner" subhead="Paste a URL to clone a website, preview the editable result, customize it with AI, and deploy." /></section>
    <section id="preview" className="snap-start snap-always min-h-screen flex flex-col"><PreviewDashboard /></section>
    <section id="how-to-clone-a-website" className="snap-none"><HowItWorks /></section>
    <section id="social-proof" className="snap-start snap-always"><Stories /></section>
    <section id="what-your-website-clone-includes" className="snap-start snap-always"><WhatsIncluded heading="What you get with a website clone" /></section>
    <WebsiteClonerFaq />
    <section id="start-cloning" className="mt-24 md:mt-32 snap-start snap-always min-h-screen flex flex-col"><ParallaxTypeHero headline="Clone a website from a URL." subcopy="Start a free preview" showUrlInput /></section>
    <Footer showSeoLinks={false} />
  </main></>;
}
