import { Outfit } from "next/font/google";
import Image from "next/image";
import HeroContent from "./HeroContent";

const display = Outfit({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
});

export default function Hero() {
  return (
    <section
      className="relative bg-white"
      style={{
        height: "calc(100dvh - var(--header-h, 0px))",
        minHeight: 560,
      }}
    >
      <div className="absolute inset-0 p-3 sm:p-4">
        <div className="relative h-full w-full overflow-hidden ring-1 ring-black/10 shadow-2xl bg-[#2a1b3e] rounded-none sm:rounded-[28px]">
          {/* BACKGROUND */}
          <div className="absolute inset-0 overflow-hidden">
            <Image
              src="/images/hero_bg.jpg"
              alt="Hero background"
              fill
              priority
              fetchPriority="high"
              sizes="100vw"
              className="object-cover select-none pointer-events-none"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/30 to-black/60" />
          </div>

          <HeroContent displayClassName={display.className} />
        </div>
      </div>
    </section>
  );
}
