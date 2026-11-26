// components/HomeCompare.tsx
"use client";

import SectionReveal from "./SectionReveal";

const ACCENT = "#FF8D21";

type CompareRow = {
  label: string;
  kloner: string;
  anima: string;
  uxPilot: string;
  alloy: string;
};

const rows: CompareRow[] = [
  {
    label: "Starts from",
    kloner: "A live website URL",
    anima: "Figma designs and prompts",
    uxPilot: "Text prompts",
    alloy: "A live URL, through a Chrome extension",
  },
  {
    label: "Free preview of your clone",
    kloner: "Yes (limited)",
    anima: "No, it does not clone live sites",
    uxPilot: "No, it does not clone live sites",
    alloy: "Yes",
  },
  {
    label: "Multi-page and interaction capture",
    kloner: "Yes, multi-page crawl",
    anima: "No",
    uxPilot: "No",
    alloy: "Yes",
  },
  {
    label: "Downloadable code",
    kloner: "Yes, on paid plans",
    anima: "Yes, HTML and React export",
    uxPilot: "Design files for handoff",
    alloy: "Yes",
  },
  {
    label: "Editing after capture",
    kloner: "Visual editor and an AI agent",
    anima: "Design editor",
    uxPilot: "Prompt editing",
    alloy: "Limited editing",
  },
];

export default function HomeCompare() {
  return (
    <section className="section bg-white">
      <div className="container-soft">
        <SectionReveal>
          <h2 className="text-center text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl">
            How Kloner compares
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-base text-neutral-600">
            Most tools in this category start from a design or a prompt. Kloner starts from the live website you want to clone.
          </p>
        </SectionReveal>
        <SectionReveal delay={0.05}>
          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm md:text-base">
              <thead>
                <tr className="border-b border-neutral-200">
                  <th scope="col" className="px-4 py-3 font-semibold text-neutral-900">
                    <span className="sr-only">Feature</span>
                  </th>
                  <th scope="col" className="bg-[#FFF8ED] px-4 py-3 font-semibold text-neutral-900">
                    Kloner
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold text-neutral-900">
                    Anima
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold text-neutral-900">
                    UX Pilot
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold text-neutral-900">
                    Alloy
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-b border-neutral-100 align-top">
                    <th scope="row" className="px-4 py-3 font-medium text-neutral-600">
                      {row.label}
                    </th>
                    <td className="bg-[#FFF8ED] px-4 py-3 font-semibold text-neutral-900">
                      {row.kloner}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{row.anima}</td>
                    <td className="px-4 py-3 text-neutral-700">{row.uxPilot}</td>
                    <td className="px-4 py-3 text-neutral-700">{row.alloy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-center text-sm text-neutral-500">
            Checked against each product&apos;s public pages in November 2026.{" "}
            <a href="/compare" className="font-medium underline underline-offset-4" style={{ color: ACCENT }}>
              See the full comparison
            </a>
          </p>
        </SectionReveal>
        <SectionReveal delay={0.1}>
          <div className="mx-auto mt-10 flex max-w-3xl flex-col items-center justify-between gap-4 rounded-2xl border border-neutral-200 bg-neutral-50 px-6 py-5 sm:flex-row">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-neutral-700">
              <span>
                <strong className="text-neutral-900">Free</strong> $0
              </span>
              <span>
                <strong className="text-neutral-900">Pro</strong> $29/mo
              </span>
              <span>
                <strong className="text-neutral-900">Agency</strong> $99/yr
              </span>
            </div>
            <a href="/price" className="shrink-0 rounded-full bg-[#FF8D21] px-5 py-2 text-sm font-semibold text-white">
              See pricing
            </a>
          </div>
        </SectionReveal>
      </div>
    </section>
  );
}
