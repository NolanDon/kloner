import Image from "next/image";
import HeroContent from "./HeroContent";

export default function Hero() {
  return (
    <section
      className="relative bg-white overflow-hidden"
      style={{
        // Use stable viewport height to avoid resize/jump when mobile browser UI collapses.
        height: "calc(100svh - var(--header-h, 0px))",
        minHeight: 560,
      }}
    >
      <div className="absolute inset-0 p-0 sm:p-4">
        <div className="relative h-full w-full overflow-hidden ring-1 ring-black/10 shadow-2xl bg-[#2a1b3e] rounded-none sm:rounded-[28px]">
          {/* BACKGROUND */}
          <div className="absolute inset-0 overflow-hidden">
            <Image
              src="/images/hero_bg.png"
              alt=""
              aria-hidden="true"
              width={2400}
              height={1600}
              priority
              fetchPriority="high"
              sizes="100vw"
              className="absolute inset-0 h-full w-full object-cover select-none pointer-events-none"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/30 to-black/10" />
          </div>

          <HeroContent displayClassName="font-black tracking-tight" />
        </div>
      </div>
    </section>
  );
}
