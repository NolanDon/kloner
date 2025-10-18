// components/Stories.tsx
'use client';

import Image from 'next/image';
import SectionReveal from './SectionReveal';

type Reel = {
  src: string;
  handle: string;
  followers: string;
  avatar?: string; // optional avatar under /public
  alt?: string;
};

const reels: Reel[] = [
  { src: '/reel1.webm', handle: '@mytechceo', followers: '254k followers', avatar: '/images/avatars/portfolio1.png', alt: 'Review by @mytechceo' },
  { src: '/reel2.webm', handle: '@emmyxtech', followers: '368k followers', avatar: '/images/avatars/portfolio2.png', alt: 'Review by @emmyxtech' },
  { src: '/reel3.webm', handle: '@stefarmstead', followers: '90.2k followers', avatar: '/images/avatars/portfolio4.png', alt: 'Review by @stefarmstead' },
  { src: '/reel4.webm', handle: '@avnibarman_', followers: '228k followers', avatar: '/images/avatars/portfolio3.png', alt: 'Review by @avnibarman_' },
];

function BlueCheck({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#1DA1F2"
        d="M12 2.8l1.9 1.1 2.2-.2 1.4 1.7 2 .8.3 2.2 1.5 1.4-1 2 0 2.2-1.8 1.3-.7 2.1-2.2.4-1.5 1.6-2.2-.5L12 21l-1.9-1.1-2.2.2-1.4-1.7-2-.8-.3-2.2L2.7 12l1-2 0-2.2L5.5 6.5l.7-2.1 2.2-.4 1.5-1.6 2.2.5L12 2.8z"
      />
      <path
        fill="#fff"
        d="M10.8 14.8l-3-3 1.4-1.4 1.6 1.6 3.9-3.9 1.4 1.4z"
      />
    </svg>
  );
}

function ReelCard({ r, i }: { r: Reel; i: number }) {
  return (
    <SectionReveal delay={i * 0.04}>
      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl border border-black/10 shadow-sm bg-black">
        {/* video */}
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src={r.src}
          autoPlay
          loop
          muted
          playsInline
        // poster could be added if you have a jpg
        />

        {/* subtle edge gradient for readability */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/40" />

        {/* top overlay: avatar, handle, check, followers */}
        <div className="absolute left-3 right-3 top-3 flex items-center gap-2">
          <div className="relative h-8 w-8 overflow-hidden rounded-full bg-white/20 ring-1 ring-white/40">
            {r.avatar ? (
              <Image src={r.avatar} alt={`${r.handle} avatar`} fill className="object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center text-xs text-white/80">
                {r.handle.replace('@', '')[0]?.toUpperCase()}
              </div>
            )}
          </div>

          <div className="flex min-w-0 items-center gap-1 text-white">
            <span className="truncate font-semibold">{r.handle}</span>
            <BlueCheck className="h-4 w-4 shrink-0" />
          </div>

          <span className="ml-auto text-xs text-white/80">{r.followers}</span>
        </div>

        {/* optional bottom caption space (keep for future subtitles) */}
        {/* <div className="absolute bottom-3 left-3 right-3 text-center text-white text-sm font-medium drop-shadow">
          your subtitle here
        </div> */}
      </div>
    </SectionReveal>
  );
}

export default function Stories() {
  return (
    <section className="section bg-white mt-20 text-black" id="reviews">
      <div className="container-soft">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 className="text-4xl md:text-4xl leading-tight">
            Superpower is changing thousands of lives
          </h2>
          <a
            href="#all-reviews"
            className="hidden md:inline-flex items-center rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/70 hover:text-black hover:shadow-sm"
          >
            See more reviews
          </a>
        </div>

        {/* Mobile: horizontal snap scroller; Desktop: 4-up grid */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 md:gap-6 md:[overflow:visible]">
          {/* On mobile we fake the grid as a horizontal scroller by spanning each card full width and enabling snaps */}
          <div className="col-span-2 -mx-4 md:mx-0 md:col-span-4">
            <div className="flex gap-3 sm:gap-4 md:grid md:grid-cols-4 md:gap-6 overflow-x-auto snap-x snap-mandatory px-4 md:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {reels.map((r, i) => (
                <div
                  key={r.src}
                  className="snap-center shrink-0 basis-[75%] sm:basis-[60%] md:basis-auto md:shrink md:snap-none"
                >
                  <ReelCard r={r} i={i} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile "See more reviews" button */}
        <div className="mt-6 md:hidden">
          <a
            href="#all-reviews"
            className="inline-flex items-center rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-black/70 hover:text-black hover:shadow-sm"
          >
            See more reviews
          </a>
        </div>
      </div>
    </section>
  );
}
