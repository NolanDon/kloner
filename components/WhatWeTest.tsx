// components/WhatWeTest.tsx
import SectionReveal from "./SectionReveal";

type Category = { label: string; icon?: string };

const categories: Category[] = [
  { label: "Heart & Vascular Health", icon: "/images/icons/heart.png" },
  { label: "Kidney Health", icon: "/images/icons/kidney.png" },
  { label: "Metabolic Health", icon: "/images/icons/metabolic.png" },
  { label: "Inflammation", icon: "/images/icons/inflammation.png" },
  { label: "Energy", icon: "/images/icons/energy.png" },
  { label: "Body Composition", icon: "/images/icons/body.png" },
  { label: "Liver Health", icon: "/images/icons/liver.png" },
  { label: "Sex Hormones", icon: "/images/icons/sex-hormones.png" },
  { label: "Nutrients", icon: "/images/icons/nutrients.png" },
  { label: "Thyroid Health", icon: "/images/icons/thyroid.png" },
  { label: "Immune System", icon: "/images/icons/immune.png" },
  { label: "DNA Health", icon: "/images/icons/dna.png" },
];

const biomarkers = [
  "Lp(a)",
  "ADMA",
  "Lipoprotein fractionation",
  "Uric Acid / HDL-C",
  "TG / ApoB",
  "Atherogenic Coefficient",
  "Triglyceride / HDL Cholesterol (Molar Ratio)",
  "VLDL Size",
  "Large VLDL P",
  "HDL Size",
  "Small LDL P",
  "LDL P",
  "SDMA",
  "Cystatin C (with eGFR)",
  "Non-HDL Cholesterol / Apolipoprotein B",
  "LDL-C / ApoB",
  "Neutrophil-to-HDL Cholesterol Ratio (NHR)",
  "Atherogenic Index of Plasma (AIP)",
  "Non-HDL Cholesterol / Total Cholesterol",
  "LDL Cholesterol / Total Cholesterol (Mass Ratio)",
  "Large HDL P",
  "LDL Size",
  "HDL P",
  "Lipoprotein (a)",
];

const advancedSet = new Set([
  "VLDL Size",
  "Large VLDL P",
  "HDL Size",
  "Small LDL P",
  "LDL P",
  "Large HDL P",
  "LDL Size",
  "HDL P",
  "Lipoprotein (a)",
]);

function IconChip({ src }: { src?: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-7 w-7 rounded-md object-cover ring-1 ring-black/10"
      />
    );
  }
  // fallback gradient chip if you don't provide an image
  return (
    <span className="h-7 w-7 rounded-md bg-gradient-to-br from-orange-200 to-rose-200 ring-1 ring-black/10 inline-block" />
  );
}

export default function WhatWeTest() {
  return (
    <section
      id="test"
      className="bg-white text-black border border-t-0 rounded-b-[5%]"
    >
      <div className="container-soft py-16 md:py-24">

        <SectionReveal>
          <h2 className="text-4xl text-black">See everything we test</h2>
          <p className="mt-3 mb-10 text-black/60 max-w-2xl">
            The following 100+ biomarkers are included with your annual Superpower membership.
          </p>
        </SectionReveal>

        <div className="grid gap-8 md:grid-cols-4">
          {/* Left two columns: categories with icons */}
          <div className="space-y-4">
            {categories.slice(0, 6).map((c, i) => (
              <SectionReveal key={c.label} delay={i * 0.03}>
                <div className="flex items-center gap-3">
                  <IconChip src={c.icon} />
                  <span className="text-black/80">{c.label}</span>
                </div>
              </SectionReveal>
            ))}
          </div>

          <div className="space-y-4">
            {categories.slice(6).map((c, i) => (
              <SectionReveal key={c.label} delay={i * 0.03}>
                <div className="flex items-center gap-3">
                  <IconChip src={c.icon} />
                  <span className="text-black/80">{c.label}</span>
                </div>
              </SectionReveal>
            ))}
          </div>

          {/* Right: biomarker list in two columns inside a light card */}
          <div className="md:col-span-2">
            <div className="rounded-2xl border border-black/10 bg-white p-6 md:p-7 shadow-sm">
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-y-2 md:gap-x-8">
                {biomarkers.map((name, i) => {
                  const isAdv = advancedSet.has(name);
                  return (
                    <li
                      key={name}
                      className="flex items-center justify-between border-b border-black/5 py-2 last:border-none"
                    >
                      <span className="text-black/80">{name}</span>
                      {isAdv && (
                        <span className="ml-3 shrink-0 rounded-full border border-black/10 bg-black/5 px-2.5 py-1 text-xs text-black/60">
                          Advanced panel
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
