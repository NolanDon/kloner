// components/MembershipSticky.tsx
'use client';

import { motion, useInView } from 'framer-motion';
import Image from 'next/image';
import React, { useRef } from 'react';

type Card = {
  title: string;
  sub: string;
  src: string;
  alt: string;
};

const CARDS: Card[] = [
  {
    title: 'All your data in one place',
    sub: '100+ labs, your biological age & health report.',
    src: '/images/membership/data-in-one-place.jpg',
    alt: 'Dashboard cards stacked on patterned background',
  },
  {
    title: 'Upload past lab data',
    sub: 'Visualize past Quest or Labcorp results.',
    src: '/images/membership/upload-past-labs.jpg',
    alt: 'Line chart of lipoprotein A',
  },
  {
    title: 'Your personalized health plan',
    sub: 'Lifestyle, diet, supplement & Rx recommendations.',
    src: '/images/membership/action-plan.jpg',
    alt: 'Action plan card',
  },
  {
    title: 'Unlimited concierge messaging',
    sub: 'Ask questions and get answers from our care team.',
    src: '/images/membership/concierge.jpg',
    alt: 'Phone in hand with chat bubble',
  },
  {
    title: 'Add-on testing anytime',
    sub: 'Advanced gut microbiome, toxins & cancer screens.',
    src: '/images/membership/addons.jpg',
    alt: 'Carousel of add-on test kits',
  },
  {
    title: 'Access to Superpower Clinic',
    sub: 'Curated solutions available after medical evaluation.',
    src: '/images/membership/clinic.jpg',
    alt: 'Supplement bottles and dropper',
  },
];

function FeatureCard({ c, i }: { c: Card; i: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35, once: true });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.5, delay: i * 0.04 }}
      className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden"
    >
      <div className="relative aspect-[4/3] w-full">
        <Image
          src={c.src}
          alt={c.alt}
          fill
          className="object-cover"
          sizes="(min-width: 1024px) 33vw, 100vw"
          priority={i < 2}
        />
      </div>
      <div className="p-4">
        <div className="text-neutral-900 font-semibold">{c.title}</div>
        <div className="text-sm text-neutral-500 mt-1">{c.sub}</div>
      </div>
    </motion.div>
  );
}

export default function MembershipSticky() {
  return (
    <section className="bg-white text-neutral-900 pt-60">
      <div className="container-soft">
        {/* 2-column layout; parent is relative so sticky knows its bounds */}
        <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          {/* LEFT (sticky) */}
          <div className="lg:col-span-4">
            <div className="sticky top-24">
              <h2 className="text-3xl md:text-4xl leading-tight">
                What’s included in your membership
              </h2>
              <p className="mt-3 text-neutral-600 max-w-md">
                Superpower is more than a blood test. Access an ecosystem of diagnostics and
                doctor-trusted solutions personalized to you.
              </p>
              <a
                href="#join"
                className="inline-flex items-center gap-2 mt-6 px-4 py-2 rounded-full bg-neutral-900 text-white hover:bg-neutral-800"
              >
                Join Today <span aria-hidden>›</span>
              </a>
            </div>
          </div>

          {/* RIGHT (scrolling cards) */}
          <div className="lg:col-span-8">
            <div className="grid sm:grid-cols-2 gap-6 lg:gap-8">
              {CARDS.map((c, i) => (
                <FeatureCard key={c.title} c={c} i={i} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
