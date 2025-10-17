// components/Footer.tsx
'use client';

export default function Footer() {
  return (
    <footer className="relative bg-white text-neutral-900 overflow-visible">
      <div className="container-soft pt-12 md:pt-16 pb-8">
        {/* Big wordmark (no background/video) */}
        <div className="relative mx-[-6vw]">
          <h2
            className="
              select-none whitespace-nowrap font-black tracking-tight
              leading-[0.85] pt-3
              text-[clamp(5.5rem,16vw,22rem)]
              text-transparent bg-clip-text
            "
            style={{
              backgroundImage:
                'linear-gradient(90deg, #7a2e18 0%, #d44b1c 30%, #ff6f3d 60%, #ffb36b 100%)',
            }}
          >
            superpower
          </h2>
        </div>

        {/* Link columns */}
        <div className="mt-8 grid gap-10 md:grid-cols-5 text-sm">
          <Column
            title="Superpower"
            items={['How it Works', 'What’s Included', 'Membership Login', 'Gift Superpower']}
          />
          <Column
            title="Company"
            items={['Our Why', 'Join the Team', 'Superpower Labs', 'Contact Us', 'FAQs']}
            noteIndex={1}
            note="We’re hiring!"
          />
          <Column
            title="Compare"
            items={['Function Health', 'Mito Health', 'Marek Health', 'InsideTracker', 'Others']}
          />
          <Column
            title="Library"
            items={[
              'Immune System Biomarker',
              'Energy Biomarkers',
              'Kidney Health Biomarkers',
              'Liver Health Biomarkers',
              'Body Composition Biomarkers',
            ]}
          />
          <Column
            title="Partnerships"
            items={['For Creators', 'For Partners', 'For Business']}
            extraGroup={{ heading: 'Connect', items: ['X/Twitter', 'Instagram', 'LinkedIn'] }}
          />
        </div>

        <div className="mt-10 text-xs text-neutral-500">
          © 2025 Superpower Health, Inc. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

/* ---------- Pieces ---------- */

function Column({
  title,
  items,
  noteIndex,
  note,
  extraGroup,
}: {
  title: string;
  items: string[];
  noteIndex?: number;
  note?: string;
  extraGroup?: { heading: string; items: string[] };
}) {
  return (
    <div>
      <div className="mb-3 font-semibold text-neutral-700">{title}</div>
      <ul className="space-y-3">
        {items.map((label, i) => (
          <li key={label} className="flex items-start gap-2">
            <Chevron />
            <a href="#" className="hover:text-neutral-900 whitespace-nowrap text-neutral-800">
              {label}
            </a>
            {noteIndex === i && note ? (
              <span className="ml-2 text-[11px] whitespace-nowrap  text-[#ff6f3d]">[{note}]</span>
            ) : null}
          </li>
        ))}
      </ul>

      {extraGroup ? (
        <>
          <div className="mt-7 mb-3 font-semibold text-neutral-700">{extraGroup.heading}</div>
          <ul className="space-y-3">
            {extraGroup.items.map((label) => (
              <li key={label} className="flex items-start gap-2">
                <Chevron />
                <a href="#" className="hover:text-neutral-900 text-neutral-800">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mt-[2px] h-4 w-4 text-[#ff6f3d] shrink-0"
      stroke="currentColor"
      fill="none"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 12h12" />
      <path d="M12 6l6 6-6 6" />
    </svg>
  );
}
