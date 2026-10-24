// components/MembershipSticky.tsx
'use client';

import React from 'react';
import { useUrlOverlay } from './UrlOverlayProvider';
import Image from 'next/image';

/* ----------------------------------------------------------------
   Shared bits
------------------------------------------------------------------*/
function CardShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`relative w-full overflow-hidden bg-neutral-50 ${wide ? "aspect-[1.85/1]" : "aspect-[4/3]"}`}>
      {children}
    </div>
  );
}

function FeatureFrame({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <article className="overflow-hidden rounded-2xl shadow-xl">
      {children}
      <div className="border border-neutral-200 p-4">
        <div className="text-2xl text-neutral-800">{title}</div>
        <div className="mt-1 text-xs text-neutral-400">{sub}</div>
      </div>
    </article>
  );
}

/* ----------------------------------------------------------------
   Editor screenshots and the Grounded Therapy site preview
------------------------------------------------------------------*/
function ThemedEditorScreenshot({
  lightSrc,
  darkSrc,
  alt,
}: {
  lightSrc: string;
  darkSrc: string;
  alt: string;
}) {
  return (
    <CardShell wide>
      <Image
        src={lightSrc}
        alt={alt}
        fill
        sizes="(min-width: 1280px) 760px, (min-width: 1024px) 60vw, 100vw"
        quality={78}
        loading="lazy"
        className="theme-editor-screenshot theme-editor-screenshot-light object-contain"
      />
      <Image
        src={darkSrc}
        alt=""
        aria-hidden="true"
        fill
        sizes="(min-width: 1280px) 760px, (min-width: 1024px) 60vw, 100vw"
        quality={78}
        loading="lazy"
        className="theme-editor-screenshot theme-editor-screenshot-dark object-contain"
      />
    </CardShell>
  );
}

function MiniAiEditor() {
  return (
    <ThemedEditorScreenshot
      lightSrc="/images/editor-demo/ai-editor-light.webp"
      darkSrc="/images/editor-demo/ai-editor-dark.webp"
      alt="Kloner AI chat editor beside a live website preview"
    />
  );
}

function MiniGroundedTherapy() {
  return (
    <CardShell>
      <Image
        src="/images/included-section/5.jpg"
        alt="Grounded Therapy website preview"
        fill
        sizes="(min-width: 1280px) 760px, (min-width: 1024px) 60vw, 100vw"
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </CardShell>
  );
}

function MiniCustomEditor() {
  return (
    <ThemedEditorScreenshot
      lightSrc="/images/editor-demo/manual-editor-light.webp"
      darkSrc="/images/editor-demo/manual-editor-dark.webp"
      alt="Kloner manual editor with visual controls and a live website preview"
    />
  );
}

/* ----------------------------------------------------------------
   Data + Renderer
------------------------------------------------------------------*/
type CardData = {
  title: string;
  sub: string;
  Mini: React.ComponentType;
};

const CARDS: CardData[] = [
  { title: 'Customize with AI', sub: 'Select page elements and adjust the layout, spacing, and style directly.', Mini: MiniAiEditor },
  { title: 'Grounded Therapy', sub: 'A real website preview, ready to refine and make your own.', Mini: MiniGroundedTherapy },
  { title: 'Manual customization', sub: 'Fine-tune typography, colors, spacing, images, and more in the visual editor.', Mini: MiniCustomEditor },
];

/* ----------------------------------------------------------------
   Section
------------------------------------------------------------------*/
export default function MembershipSticky({ heading = 'What your website cloner includes' }: { heading?: string } = {}) {
  const { openUrlOverlay } = useUrlOverlay();

  return (
    <section className="bg-white text-neutral-800 pt-30 md:pt-60">
      <div className="container-soft">
        <div className="relative grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
          {/* LEFT (sticky) */}
          <div className="lg:col-span-4">
            <div className="md:sticky top-24">
              <h2 className="text-4xl md:text-6xl md:mb-10 text-black/80 bg-transparent px-0 py-0 mt-20 leading-[1.08]">
                {heading}
              </h2>

              <div className="mt-20">
                <p className="mt-[-40px] md:mt-3 max-w-md text-lg leading-relaxed text-neutral-600 md:text-xl">
                  Start from a public URL, review the supported website structure and available assets, edit the result with AI, and deploy when it is ready.
                </p>
              </div>

              <button
                type="button"
                onClick={openUrlOverlay}
                className="mt-10 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-4 text-white shadow-sm transition-all duration-200 hover:scale-[1.04] hover:shadow-[0_10px_24px_rgba(255,141,33,0.28)] active:scale-[0.98]"
              >
                Start free preview <span aria-hidden>›</span>
              </button>
            </div>
          </div>

          {/* RIGHT (scrolling cards) */}
          <div className="lg:col-span-8 pt-20 md:pt-60">
            <div className="grid gap-6 lg:gap-8">
              {CARDS.map((c) => (
                <FeatureFrame key={c.title} title={c.title} sub={c.sub}>
                  <c.Mini />
                </FeatureFrame>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
