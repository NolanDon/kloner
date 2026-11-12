import Image from "next/image";
import HeroContent from "./HeroContent";

export default function Hero({ eyebrow, heading, subhead }: { eyebrow?: string; heading?: React.ReactNode; subhead?: string } = {}) {
  return (
    <section
      className="relative overflow-hidden bg-[#241b18]"
      style={{
        // Use stable viewport height to avoid resize/jump when mobile browser UI collapses.
        height: "calc(100svh - var(--header-h, 0px))",
        minHeight: 560,
      }}
    >
      <div className="absolute inset-0">
        <div className="relative h-full w-full overflow-hidden bg-[#2a1b3e]">
          {/* BACKGROUND */}
          <div className="absolute inset-0 overflow-hidden">
            <Image
              src="/images/website-cloner-hero.webp"
              alt="Website cloner hero background: a warm sunset over a mountain valley"
              title="Website cloner homepage hero background"
              width={1695}
              height={928}
              priority
              fetchPriority="high"
              unoptimized
              sizes="100vw"
              className="absolute inset-0 h-full w-full object-cover select-none pointer-events-none"
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(18,15,14,0.14)_0%,rgba(24,20,19,0.45)_47%,rgba(18,15,14,0.2)_100%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(18,15,14,0.28)_0%,rgba(18,15,14,0.04)_48%,rgba(18,15,14,0.3)_100%)]" />
          </div>

          <HeroContent displayClassName="tracking-tight" eyebrow={eyebrow} heading={heading} subhead={subhead} />
        </div>
      </div>
    </section>
  );
}
