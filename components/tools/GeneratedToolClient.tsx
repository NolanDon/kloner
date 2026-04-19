"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Copy, Download, X } from "lucide-react";
import type { ToolConfig } from "./toolRegistry";

type CopyFeedbackValue = {
  copied: boolean;
  setCopied: (value: boolean) => void;
  nextStepHighlighted: boolean;
  setNextStepHighlighted: (value: boolean) => void;
  copyValue: string | null;
  setCopyValue: (value: string | null) => void;
  inPromoModal: boolean;
};

const CopyFeedbackContext = createContext<CopyFeedbackValue | null>(null);

function useCopyFeedback() {
  const context = useContext(CopyFeedbackContext);
  if (!context) {
    throw new Error("CopyFeedbackContext is missing");
  }
  return context;
}

function copyToClipboard(value: string) {
  return navigator.clipboard.writeText(value);
}

function downloadText(content: string, fileName: string, mimeType = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function slugLabel(slug: string) {
  return slug
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

function randomFrom<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)]!;
}

function randomInt(max: number) {
  return Math.floor(Math.random() * Math.max(1, max));
}

function makeRandomNumbers(count: number, min: number, max: number) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const range = Math.max(1, high - low + 1);
  return Array.from({ length: count }, () => low + randomInt(range));
}

function makeRandomWords(count: number, theme: string) {
  const pools: Record<string, string[]> = {
    neutral: ["focus", "signal", "launch", "build", "simple", "clear", "ready", "fast", "sharp", "flow"],
    creative: ["spark", "drift", "pixel", "orbit", "vibe", "sketch", "stitch", "prism", "pulse", "nova"],
    nature: ["river", "cedar", "stone", "meadow", "forest", "cloud", "reef", "bloom", "dune", "rain"],
  };
  const pool = pools[theme] ?? pools.neutral;
  return Array.from({ length: count }, () => randomFrom(pool));
}

function makeLorem(paragraphs: number, sentences: number) {
  const sentencePool = [
    "Kloner turns messy ideas into clean interfaces fast.",
    "The layout stays practical while the presentation feels polished.",
    "Small details make the result feel finished instead of placeholder.",
    "Each section should make the next action obvious.",
    "Simple structure keeps the output easy to scan and copy.",
  ];
  const paragraphCount = Math.max(1, paragraphs);
  const sentenceCount = Math.max(1, sentences);
  return Array.from({ length: paragraphCount }, () => Array.from({ length: sentenceCount }, () => randomFrom(sentencePool)).join(" ")).join("\n\n");
}

function makePalette(seed: string) {
  const base = seed.trim() ? seed.trim().length * 37 : 220;
  return [0, 1, 2, 3, 4].map((index) => {
    const hue = (base + index * 36) % 360;
    const saturation = 72 - index * 7;
    const lightness = 54 + (index % 2) * 8 - index * 2;
    return hslToHex(hue, saturation, lightness);
  });
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const normalizedHue = (((hue % 360) + 360) % 360) / 360;
  const normalizedSaturation = saturation / 100;
  const normalizedLightness = lightness / 100;
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const segment = normalizedHue * 6;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));

  let red = 0;
  let green = 0;
  let blue = 0;

  if (segment < 1) {
    red = chroma;
    green = secondary;
  } else if (segment < 2) {
    red = secondary;
    green = chroma;
  } else if (segment < 3) {
    green = chroma;
    blue = secondary;
  } else if (segment < 4) {
    green = secondary;
    blue = chroma;
  } else if (segment < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  const matchLightness = normalizedLightness - chroma / 2;
  const toHex = (value: number) => Math.round((value + matchLightness) * 255).toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`.toUpperCase();
}

function makeAcronyms(text: string, count: number) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const base = words.length ? words : ["quick", "build", "launch"];
  const primary = base.map((word) => word[0]!.toUpperCase()).join("");
  const variants = [primary, primary.split("").reverse().join(""), `${primary.slice(0, 3)}X`, `${primary.slice(0, 2)}${base[0]![0]!.toUpperCase()}${base[base.length - 1]![0]!.toUpperCase()}`];
  return Array.from(new Set(variants)).slice(0, count);
}

function makeAnagrams(word: string, count: number) {
  const letters = word.replace(/\s+/g, "").split("").filter(Boolean);
  const output = new Set<string>();
  if (!letters.length) return [];
  output.add(word);
  while (output.size < count) {
    output.add(letters.sort(() => Math.random() - 0.5).join(""));
  }
  return Array.from(output).slice(0, count);
}

function makeBusinessNames(topic: string) {
  const base = slugLabel(topic.trim() || "studio");
  return [`${base} Lab`, `${base} Works`, `${base} Studio`, `${base} Co`, `${base} House`, `${base} Forge`];
}

function makeSlogans(brand: string, category: string) {
  const base = brand.trim() || "Kloner";
  const subject = category.trim() || "builds";
  return [
    `${base} makes ${subject} feel easy.`,
    `Build faster with ${base}.`,
    `A cleaner way to ship ${subject}.`,
    `${base}: less setup, more momentum.`,
  ];
}

function makeUsernames(seed: string, count: number, includeNumbers = false) {
  const base = seed.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || "creator";
  const stems = [base, `${base}hub`, `${base}app`, `${base}x`, `real${base}`];
  return Array.from({ length: count }, (_, index) => includeNumbers ? `${stems[index % stems.length]}${100 + index * 7}` : stems[index % stems.length]);
}

function makeEmails(name: string, domain: string, count: number) {
  const local = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".") || "hello";
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, "") || "example.com";
  return Array.from({ length: count }, (_, index) => `${local}${index ? index + 1 : ""}@${host}`);
}

function makeUUIDs(count: number) {
  return Array.from({ length: count }, () => crypto.randomUUID());
}

function makeHashtags(topic: string, count: number) {
  const words = topic.toLowerCase().split(/\s+/).filter(Boolean);
  const seed = words.length ? words : ["launch", "build", "create"];
  const baseTags = seed.map((word) => `#${word}`);
  const extra = [`#${seed.join("")}`, `#${seed[0]}${seed[seed.length - 1]}`, "#buildinpublic", "#shipit"];
  return Array.from(new Set([...baseTags, ...extra])).slice(0, count);
}

function makeFontSample(stack: string) {
  const stacks: Record<string, string> = {
    serif: "Georgia, 'Times New Roman', serif",
    sans: "Arial, Helvetica, sans-serif",
    mono: "'SFMono-Regular', Consolas, monospace",
    cursive: "cursive",
    display: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
  };
  return stacks[stack] ?? stacks.serif;
}

function makeBarcodeSvg(value: string) {
  const chars = value || "1234567890";
  const bars = Array.from(chars).flatMap((char, index) => {
    const code = char.charCodeAt(0);
    const width = 2 + (code % 3);
    const gap = index % 2 === 0 ? 1 : 2;
    return [{ width }, { width: gap, empty: true }];
  });
  let x = 0;
  const rects = bars
    .map((bar) => {
      const width = bar.width;
      const empty = Boolean((bar as { empty?: boolean }).empty);
      const rect = empty ? "" : `<rect x="${x}" y="8" width="${width}" height="48" fill="#111" />`;
      x += width;
      return rect;
    })
    .join("");
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 ${Math.max(220, x + 20)} 80"><rect width="100%" height="100%" fill="#fff"/>${rects}<text x="50%" y="72" text-anchor="middle" font-size="12" fill="#444" font-family="Arial, sans-serif">${value}</text></svg>`,
  )}`;
}

function makeWordCloudWords(input: string) {
  const words = input.split(/[,\n]+/).map((word) => word.trim()).filter(Boolean);
  const expanded = words.length ? words : ["ideas", "build", "launch", "design", "ship"];
  return expanded.map((word, index) => ({ word, size: 18 + ((index * 7) % 22) }));
}

function makeTitleIdeas(topic: string) {
  const base = topic.trim() || "your project";
  return [
    `${slugLabel(base)}: a quick way to get started`,
    `How to build ${base} without slowing down`,
    `A simple guide to ${base}`,
    `What to know before you ship ${base}`,
  ];
}

function makePlotIdeas(topic: string) {
  const base = topic.trim() || "a fresh idea";
  const subject = slugLabel(base);
  const protagonistOptions = ["a designer with a deadline", "a founder chasing proof", "an outsider with one shot", "a builder trying to fix a mistake", "a skeptic who is forced to lead"];
  const settingOptions = ["a city that moves too fast", "a cramped workshop full of unfinished plans", "a small team under pressure", "a place where everyone expects a shortcut", "a world that rewards speed over care"];
  const obstacleOptions = ["the easiest path keeps making things worse", "a public failure raises the stakes", "a missing piece changes the whole plan", "a rival solves the problem first", "the original goal turns out to be the wrong one"];
  const stakesOptions = ["If they miss the window, the opportunity disappears.", "If they choose wrong, they lose trust and momentum.", "If they hesitate, someone else defines the outcome.", "If they fail here, the next chance will not come quickly."];
  const titleIdeas = [`${subject}: The First Attempt`, `What It Takes to Build ${subject}`, `The Day ${subject} Got Complicated`, `How ${subject} Almost Worked`];
  return {
    topic: subject,
    logline: `When ${randomFrom(protagonistOptions)} takes on ${base}, the plan looks simple until ${randomFrom(obstacleOptions)}.`,
    premise: `${subject} unfolds in ${randomFrom(settingOptions)}, where every decision makes the next one harder.`,
    protagonist: randomFrom(protagonistOptions),
    setting: randomFrom(settingOptions),
    obstacle: randomFrom(obstacleOptions),
    stakes: randomFrom(stakesOptions),
    beats: [
      `Open with a clear goal tied to ${base}.`,
      `Introduce the first win, then let ${randomFrom(obstacleOptions)}.`,
      `Force a decision that costs more than expected.`,
      `End with a choice that changes the direction of the whole story.`,
    ],
    titleIdeas,
    prompt: `A story about ${base} that starts with momentum, hits a setback, and ends with a sharper choice.`,
  };
}

function makeRandomWordsToolCopy(theme: string, count: number) {
  return makeRandomWords(count, theme).join(", ");
}

function makeRandomNumberList(min: number, max: number, count: number) {
  return makeRandomNumbers(count, min, max);
}

const TOOL_SHOWCASE = [
  {
    title: "Preview in browser",
    src: "/images/showcase/showcase1.jpg",
    alt: "Kloner showcase preview 1",
  },
  {
    title: "Edit with AI",
    src: "/images/showcase/showcase2.jpg",
    alt: "Kloner showcase preview 2",
  },
  {
    title: "Export ready",
    src: "/images/showcase/showcase3.jpg",
    alt: "Kloner showcase preview 3",
  },
  {
    title: "Deploy smoothly",
    src: "/images/showcase/showcase4.jpg",
    alt: "Kloner showcase preview 4",
  },
  {
    title: "Full workflow",
    src: "/images/showcase/showcase5.jpg",
    alt: "Kloner showcase preview 5",
  },
];

const KLONER_POPUP_HREF = "https://kloner.app/?utm_source=kloner&utm_medium=popup&utm_campaign=tool_promo&utm_content=built_in_tool_popup";

function ToolPromoModal(_props: {
  open: boolean;
  onDismiss: () => void;
  headline: string;
  summary: string;
  preview?: ReactNode;
}) {
  const { open, onDismiss, headline, summary, preview } = _props;

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onDismiss]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[26000] simple-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
    >
      <div className="absolute inset-0 bg-white/72 backdrop-blur-[8px] simple-fade-in" />

      <div className="relative z-20 flex h-full items-center justify-center px-2 py-2 sm:px-4 sm:py-8 simple-fade-in">
        <div className="pointer-events-auto relative flex max-h-[calc(100vh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-neutral-200 bg-white text-neutral-900 shadow-[0_28px_120px_rgba(15,23,42,0.16)] simple-fade-in sm:max-h-[calc(100vh-2rem)] sm:rounded-[28px]">
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDismiss();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDismiss();
            }}
            className="absolute right-3 top-3 z-30 inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition hover:bg-neutral-50 hover:text-neutral-800 sm:right-4 sm:top-4"
            aria-label="Close prompt"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex-1 overflow-y-auto px-4 pb-4 pt-10 sm:px-8 sm:pb-5 sm:pt-8">
            <div className="flex flex-col items-center text-center">
              <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full border border-amber-100 bg-amber-50 text-[#f55f2a] sm:h-12 sm:w-12">
                <CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>

              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#f55f2a] sm:text-xs sm:tracking-[0.24em]">
                Try Kloner
              </p>
              <h3 className="mt-2 max-w-xl text-[1.55rem] font-normal leading-tight tracking-tight text-neutral-900 sm:text-4xl">
                {headline}
              </h3>
              <p className="mt-3 max-w-xl text-sm leading-5 text-neutral-600 sm:leading-6">
                {summary}
              </p>

              {preview ? (
                <div className="mt-4 w-full overflow-hidden rounded-[18px] border border-neutral-200 bg-neutral-50 px-3 py-3 text-left shadow-[0_18px_50px_rgba(15,23,42,0.06)] sm:mt-5 sm:rounded-[24px] sm:px-4 sm:py-4">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500 sm:text-xs sm:tracking-[0.22em]">
                    Your result
                  </div>
                  <div className="max-h-[14rem] overflow-auto rounded-[16px] bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)] sm:max-h-[18rem] sm:rounded-[20px] sm:p-4">
                    {preview}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 w-full overflow-hidden rounded-[18px] bg-white/95 px-3 py-3 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:mt-5 sm:rounded-[24px] sm:px-4 sm:py-4">
                <div className="mb-3 text-left text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500 sm:text-xs sm:tracking-[0.22em]">
                  What you can build with Kloner
                </div>
                <div className="overflow-hidden">
                  <div className="website-paywall-carousel flex min-w-max gap-3">
                    {Array.from({ length: 2 }).flatMap((_, rowIndex) =>
                      TOOL_SHOWCASE.map((item) => (
                        <div
                          key={`${rowIndex}-${item.title}`}
                          className="w-[160px] shrink-0 rounded-[18px] bg-white p-2 text-left shadow-[0_16px_38px_rgba(15,23,42,0.10)] sm:w-[240px] sm:p-3"
                        >
                          <div className="overflow-hidden rounded-[16px] shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                            <img
                              src={item.src}
                              alt={item.alt}
                              className="h-[104px] w-full object-cover sm:h-[160px]"
                            />
                          </div>
                        </div>
                      )),
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-neutral-200 bg-white px-4 py-4 sm:px-8 sm:py-5">
            <div className="flex w-full flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <a
                href={KLONER_POPUP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full min-w-0 items-center justify-center rounded-full bg-[#f55f2a] px-7 py-3.5 text-base font-semibold text-white shadow-[0_16px_36px_rgba(245,95,42,0.24)] transition hover:bg-[#f3602c] hover:shadow-[0_20px_42px_rgba(245,95,42,0.28)] sm:min-w-[200px]"
              >
                Try Kloner
              </a>
            </div>

            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={onDismiss}
                className="text-sm font-medium text-neutral-500 underline underline-offset-4 decoration-neutral-300 transition hover:text-neutral-700 hover:decoration-neutral-500"
              >
                Keep using this tool
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ToolShell({
  tool,
  headline,
  summary,
  left,
  right,
}: {
  tool: ToolConfig;
  headline: string;
  summary: string;
  left: ReactNode;
  right: ReactNode;
}) {
  const [promoOpen, setPromoOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nextStepHighlighted, setNextStepHighlighted] = useState(false);
  const [copyValue, setCopyValue] = useState<string | null>(null);

  return (
    <CopyFeedbackContext.Provider value={{ copied, setCopied, nextStepHighlighted, setNextStepHighlighted, copyValue, setCopyValue, inPromoModal: false }}>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr] items-start">
        <ToolPromoModal open={promoOpen} onDismiss={() => setPromoOpen(false)} headline={headline} summary={summary} preview={right} />
        <div className="space-y-4">{left}</div>
        <div className="space-y-4">{right}</div>
        <div className="lg:col-span-2 flex justify-end">
          <button type="button" onClick={() => setPromoOpen(true)} className={`rounded-full px-4 py-2 text-sm transition ${nextStepHighlighted ? "bg-[#f55f2a] text-white shadow-[0_16px_36px_rgba(245,95,42,0.24)]" : "border border-neutral-200 text-neutral-700 hover:border-[#f55f2a] hover:text-[#f55f2a]"}`}>
            See next step
          </button>
        </div>
      </div>
    </CopyFeedbackContext.Provider>
  );
}

function CopyRow({ value, onCopied }: { value: string; onCopied?: () => void }) {
  const { copied, setCopied, setNextStepHighlighted, setCopyValue, inPromoModal } = useCopyFeedback();

  useEffect(() => {
    setCopyValue(value);
    return () => setCopyValue(null);
  }, [setCopyValue, value]);

  if (inPromoModal) {
    return null;
  }

  return (
    <button type="button" onClick={async () => { await copyToClipboard(value); setCopied(true); setNextStepHighlighted(true); window.setTimeout(() => setCopied(false), 1200); onCopied?.(); }} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm transition ${copied ? "border border-[#f55f2a] bg-[#f55f2a] text-white shadow-[0_12px_28px_rgba(245,95,42,0.18)]" : "border border-neutral-200 bg-white text-neutral-700 hover:border-[#f55f2a] hover:text-[#f55f2a]"}`}>
      <Copy className="h-3.5 w-3.5" />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function TextListResult({ items }: { items: string[] }) {
  return (
    <div className="max-h-[16rem] overflow-y-auto pr-1">
      <div className="grid gap-2">
        {items.map((item) => (
          <div key={item} className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-800">{item}</div>
        ))}
      </div>
    </div>
  );
}

function GenericPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[1.75rem] border border-neutral-200 bg-white p-4 shadow-[0_14px_36px_rgba(15,23,42,0.08)]">
      <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function RenderGeneratedTool({ tool }: { tool: ToolConfig }) {
  const [copyValue, setCopyValue] = useState<string>(tool.intro);

  const content = useMemo(() => {
    switch (tool.slug) {
      case "random-number-generator": {
        const result = makeRandomNumbers(8, 1, 100);
        return {
          headline: "Random numbers are ready",
          summary: "A quick set of numbers is ready to copy.",
          left: <GenericPanel title="Generate"><button type="button" onClick={() => setCopyValue(makeRandomNumbers(8, 1, 100).join(", "))} className="rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white">Generate numbers</button></GenericPanel>,
          right: <GenericPanel title="Result"><div className="flex flex-wrap gap-2">{result.map((number, index) => <span key={`${number}-${index}`} className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-sm text-neutral-900">{number}</span>)}</div><div className="mt-4 flex gap-2"><CopyRow value={result.join(", ")} onCopied={() => setCopyValue(result.join(", "))} /></div></GenericPanel>,
        };
      }
      case "random-word-generator": {
        const result = makeRandomWords(10, "creative");
        return {
          headline: "Random words are ready",
          summary: "Quick word ideas are ready to copy.",
          left: <GenericPanel title="Generate"><button type="button" onClick={() => setCopyValue(makeRandomWordsToolCopy("creative", 10))} className="rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white">Generate words</button></GenericPanel>,
          right: <GenericPanel title="Result"><TextListResult items={result} /><div className="mt-4"><CopyRow value={result.join(" ")} onCopied={() => setCopyValue(result.join(" "))} /></div></GenericPanel>,
        };
      }
      case "lorem-ipsum-generator": {
        const result = makeLorem(3, 3);
        return {
          headline: "Lorem ipsum is ready",
          summary: "Placeholder copy is ready to paste.",
          left: <GenericPanel title="Generate"><button type="button" onClick={() => setCopyValue(makeLorem(3, 3))} className="rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white">Generate copy</button></GenericPanel>,
          right: <GenericPanel title="Result"><pre className="whitespace-pre-wrap text-sm leading-6 text-neutral-800">{result}</pre><div className="mt-4"><CopyRow value={result} onCopied={() => setCopyValue(result)} /></div></GenericPanel>,
        };
      }
      case "color-palette-generator": {
        const palette = makePalette("warm");
        return {
          headline: "Color palette is ready",
          summary: "A five-color palette is ready to copy.",
          left: <GenericPanel title="Seed">Warm</GenericPanel>,
          right: <GenericPanel title="Palette"><div className="grid grid-cols-5 gap-2">{palette.map((color) => <div key={color} className="overflow-hidden rounded-[1.2rem] border border-neutral-200 bg-white"><div style={{ background: color }} className="h-20" /><div className="px-2 py-2 text-center text-[11px] font-mono text-neutral-700">{color}</div></div>)}</div><div className="mt-4"><CopyRow value={palette.join(", ")} onCopied={() => setCopyValue(palette.join(", "))} /></div></GenericPanel>,
        };
      }
      case "favicon-generator": {
        const svg = makeBarcodeSvg("K");
        return {
          headline: "Favicon is ready",
          summary: "A quick icon preview is ready.",
          left: <GenericPanel title="Label">K</GenericPanel>,
          right: <GenericPanel title="Preview"><img src={svg} alt="Favicon preview" className="h-24 w-24 rounded-3xl border border-neutral-100 bg-neutral-50 p-2" /><div className="mt-4 flex gap-2"><button type="button" onClick={() => downloadText(svg, "favicon.svg", "image/svg+xml")} className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700"><Download className="h-3.5 w-3.5" />Download SVG</button><CopyRow value={svg} onCopied={() => setCopyValue(svg)} /></div></GenericPanel>,
        };
      }
      case "font-generator-tool": {
        const fontFamily = makeFontSample("serif");
        return {
          headline: "Font preview is ready",
          summary: "A quick font sample is ready.",
          left: <GenericPanel title="Sample">Build something crisp.</GenericPanel>,
          right: <GenericPanel title="Preview"><div style={{ fontFamily }} className="text-3xl leading-tight text-neutral-900">Build something crisp.</div><div className="mt-4"><CopyRow value={`font-family: ${fontFamily};`} onCopied={() => setCopyValue(`font-family: ${fontFamily};`)} /></div></GenericPanel>,
        };
      }
      case "hashtag-generator": {
        const result = makeHashtags("launch day", 10);
        return {
          headline: "Hashtags are ready",
          summary: "Quick hashtag ideas are ready to copy.",
          left: <GenericPanel title="Topic">Launch day</GenericPanel>,
          right: <GenericPanel title="Result"><TextListResult items={result} /><div className="mt-4"><CopyRow value={result.join(" ")} onCopied={() => setCopyValue(result.join(" "))} /></div></GenericPanel>,
        };
      }
      case "slogan-generator": {
        const result = makeSlogans("Kloner", "website builder");
        return {
          headline: "Slogans are ready",
          summary: "Short brand lines are ready to copy.",
          left: <GenericPanel title="Brand">Kloner</GenericPanel>,
          right: <GenericPanel title="Result"><TextListResult items={result} /><div className="mt-4"><CopyRow value={result.join("\n")} onCopied={() => setCopyValue(result.join("\n"))} /></div></GenericPanel>,
        };
      }
      case "business-name-generator": {
        const result = makeBusinessNames(tool.keyword);
        return {
          headline: "Brand names are ready",
          summary: "A short name set is ready to copy.",
          left: <GenericPanel title="Business type">{tool.keyword}</GenericPanel>,
          right: <GenericPanel title="Result"><TextListResult items={result} /><div className="mt-4"><CopyRow value={result.join("\n")} onCopied={() => setCopyValue(result.join("\n"))} /></div></GenericPanel>,
        };
      }
      case "email-generator": {
        const result = makeEmails("test user", "example.com", 6);
        return {
          headline: "Email addresses are ready",
          summary: "Temporary-style email samples are ready.",
          left: <GenericPanel title="Name">Test user</GenericPanel>,
          right: <GenericPanel title="Result"><TextListResult items={result} /><div className="mt-4"><CopyRow value={result.join("\n")} onCopied={() => setCopyValue(result.join("\n"))} /></div></GenericPanel>,
        };
      }
      case "uuid-generator": {
        const result = makeUUIDs(6);
        return {
          headline: "UUIDs are ready",
          summary: "Developer-safe UUID values are ready to copy.",
          left: <GenericPanel title="Count">6</GenericPanel>,
          right: <GenericPanel title="Result"><TextListResult items={result} /><div className="mt-4"><CopyRow value={result.join("\n")} onCopied={() => setCopyValue(result.join("\n"))} /></div></GenericPanel>,
        };
      }
      case "barcode-generator": {
        const svg = makeBarcodeSvg("1234567890");
        return {
          headline: "Barcode is ready",
          summary: "A simple barcode preview is ready.",
          left: <GenericPanel title="Value">1234567890</GenericPanel>,
          right: <GenericPanel title="Preview"><img src={svg} alt="Barcode preview" className="w-full rounded-2xl border border-neutral-100 bg-white p-3" /><div className="mt-4 flex gap-2"><button type="button" onClick={() => downloadText(svg, "barcode.svg", "image/svg+xml")} className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700"><Download className="h-3.5 w-3.5" />Download SVG</button><CopyRow value={svg} onCopied={() => setCopyValue(svg)} /></div></GenericPanel>,
        };
      }
      case "word-cloud-generator": {
        const result = makeWordCloudWords("build, launch, design, ship, iterate, test, refine");
        return {
          headline: "Word cloud is ready",
          summary: "A quick word cloud preview is ready.",
          left: <GenericPanel title="Words">build, launch, design, ship, iterate, test, refine</GenericPanel>,
          right: <GenericPanel title="Result"><div className="flex flex-wrap gap-3 rounded-3xl border border-neutral-200 bg-neutral-50 p-5">{result.map((item) => <span key={`${item.word}-${item.size}`} style={{ fontSize: `${item.size}px` }} className="font-semibold text-neutral-900">{item.word}</span>)}</div><div className="mt-4"><CopyRow value={result.map((item) => item.word).join(", ")} onCopied={() => setCopyValue(result.map((item) => item.word).join(", "))} /></div></GenericPanel>,
        };
      }
      case "title-generator": {
        const result = makeTitleIdeas(tool.keyword);
        return {
          headline: "Title ideas are ready",
          summary: "A quick set of title ideas is ready.",
          left: <GenericPanel title="Topic">{tool.keyword}</GenericPanel>,
          right: <GenericPanel title="Result"><TextListResult items={result} /><div className="mt-4"><CopyRow value={result.join("\n")} onCopied={() => setCopyValue(result.join("\n"))} /></div></GenericPanel>,
        };
      }
      case "acronym-generator": {
        const result = makeAcronyms("simple app builder", 4);
        return {
          headline: "Acronyms are ready",
          summary: "Short acronym options are ready.",
          left: <GenericPanel title="Phrase">Simple app builder</GenericPanel>,
          right: <GenericPanel title="Result"><TextListResult items={result} /><div className="mt-4"><CopyRow value={result.join("\n")} onCopied={() => setCopyValue(result.join("\n"))} /></div></GenericPanel>,
        };
      }
      case "ascii-art-generator": {
        const result = `┌────────────────────┐\n│      KLONER        │\n└────────────────────┘`;
        return {
          headline: "ASCII art is ready",
          summary: "A quick banner is ready to copy.",
          left: <GenericPanel title="Text">KLONER</GenericPanel>,
          right: <GenericPanel title="Result"><pre className="overflow-auto rounded-2xl border border-neutral-200 bg-neutral-950 p-4 font-mono text-sm leading-6 text-neutral-100">{result}</pre><div className="mt-4"><CopyRow value={result} onCopied={() => setCopyValue(result)} /></div></GenericPanel>,
        };
      }
      case "plot-generator": {
        const result = makePlotIdeas("launching a product");
        const copyValueText = [
          `Topic: ${result.topic}`,
          `Logline: ${result.logline}`,
          `Premise: ${result.premise}`,
          `Protagonist: ${result.protagonist}`,
          `Setting: ${result.setting}`,
          `Obstacle: ${result.obstacle}`,
          `Stakes: ${result.stakes}`,
          `Beats:`,
          ...result.beats.map((beat, index) => `${index + 1}. ${beat}`),
        ].join("\n");
        return {
          headline: "Plot package is ready",
          summary: "A richer story outline with beats, stakes, and title ideas is ready to copy.",
          left: <GenericPanel title="Topic">Launching a product</GenericPanel>,
          right: <GenericPanel title="Result"><TextListResult items={[result.logline, result.premise, result.stakes, ...result.titleIdeas]} /><div className="mt-4"><CopyRow value={copyValueText} onCopied={() => setCopyValue(copyValueText)} /></div></GenericPanel>,
        };
      }
      case "anagram-generator": {
        const result = makeAnagrams("kloner", 4);
        return {
          headline: "Anagrams are ready",
          summary: "A quick anagram set is ready.",
          left: <GenericPanel title="Seed">Kloner</GenericPanel>,
          right: <GenericPanel title="Result"><TextListResult items={result} /><div className="mt-4"><CopyRow value={result.join("\n")} onCopied={() => setCopyValue(result.join("\n"))} /></div></GenericPanel>,
        };
      }
      case "phone-number-generator": {
        const result = Array.from({ length: 6 }, () => `${100 + randomInt(900)}-${100 + randomInt(900)}-${1000 + randomInt(9000)}`);
        return {
          headline: "Phone numbers are ready",
          summary: "Sample phone numbers are ready to copy.",
          left: <GenericPanel title="Count">6</GenericPanel>,
          right: <GenericPanel title="Result"><TextListResult items={result} /><div className="mt-4"><CopyRow value={result.join("\n")} onCopied={() => setCopyValue(result.join("\n"))} /></div></GenericPanel>,
        };
      }
      default: {
        return {
          headline: `${slugLabel(tool.slug)} is ready`,
          summary: tool.description,
          left: <GenericPanel title="Tool">{tool.h1}</GenericPanel>,
          right: <GenericPanel title="Preview"><p className="text-sm leading-6 text-neutral-700">{tool.intro}</p></GenericPanel>,
        };
      }
    }
  }, [tool]);

  return (
    <ToolShell tool={tool} headline={content.headline} summary={content.summary} left={content.left} right={content.right} />
  );
}

export function GeneratedToolClient({ tool }: { tool: ToolConfig }) {
  return <RenderGeneratedTool tool={tool} />;
}