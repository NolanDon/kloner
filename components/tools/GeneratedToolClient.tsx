"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Copy, Download, X } from "lucide-react";
import type { ToolConfig } from "./toolRegistry";
import SuccessConfetti from "./SuccessConfetti";

type CopyFeedbackValue = {
  copied: boolean;
  setCopied: (value: boolean) => void;
  nextStepHighlighted: boolean;
  setNextStepHighlighted: (value: boolean) => void;
  copyValue: string | null;
  setCopyValue: (value: string | null) => void;
  inPromoModal: boolean;
  announceSuccess: (title: string, message: string) => void;
};

const CopyFeedbackContext = createContext<CopyFeedbackValue | null>(null);

let announceToolSuccess: ((title: string, message: string) => void) | null = null;

function notifyToolSuccess(title: string, message: string) {
  announceToolSuccess?.(title, message);
}

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

function capitalizeSentence(value: string) {
  const text = value.trim();
  if (!text) return "";
  return text[0]!.toUpperCase() + text.slice(1);
}

function randomFrom<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)]!;
}

function randomInt(max: number) {
  return Math.floor(Math.random() * Math.max(1, max));
}

const WORD_THEMES: Record<string, string[]> = {
  neutral: ["focus", "signal", "launch", "build", "simple", "clear", "ready", "fast", "sharp", "flow", "pulse", "stack", "frame", "draft", "logic", "native", "cloud", "stable", "plain", "steady"],
  creative: ["spark", "drift", "pixel", "orbit", "vibe", "sketch", "stitch", "prism", "pulse", "nova", "glow", "ripple", "canvas", "story", "muse", "ribbon", "echo", "color", "verse", "tempo"],
  nature: ["river", "cedar", "stone", "meadow", "forest", "cloud", "reef", "bloom", "dune", "rain", "pine", "willow", "brook", "petal", "ridge", "harbor", "moss", "pebble", "field", "hollow"],
  tech: ["binary", "vector", "stack", "module", "kernel", "render", "signal", "compile", "cache", "server", "bridge", "thread", "pixel", "stream", "socket", "native", "query", "cloud", "logic", "system"],
  brand: ["nova", "atlas", "lumen", "orbit", "acorn", "ember", "signal", "verge", "drift", "forge", "anchor", "pilot", "cinder", "harbor", "rally", "nexus", "drizzle", "foundry", "bloom", "prism"],
};

const WORD_PREFIXES = ["mini", "neo", "ultra", "hyper", "prime", "north", "bright", "quick", "fresh", "pixel", "clear", "motion"];
const WORD_SUFFIXES = ["lab", "flow", "grid", "forge", "studio", "pulse", "shift", "works", "kit", "mode", "path", "house"];
const HEADLINE_TONES = {
  direct: [
    "How to build {subject} without friction",
    "A faster way to ship {subject}",
    "The practical guide to {subject}",
    "What most teams miss about {subject}",
    "Turn {subject} into a clean result",
    "Make {subject} easier to launch",
  ],
  bold: [
    "{subject} deserves a better workflow",
    "The fastest path to {subject}",
    "Why {subject} works when it stays simple",
    "{subject}: built to move faster",
    "Ship {subject} with less overhead",
    "{subject} without the usual drag",
  ],
  playful: [
    "A sharper way to make {subject} happen",
    "{subject} is about to get interesting",
    "Big results from a small {subject} setup",
    "{subject}, but make it easier",
    "Say less, build more with {subject}",
    "The nicer way to work on {subject}",
  ],
};

function makeRandomNumbers(count: number, min: number, max: number) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const range = Math.max(1, high - low + 1);
  return Array.from({ length: count }, () => low + randomInt(range));
}

function makeRandomWords(count: number, theme: string) {
  const pool = WORD_THEMES[theme] ?? WORD_THEMES.neutral;

  const variants = new Set<string>();
  while (variants.size < Math.max(1, count)) {
    const base = randomFrom(pool);
    const mode = randomInt(4);

    if (mode === 0) {
      variants.add(base);
    } else if (mode === 1) {
      variants.add(`${randomFrom(WORD_PREFIXES)} ${base}`);
    } else if (mode === 2) {
      variants.add(`${base} ${randomFrom(WORD_SUFFIXES)}`);
    } else {
      variants.add(`${randomFrom(WORD_PREFIXES)} ${base} ${randomFrom(WORD_SUFFIXES)}`);
    }
  }

  return Array.from(variants).slice(0, count);
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

function makeColorSchemes(seed: string, count: number) {
  return Array.from({ length: Math.max(1, count) }, (_, index) => makePalette(`${seed}-${index}`));
}

function makeHeadlines(seed: string, count: number) {
  const subject = seed.trim() || "this";
  const tones = [HEADLINE_TONES.direct, HEADLINE_TONES.bold, HEADLINE_TONES.playful];
  const headlines = Array.from({ length: Math.max(1, count) }, (_, index) => {
    const tone = tones[index % tones.length]!;
    return tone[index % tone.length]!.replaceAll("{subject}", subject);
  });
  return headlines.slice(0, count);
}

function makeTitleIdeas(seed: string, count = 6) {
  const subject = capitalizeSentence(seed.trim() || "Idea");
  return [
    `${subject} made simple`,
    `The ${subject} guide`,
    `Building better ${subject.toLowerCase()}`,
    `A cleaner way to handle ${subject.toLowerCase()}`,
    `${subject}: a practical playbook`,
    `Fast notes for ${subject.toLowerCase()}`,
  ].slice(0, count);
}

function makeTheses(seed: string, count: number) {
  const subject = seed.trim() || "technology";
  return [
    `${subject} works best when it reduces friction instead of adding more steps.`,
    `Teams get better outcomes from ${subject} when the process stays visible and simple.`,
    `${subject} succeeds when people can understand the next move without extra explanation.`,
  ].slice(0, count);
}

function makeRestaurantNames(seed: string, count: number) {
  const subject = capitalizeSentence(seed.trim() || "North");
  return [
    `${subject} Kitchen`,
    `The ${subject} Table`,
    `${subject} Bistro`,
    `${subject} House`,
    `${subject} Diner`,
    `${subject} Market`,
  ].slice(0, count);
}

function makeRandomLetters(count: number) {
  return Array.from({ length: Math.max(1, count) }, (_, index) => String.fromCharCode(65 + (index * 7 + randomInt(26)) % 26));
}

function makeAnimals(count: number) {
  const animals = ["fox", "wolf", "otter", "falcon", "lynx", "badger", "panda", "koala", "hare", "heron", "tiger", "whale"];
  return Array.from({ length: Math.max(1, count) }, (_, index) => animals[index % animals.length]!);
}

function makeCities(count: number, seed: string) {
  const base = capitalizeSentence(seed.trim() || "North");
  return [
    `${base} City`,
    `New ${base}`,
    `${base} Bay`,
    `${base} Harbor`,
    `${base} Springs`,
    `${base} Point`,
    `${base} Falls`,
    `${base} Heights`,
  ].slice(0, count);
}

function makeCountries(count: number, seed: string) {
  const base = capitalizeSentence(seed.trim() || "Aurora");
  return [
    `Republic of ${base}`,
    `${base} Federation`,
    `United ${base}`,
    `${base} Coast`,
    `${base} Isles`,
    `${base} Dominion`,
    `${base} Union`,
    `${base} Kingdom`,
  ].slice(0, count);
}

function makeFantasyNames(count: number, seed: string) {
  const base = capitalizeSentence(seed.trim() || "ember");
  return [
    `${base} Vale`,
    `Lyra ${base}`,
    `${base} Thorn`,
    `Mira ${base}`,
    `${base} Night`,
    `Alden ${base}`,
    `${base} Wren`,
    `Seren ${base}`,
  ].slice(0, count);
}

function makeSuperheroNames(count: number, seed: string) {
  const base = capitalizeSentence(seed.trim() || "Nova");
  return [
    `Captain ${base}`,
    `${base} Force`,
    `The ${base}`,
    `${base} Vanguard`,
    `Agent ${base}`,
    `${base} Prime`,
    `${base} Storm`,
    `${base} Shield`,
  ].slice(0, count);
}

function makeRhymes(seed: string, count: number) {
  const base = seed.trim().toLowerCase() || "light";
  const ending = base.slice(-3);
  const rhymeMap: Record<string, string[]> = {
    ight: ["bright", "flight", "night", "sight", "might", "light"],
    ay: ["day", "play", "stay", "way", "bray", "array"],
    ee: ["free", "tree", "see", "bee", "glee", "knee"],
    ow: ["glow", "flow", "show", "slow", "grow", "snow"],
    ake: ["make", "bake", "shake", "lake", "wake", "stake"],
    ine: ["shine", "line", "brine", "twine", "mine", "vine"],
    ore: ["more", "shore", "glore", "roar", "core", "before"],
  };
  const bucket = rhymeMap[ending] ?? rhymeMap[base.slice(-2)] ?? ["bright", "light", "night", "flight", "moonlight"];
  return Array.from({ length: Math.max(1, count) }, (_, index) => bucket[index % bucket.length]!);
}

function makeBingoCard(wordsInput: string[]) {
  const words = wordsInput.map((word) => word.trim()).filter(Boolean);
  const pool = words.length ? words : makeRandomWords(24, "creative");
  const shuffled = [...pool];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  const cells = Array.from({ length: 24 }, (_, index) => shuffled[index % shuffled.length]!);
  cells.splice(12, 0, "FREE");
  return cells.slice(0, 25);
}

function makeTruthTable(operation: string) {
  const combos = [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ] as const;

  const evaluate = (left: number, right: number) => {
    const a = Boolean(left);
    const b = Boolean(right);

    switch (operation) {
      case "OR":
        return a || b;
      case "XOR":
        return a !== b;
      case "NAND":
        return !(a && b);
      case "NOR":
        return !(a || b);
      case "IMPLIES":
        return !a || b;
      default:
        return a && b;
    }
  };

  return ["A | B | RESULT", ...combos.map(([left, right]) => `${left} | ${right} | ${evaluate(left, right) ? 1 : 0}`)];
}

function makeRandomRows(count: number) {
  const names = ["Ava", "Noah", "Mila", "Leo", "Zoe", "Ethan", "Maya", "Theo", "Ivy", "Owen"];
  const roles = ["Designer", "Engineer", "Writer", "Analyst", "Founder", "Manager", "Producer", "Researcher"];
  const domains = ["example.com", "kloner.app", "mail.test", "inbox.dev"];

  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    const name = `${names[index % names.length]} ${String.fromCharCode(65 + (index % 26))}.`;
    const role = roles[index % roles.length]!;
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/\.+/g, ".").replace(/^\.|\.$/g, "")}.${index + 1}@${domains[index % domains.length]}`;
    return `${name} | ${role} | ${email}`;
  });
}

function makeUniqueRandomNumbers(count: number, min: number, max: number) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const values = Array.from({ length: high - low + 1 }, (_, index) => low + index);

  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [values[index], values[swapIndex]] = [values[swapIndex]!, values[index]!];
  }

  return values.slice(0, Math.min(Math.max(1, count), values.length));
}

function makeRandomWordsToolCopy(theme: string, count: number) {
  return makeRandomWords(count, theme).join(", ");
}

function makeFaviconSvg(options: { label: string; background: string; foreground: string; shape: "square" | "rounded" | "circle" }) {
  const label = options.label.trim().slice(0, 2).toUpperCase() || "K";
  const radius = options.shape === "circle" ? "9999" : options.shape === "rounded" ? "28" : "8";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="${radius}" ry="${radius}" fill="${options.background}" />
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="220" font-weight="700" fill="${options.foreground}">${label}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.trim())}`;
}

function makePlotIdeas(seed: string) {
  const topic = seed.trim() || "launching a product";
  const titleIdeas = makeTitleIdeas(topic, 3);
  return {
    topic,
    logline: `A focused team races to solve ${topic} before the window closes.`,
    premise: `The story follows the pressure, tradeoffs, and small wins that come with ${topic}.`,
    protagonist: `A practical builder trying to keep ${topic} moving forward.`,
    setting: `A fast-moving world where deadlines keep shifting around ${topic}.`,
    obstacle: `Hidden friction keeps pushing ${topic} off course.`,
    stakes: `If ${topic} fails, the team loses more than momentum.`,
    beats: [
      `A clear goal is set for ${topic}.`,
      `The plan hits a hidden problem.`,
      `A better approach emerges under pressure.`,
      `The team finds a way to finish strong.`,
    ],
    titleIdeas,
  };
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
  return expanded.flatMap((word, index) => [
    { word, size: 34 - index * 3 },
    { word: `${word} ideas`, size: 22 - index * 2 },
    { word: `${word} launch`, size: 20 - index * 2 },
    { word: `${word} design`, size: 18 - index },
  ]).slice(0, 8);
}

function makeFancyTextVariants(text: string) {
  const base = text.trim() || "Kloner";
  return [
    base,
    base.toUpperCase(),
    base.toLowerCase(),
    base.split("").map((char) => `${char}͟`).join(""),
    base.split("").map((char) => `${char}⃒`).join(""),
    base.replace(/[a-z]/gi, (char) => char === char.toUpperCase() ? char : char.toUpperCase()),
  ];
}

function makeGlitchTextVariants(text: string) {
  const base = text.trim() || "KLONER";
  return [
    base.split("").map((char, index) => `${char}${index % 2 === 0 ? "̷" : "̸"}`).join(""),
    `█ ${base} █`,
    base.replace(/./g, (char, index) => (index % 3 === 0 ? `${char}█` : char)),
  ];
}

function makeMlaCitation(author: string, title: string, source: string, year: string) {
  const parts = [author.trim(), `"${title.trim()}"`, source.trim(), year.trim()].filter(Boolean);
  return `${parts[0] || "Unknown"}. ${parts[1] || "Untitled."} ${parts[2] || "Web."} ${parts[3] || "n.d."}.`;
}

function makeBusinessNiches(seed: string, count: number) {
  const subject = seed.trim() || "apps";
  return [
    `Small ${subject} for busy teams`,
    `AI tools for ${subject} workflows`,
    `Local-first ${subject} for creators`,
    `A lightweight dashboard for ${subject}`,
    `A fast browser tool for ${subject}`,
    `A niche service around ${subject}`,
  ].slice(0, count);
}

function makeProductNames(seed: string, count: number) {
  const subject = capitalizeSentence(seed.trim() || "Product");
  return [`${subject} Flow`, `${subject} Studio`, `${subject} Kit`, `${subject} Spark`, `${subject} Lab`, `${subject} Pro`].slice(0, count);
}

function makeSecretSantaPairs(namesInput: string[]) {
  const names = namesInput.map((name) => name.trim()).filter(Boolean);

  if (names.length < 2) {
    return names;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const shuffled = [...names];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
    }

    if (shuffled.every((recipient, index) => recipient !== names[index])) {
      return names.map((name, index) => `${name} -> ${shuffled[index]}`);
    }
  }

  const rotated = [...names.slice(1), names[0]];
  return names.map((name, index) => `${name} -> ${rotated[index]}`);
}

function makeStartupIdeas(seed: string, count: number) {
  const subject = seed.trim() || "a new app";
  return [
    `A browser tool that makes ${subject} faster to launch`,
    `A lightweight platform for ${subject} teams`,
    `A simple workflow app for ${subject}`,
    `A creator-first product around ${subject}`,
    `A focused SaaS that solves ${subject}`,
  ].slice(0, count);
}

function makeStoryPrompts(seed: string, count: number) {
  const subject = seed.trim() || "a small decision";
  return [
    `A character has to make ${subject} before sunrise.`,
    `The wrong message changes ${subject} forever.`,
    `Someone discovers ${subject} is not what it seems.`,
    `A plan built around ${subject} starts to fail.`,
  ].slice(0, count);
}

function makePlotTwists(seed: string, count: number) {
  const subject = seed.trim() || "the mission";
  return [
    `The ally everyone trusts is the reason ${subject} fails.`,
    `The win turns out to be a trap inside ${subject}.`,
    `The biggest obstacle is actually the hidden goal of ${subject}.`,
    `The plan works, but only for the wrong person in ${subject}.`,
  ].slice(0, count);
}

function makeWordMixes(seed: string, count: number) {
  const parts = seed.split(/[\s,/|-]+/).map((part) => part.trim()).filter(Boolean);
  const [a = "flow", b = "spark"] = parts;
  return [
    `${a.slice(0, 3)}${b.slice(0, 3)}`,
    `${a.slice(0, 4)}${b.slice(-3)}`,
    `${b.slice(0, 2)}${a.slice(0, 4)}`,
    `${a}${b.slice(0, 2)}`,
  ].slice(0, count);
}

function makeSequences(start: number, step: number, count: number) {
  return Array.from({ length: count }, (_, index) => String(start + step * index));
}

function makeIconLabels(seed: string, count: number) {
  const subject = capitalizeSentence(seed.trim() || "Icon");
  return [`${subject}`, `${subject} Pro`, `${subject} Lite`, `${subject} Hub`, `${subject} Go`, `${subject} Plus`].slice(0, count);
}

function makeCharacterNames(seed: string, count: number) {
  const subject = seed.trim() || "Ash";
  return [
    `${capitalizeSentence(subject)} Vale`,
    `Nova ${capitalizeSentence(subject)}`,
    `${capitalizeSentence(subject)} Ember`,
    `Mara ${capitalizeSentence(subject)}`,
    `Rune ${capitalizeSentence(subject)}`,
  ].slice(0, count);
}

function makeTeamNames(seed: string, count: number) {
  const subject = capitalizeSentence(seed.trim() || "Team");
  return [`${subject} Crew`, `${subject} Force`, `${subject} Squad`, `${subject} Union`, `${subject} Collective`, `${subject} Signal`].slice(0, count);
}

function makePromptStarters(seed: string, count: number) {
  const subject = seed.trim() || "the task";
  return [
    `Help me plan ${subject} with clear next steps.`,
    `Create a concise strategy for ${subject}.`,
    `Turn ${subject} into a simple action plan.`,
    `Suggest three better ways to approach ${subject}.`,
  ].slice(0, count);
}

function makeTaglines(seed: string, count: number) {
  const subject = capitalizeSentence(seed.trim() || "Kloner");
  return [
    `${subject} makes the next step obvious.`,
    `Built to move ideas forward.`,
    `Fast tools for focused work.`,
    `A cleaner way to ship.`,
  ].slice(0, count);
}

type ListToolShellProps = {
  tool: ToolConfig;
  headline: string;
  summary: string;
  seedLabel: string;
  seedPlaceholder: string;
  defaultSeed: string;
  countLabel?: string;
  defaultCount?: number;
  minCount?: number;
  maxCount?: number;
  actionLabel?: string;
  resultLabel?: string;
  generate: (seed: string, count: number) => string[];
  renderItem?: (value: string) => ReactNode;
  previewCopyJoiner?: string;
};

function ListToolShell({
  tool,
  headline,
  summary,
  seedLabel,
  seedPlaceholder,
  defaultSeed,
  countLabel = "Count",
  defaultCount = 6,
  minCount = 3,
  maxCount = 120,
  actionLabel = "Generate",
  resultLabel = "Results",
  generate,
  renderItem,
  previewCopyJoiner = "\n",
}: ListToolShellProps) {
  const [seed, setSeed] = useState(defaultSeed);
  const [count, setCount] = useState(defaultCount);
  const [results, setResults] = useState<string[]>(() => generate(defaultSeed, defaultCount));

  useEffect(() => {
    setResults(generate(seed, count));
  }, [count, seed]);

  const copyValue = results.join(previewCopyJoiner);

  return (
    <ToolShell
      tool={tool}
      headline={headline}
      summary={summary}
      left={
        <div className="space-y-4">
          <GenericPanel title="Controls">
            <div className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-neutral-700">{seedLabel}</span>
                <input value={seed} onChange={(event) => setSeed(event.target.value)} placeholder={seedPlaceholder} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-neutral-700">{countLabel}</span>
                <input value={count} onChange={(event) => setCount(Math.max(minCount, Math.min(maxCount, Number(event.target.value))))} type="number" min={minCount} max={maxCount} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" />
              </label>
              <button
                type="button"
                onClick={() => {
                  setResults(generate(seed, count));
                  notifyToolSuccess(headline, summary);
                }}
                className="rounded-full bg-[#FF8D21] px-4 py-2 text-sm font-medium text-white"
              >
                {actionLabel}
              </button>
            </div>
          </GenericPanel>
          <GenericPanel title="Quick Copy">
            <p className="text-sm leading-6 text-neutral-700">Generate a new batch, then copy individual items or the full set.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <CopyRow value={copyValue} />
            </div>
          </GenericPanel>
        </div>
      }
      right={
        <GenericPanel title={resultLabel}>
          <div className="grid gap-2">
            {results.map((item) => (
              <button key={item} type="button" onClick={async () => copyToClipboard(item)} className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-left text-sm text-neutral-800 transition hover:border-[#FF8D21] hover:bg-white">
                {renderItem ? renderItem(item) : item}
              </button>
            ))}
          </div>
        </GenericPanel>
      }
    />
  );
}

function PreformattedToolShell({ tool, headline, summary, seedLabel, defaultSeed, generator, actionLabel = "Generate" }: { tool: ToolConfig; headline: string; summary: string; seedLabel: string; defaultSeed: string; generator: (seed: string) => string[]; actionLabel?: string; }) {
  const [seed, setSeed] = useState(defaultSeed);
  const [results, setResults] = useState<string[]>(() => generator(defaultSeed));

  useEffect(() => {
    setResults(generator(seed));
  }, [seed]);

  const copyValue = results.join("\n");

  return (
    <ToolShell
      tool={tool}
      headline={headline}
      summary={summary}
      left={
        <GenericPanel title="Control">
          <div className="space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-neutral-700">{seedLabel}</span>
              <input value={seed} onChange={(event) => setSeed(event.target.value)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" />
            </label>
            <button
              type="button"
              onClick={() => {
                setResults(generator(seed));
                notifyToolSuccess(headline, summary);
              }}
              className="rounded-full bg-[#FF8D21] px-4 py-2 text-sm font-medium text-white"
            >
              {actionLabel}
            </button>
          </div>
        </GenericPanel>
      }
      right={
        <GenericPanel title="Result">
          <pre className="overflow-auto rounded-2xl border border-neutral-200 bg-neutral-950 p-4 font-mono text-sm leading-6 text-neutral-100">{results.join("\n")}</pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <CopyRow value={copyValue} />
          </div>
        </GenericPanel>
      }
    />
  );
}

function SecretSantaTool({ tool }: { tool: ToolConfig }) {
  const [namesText, setNamesText] = useState("Ava\nNoah\nMila\nLeo\nZoe\nEthan");
  const [pairs, setPairs] = useState<string[]>(() => makeSecretSantaPairs(namesText.split(/\n+/)));

  const names = namesText.split(/\n+/).map((name) => name.trim()).filter(Boolean);

  return (
    <ToolShell
      tool={tool}
      headline="Secret Santa pairings are ready"
      summary="Paste names, generate pairings, and copy the list for your group."
      left={
        <GenericPanel title="Participants">
          <div className="space-y-4">
            <textarea value={namesText} onChange={(event) => setNamesText(event.target.value)} rows={10} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" />
            <button type="button" onClick={() => setPairs(makeSecretSantaPairs(namesText.split(/\n+/)))} className="rounded-full bg-[#FF8D21] px-4 py-2 text-sm font-medium text-white">Generate pairings</button>
            <CopyRow value={pairs.join("\n")} />
          </div>
        </GenericPanel>
      }
      right={
        <GenericPanel title="Pairings">
          {names.length < 2 ? (
            <p className="text-sm text-neutral-600">Add at least two names to create a pairing list.</p>
          ) : (
            <div className="grid gap-2">
              {pairs.map((pair) => (
                <div key={pair} className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-800">{pair}</div>
              ))}
            </div>
          )}
        </GenericPanel>
      }
    />
  );
}

function BingoCardTool({ tool }: { tool: ToolConfig }) {
  const [wordsText, setWordsText] = useState("launch\ndesign\ncopy\nfeedback\ndebug\nship\niterate\nfocus\nbuild\nshare\nplan\nreview\nmeet\nwrite\ncode\ncoffee\nasync\nwallet\nlayout\nmobile\napi\nship fast\nclean UI\nnew idea");
  const [card, setCard] = useState<string[]>(() => makeBingoCard(wordsText.split(/\n+/)));

  return (
    <ToolShell
      tool={tool}
      headline="Bingo card is ready"
      summary="Turn a list of words into a simple 5x5 card with a free center square."
      left={
        <GenericPanel title="Word Bank">
          <div className="space-y-4">
            <textarea value={wordsText} onChange={(event) => setWordsText(event.target.value)} rows={12} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" />
            <button type="button" onClick={() => setCard(makeBingoCard(wordsText.split(/\n+/)))} className="rounded-full bg-[#FF8D21] px-4 py-2 text-sm font-medium text-white">Generate card</button>
            <CopyRow value={card.join("\n")} />
          </div>
        </GenericPanel>
      }
      right={
        <GenericPanel title="Card">
          <div className="grid grid-cols-5 gap-2">
            {card.map((item, index) => (
              <div key={`${item}-${index}`} className={`flex min-h-[4.5rem] items-center justify-center rounded-2xl border px-3 py-3 text-center text-xs font-medium uppercase tracking-[0.12em] ${item === "FREE" ? "border-[#FF8D21] bg-[#fff4ef] text-[#FF8D21]" : "border-neutral-200 bg-neutral-50 text-neutral-800"}`}>
                {item}
              </div>
            ))}
          </div>
        </GenericPanel>
      }
    />
  );
}

function TruthTableTool({ tool }: { tool: ToolConfig }) {
  const [operation, setOperation] = useState("AND");
  const rows = makeTruthTable(operation);

  return (
    <ToolShell
      tool={tool}
      headline="Truth table is ready"
      summary="Switch between common boolean operations and copy the results." 
      left={
        <GenericPanel title="Operation">
          <div className="space-y-4">
            <select value={operation} onChange={(event) => setOperation(event.target.value)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]">
              <option value="AND">AND</option>
              <option value="OR">OR</option>
              <option value="XOR">XOR</option>
              <option value="NAND">NAND</option>
              <option value="NOR">NOR</option>
              <option value="IMPLIES">IMPLIES</option>
            </select>
            <CopyRow value={rows.join("\n")} />
          </div>
        </GenericPanel>
      }
      right={
        <GenericPanel title="Table">
          <div className="grid gap-2">
            {rows.map((row) => (
              <div key={row} className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 font-mono text-sm text-neutral-800">{row}</div>
            ))}
          </div>
        </GenericPanel>
      }
    />
  );
}

function FakeDataTool({ tool }: { tool: ToolConfig }) {
  const [count, setCount] = useState(8);
  const [rows, setRows] = useState<string[]>(() => makeRandomRows(8));

  return (
    <ToolShell
      tool={tool}
      headline="Mock data is ready"
      summary="Generate quick placeholder rows for testing tables, forms, and dashboards."
      left={
        <GenericPanel title="Controls">
          <div className="space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-neutral-700">Rows</span>
              <input type="number" min={3} max={20} value={count} onChange={(event) => setCount(Math.max(3, Math.min(20, Number(event.target.value))))} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" />
            </label>
            <button type="button" onClick={() => setRows(makeRandomRows(count))} className="rounded-full bg-[#FF8D21] px-4 py-2 text-sm font-medium text-white">Generate data</button>
            <CopyRow value={rows.join("\n")} />
          </div>
        </GenericPanel>
      }
      right={
        <GenericPanel title="Rows">
          <div className="overflow-auto rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-[0.16em] text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Email</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const [name, role, email] = row.split(" | ");
                  return (
                    <tr key={row} className="border-t border-neutral-200">
                      <td className="px-4 py-3 text-neutral-900">{name}</td>
                      <td className="px-4 py-3 text-neutral-700">{role}</td>
                      <td className="px-4 py-3 font-mono text-xs text-neutral-700">{email}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </GenericPanel>
      }
    />
  );
}

function MlaCitationTool({ tool }: { tool: ToolConfig }) {
  const [author, setAuthor] = useState("Copilot, GitHub");
  const [title, setTitle] = useState("Building faster browser tools");
  const [source, setSource] = useState("kloner.app");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const citation = makeMlaCitation(author, title, source, year);

  return (
    <ToolShell
      tool={tool}
      headline="MLA citation is ready"
      summary="Fill the source details, then copy the citation line into your notes."
      left={
        <GenericPanel title="Fields">
          <div className="space-y-3">
            {[{ label: "Author", value: author, set: setAuthor }, { label: "Title", value: title, set: setTitle }, { label: "Source", value: source, set: setSource }, { label: "Year", value: year, set: setYear }].map((field) => (
              <label key={field.label} className="block space-y-2">
                <span className="text-sm font-medium text-neutral-700">{field.label}</span>
                <input value={field.value} onChange={(event) => field.set(event.target.value)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" />
              </label>
            ))}
            <CopyRow value={citation} />
          </div>
        </GenericPanel>
      }
      right={
        <GenericPanel title="Citation">
          <pre className="whitespace-pre-wrap rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-7 text-neutral-800">{citation}</pre>
        </GenericPanel>
      }
    />
  );
}

function SequenceTool({ tool }: { tool: ToolConfig }) {
  const [start, setStart] = useState(1);
  const [step, setStep] = useState(2);
  const [count, setCount] = useState(12);
  const results = makeSequences(start, step, count);

  return (
    <ToolShell
      tool={tool}
      headline="Sequence is ready"
      summary="Generate a simple numeric run with start, step, and count controls."
      left={
        <GenericPanel title="Controls">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-2"><span className="text-sm font-medium text-neutral-700">Start</span><input type="number" value={start} onChange={(event) => setStart(Number(event.target.value))} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" /></label>
            <label className="block space-y-2"><span className="text-sm font-medium text-neutral-700">Step</span><input type="number" value={step} onChange={(event) => setStep(Number(event.target.value))} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" /></label>
            <label className="block space-y-2"><span className="text-sm font-medium text-neutral-700">Count</span><input type="number" min={3} max={30} value={count} onChange={(event) => setCount(Math.max(3, Math.min(30, Number(event.target.value))))} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" /></label>
          </div>
          <div className="mt-4"><CopyRow value={results.join(", ")} /></div>
        </GenericPanel>
      }
      right={
        <GenericPanel title="Sequence">
          <div className="flex flex-wrap gap-2">
            {results.map((number) => <span key={number} className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-sm text-neutral-900">{number}</span>)}
          </div>
        </GenericPanel>
      }
    />
  );
}

function TextTransformTool({ tool }: { tool: ToolConfig }) {
  const [text, setText] = useState(tool.keyword);
  const variants = tool.slug === "fancy-text-generator" ? makeFancyTextVariants(text) : makeGlitchTextVariants(text);

  return (
    <ToolShell
      tool={tool}
      headline={tool.slug === "fancy-text-generator" ? "Fancy text is ready" : "Glitch text is ready"}
      summary={tool.slug === "fancy-text-generator" ? "Turn plain text into a few stylized text variations." : "Create a glitched text effect for short phrases."}
      left={<GenericPanel title="Text"><textarea value={text} onChange={(event) => setText(event.target.value)} rows={6} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" /><div className="mt-4"><CopyRow value={variants.join("\n")} /></div></GenericPanel>}
      right={<GenericPanel title="Variants"><div className="grid gap-2">{variants.map((variant) => <div key={variant} className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-800">{variant}</div>)}</div></GenericPanel>}
    />
  );
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
              <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full border border-amber-100 bg-amber-50 text-[#FF8D21] sm:h-12 sm:w-12">
                <CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>

              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#FF8D21] sm:text-xs sm:tracking-[0.24em]">
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
                className="inline-flex w-full min-w-0 items-center justify-center rounded-full bg-[#FF8D21] px-7 py-3.5 text-base font-semibold text-white shadow-[0_16px_36px_rgba(255,141,33,0.24)] transition hover:bg-[#D96E11] hover:shadow-[0_20px_42px_rgba(255,141,33,0.28)] sm:min-w-[200px]"
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
  const [successOpen, setSuccessOpen] = useState(false);
  const [successTitle, setSuccessTitle] = useState(headline);
  const [successMessage, setSuccessMessage] = useState(summary);

  const announceSuccess = (title: string, message: string) => {
    setSuccessTitle(title);
    setSuccessMessage(message);
    setSuccessOpen(true);
  };

  useEffect(() => {
    announceToolSuccess = announceSuccess;
    return () => {
      if (announceToolSuccess === announceSuccess) {
        announceToolSuccess = null;
      }
    };
  }, [announceSuccess]);

  return (
    <CopyFeedbackContext.Provider value={{ copied, setCopied, nextStepHighlighted, setNextStepHighlighted, copyValue, setCopyValue, inPromoModal: false, announceSuccess }}>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr] items-start">
        <ToolPromoModal open={promoOpen} onDismiss={() => setPromoOpen(false)} headline={headline} summary={summary} preview={right} />
        <SuccessConfetti open={successOpen} title={successTitle} message={successMessage} onDismiss={() => setSuccessOpen(false)} />
        <div className="space-y-4">{left}</div>
        <div className="space-y-4">{right}</div>
        <div className="lg:col-span-2 flex justify-end">
          <button type="button" onClick={() => setPromoOpen(true)} className={`rounded-full px-4 py-2 text-sm transition ${nextStepHighlighted ? "bg-[#FF8D21] text-white shadow-[0_16px_36px_rgba(255,141,33,0.24)]" : "border border-neutral-200 text-neutral-700 hover:border-[#FF8D21] hover:text-[#FF8D21]"}`}>
            See next step
          </button>
        </div>
      </div>
    </CopyFeedbackContext.Provider>
  );
}

function CopyRow({ value, onCopied }: { value: string; onCopied?: () => void }) {
  const { copied, setCopied, setNextStepHighlighted, setCopyValue, inPromoModal, announceSuccess } = useCopyFeedback();

  useEffect(() => {
    setCopyValue(value);
    return () => setCopyValue(null);
  }, [setCopyValue, value]);

  if (inPromoModal) {
    return null;
  }

  return (
    <button type="button" onClick={async () => { await copyToClipboard(value); setCopied(true); setNextStepHighlighted(true); announceSuccess("Copied to clipboard", "Your result is ready to paste."); window.setTimeout(() => setCopied(false), 1200); onCopied?.(); }} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm transition ${copied ? "border border-[#FF8D21] bg-[#FF8D21] text-white shadow-[0_12px_28px_rgba(255,141,33,0.18)]" : "border border-neutral-200 bg-white text-neutral-700 hover:border-[#FF8D21] hover:text-[#FF8D21]"}`}>
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

function RandomNumberTool({ tool }: { tool: ToolConfig }) {
  const [min, setMin] = useState(1);
  const [max, setMax] = useState(100);
  const [count, setCount] = useState(24);
  const [unique, setUnique] = useState(true);
  const [results, setResults] = useState<number[]>(() => makeUniqueRandomNumbers(24, 1, 100));

  const regenerate = (nextMin = min, nextMax = max, nextCount = count, nextUnique = unique) => {
    const nextResults = nextUnique ? makeUniqueRandomNumbers(nextCount, nextMin, nextMax) : makeRandomNumbers(nextCount, nextMin, nextMax);
    setResults(nextResults);
    notifyToolSuccess("Random numbers are ready", `${nextResults.length} values generated.`);
  };

  return (
    <ToolShell
      tool={tool}
      headline="Random numbers are ready"
      summary="Generate bigger batches with tighter ranges, uniqueness, and quick presets."
      left={
        <GenericPanel title="Controls">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {[
                { label: "1-10", min: 1, max: 10 },
                { label: "1-100", min: 1, max: 100 },
                { label: "100-999", min: 100, max: 999 },
                { label: "0-50", min: 0, max: 50 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setMin(preset.min);
                    setMax(preset.max);
                    regenerate(preset.min, preset.max, count, unique);
                  }}
                  className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:border-[#FF8D21] hover:text-[#FF8D21]"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-neutral-700">Minimum</span>
                <input value={min} onChange={(event) => setMin(Number(event.target.value))} type="number" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-neutral-700">Maximum</span>
                <input value={max} onChange={(event) => setMax(Number(event.target.value))} type="number" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-neutral-700">Count</span>
                <input value={count} onChange={(event) => setCount(Math.max(1, Math.min(200, Number(event.target.value))))} type="number" min={1} max={200} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" />
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
                <input type="checkbox" checked={unique} onChange={(event) => setUnique(event.target.checked)} className="h-4 w-4 accent-[#FF8D21]" />
                Unique values
              </label>
            </div>

            <button type="button" onClick={() => regenerate()} className="rounded-full bg-[#FF8D21] px-4 py-2 text-sm font-medium text-white">
              Generate numbers
            </button>

            <CopyRow value={results.join(", ")} />
          </div>
        </GenericPanel>
      }
      right={
        <GenericPanel title="Results">
          <div className="grid max-h-[26rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {results.map((number, index) => (
              <span key={`${number}-${index}`} className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 font-mono text-sm text-neutral-900">
                {number}
              </span>
            ))}
          </div>
        </GenericPanel>
      }
    />
  );
}

function RandomWordTool({ tool }: { tool: ToolConfig }) {
  const [theme, setTheme] = useState<keyof typeof WORD_THEMES>("creative");
  const [style, setStyle] = useState<"mixed" | "title" | "upper">("title");
  const [count, setCount] = useState(36);
  const [results, setResults] = useState<string[]>(() => makeRandomWords(36, "creative"));

  const regenerate = (nextTheme = theme, nextStyle = style, nextCount = count) => {
    const nextWords = makeRandomWords(nextCount, nextTheme);
    const formatted = nextWords.map((word) => {
      if (nextStyle === "upper") {
        return word.toUpperCase();
      }

      if (nextStyle === "mixed") {
        return word;
      }

      return capitalizeSentence(word);
    });

    setResults(formatted);
    notifyToolSuccess("Random words are ready", `${formatted.length} ideas generated.`);
  };

  return (
    <ToolShell
      tool={tool}
      headline="Random words are ready"
      summary="Choose a theme, switch the text style, and generate large batches of words or short phrases."
      left={
        <GenericPanel title="Controls">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-neutral-700">Theme</span>
                <select value={theme} onChange={(event) => setTheme(event.target.value as keyof typeof WORD_THEMES)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]">
                  <option value="neutral">Neutral</option>
                  <option value="creative">Creative</option>
                  <option value="nature">Nature</option>
                  <option value="tech">Tech</option>
                  <option value="brand">Brand</option>
                </select>
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-neutral-700">Style</span>
                <select value={style} onChange={(event) => setStyle(event.target.value as "mixed" | "title" | "upper")} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]">
                  <option value="title">Title case</option>
                  <option value="mixed">Mixed phrases</option>
                  <option value="upper">Uppercase</option>
                </select>
              </label>
              <label className="block space-y-2 sm:col-span-2">
                <span className="text-sm font-medium text-neutral-700">Count</span>
                <input value={count} onChange={(event) => setCount(Math.max(1, Math.min(200, Number(event.target.value))))} type="number" min={1} max={200} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]" />
              </label>
            </div>

            <button type="button" onClick={() => regenerate()} className="rounded-full bg-[#FF8D21] px-4 py-2 text-sm font-medium text-white">
              Generate words
            </button>

            <CopyRow value={results.join("\n")} />
          </div>
        </GenericPanel>
      }
      right={
        <GenericPanel title="Results">
          <div className="grid max-h-[26rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {results.map((word, index) => (
              <button
                key={`${word}-${index}`}
                type="button"
                onClick={async () => {
                  await copyToClipboard(word);
                  notifyToolSuccess("Copied word", "The selected idea is ready to paste.");
                }}
                className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-left text-sm text-neutral-800 transition hover:border-[#FF8D21] hover:bg-white"
              >
                {word}
              </button>
            ))}
          </div>
        </GenericPanel>
      }
    />
  );
}

function FaviconGeneratorTool({ tool }: { tool: ToolConfig }) {
  const [label, setLabel] = useState("K");
  const [background, setBackground] = useState("#FF8D21");
  const [foreground, setForeground] = useState("#ffffff");
  const [shape, setShape] = useState<"square" | "rounded" | "circle">("rounded");
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoHeadline, setPromoHeadline] = useState("Favicon generated.");
  const [promoMessage, setPromoMessage] = useState("Your favicon is ready to download.");

  const svg = useMemo(() => makeFaviconSvg({ label, background, foreground, shape }), [background, foreground, label, shape]);
  const displayLabel = label.trim().slice(0, 2).toUpperCase() || "K";
  const previewRadius = shape === "circle" ? "9999px" : shape === "rounded" ? "28px" : "8px";
  const previewSizeClass = displayLabel.length === 1 ? "text-[3.75rem]" : "text-[2.6rem]";

  const promoPreview = (
    <div className="space-y-3">
      <div className="flex items-center justify-center rounded-[1.5rem] border border-neutral-200 bg-neutral-50 p-6">
        <div
          className="flex h-40 w-40 items-center justify-center border border-white/50 shadow-sm"
          style={{ background, color: foreground, borderRadius: previewRadius }}
        >
          <span className={`font-semibold leading-none tracking-[-0.08em] ${previewSizeClass}`}>
            {displayLabel}
          </span>
        </div>
      </div>
      <div className="grid gap-2 text-sm text-neutral-700 sm:grid-cols-2">
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">Label: <span className="font-semibold text-neutral-900">{label.toUpperCase() || "K"}</span></div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-3">Shape: <span className="font-semibold text-neutral-900">{shape}</span></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => downloadText(svg, "favicon.svg", "image/svg+xml")} className="rounded-full bg-[#FF8D21] px-4 py-2 text-sm font-medium text-white">Download SVG</button>
        <button type="button" onClick={async () => { await copyToClipboard(svg); setPromoHeadline("Favicon copied."); setPromoMessage("Your SVG favicon is ready to paste."); setPromoOpen(true); }} className="rounded-full border border-neutral-200 px-4 py-2 text-sm text-neutral-700">Copy SVG</button>
      </div>
    </div>
  );

  return (
    <ToolShell
      tool={tool}
      headline="Favicon is ready"
      summary="Edit the label, colors, and shape to generate a real SVG favicon." 
      left={
        <GenericPanel title="Controls">
          <div className="space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-neutral-700">Label or initials</span>
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value.slice(0, 2))}
                maxLength={2}
                placeholder="K"
                className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm uppercase outline-none focus:border-[#FF8D21]"
              />
              <p className="text-xs leading-5 text-neutral-500">Use 1 or 2 characters. This becomes the visible favicon mark.</p>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-neutral-700">Background</span>
                <input
                  value={background}
                  onChange={(event) => setBackground(event.target.value)}
                  type="color"
                  className="h-12 w-full cursor-pointer rounded-2xl border border-neutral-200 bg-white p-1"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-neutral-700">Foreground</span>
                <input
                  value={foreground}
                  onChange={(event) => setForeground(event.target.value)}
                  type="color"
                  className="h-12 w-full cursor-pointer rounded-2xl border border-neutral-200 bg-white p-1"
                />
              </label>
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-neutral-700">Shape</span>
              <select value={shape} onChange={(event) => setShape(event.target.value as "square" | "rounded" | "circle")} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#FF8D21]">
                <option value="square">Square</option>
                <option value="rounded">Rounded</option>
                <option value="circle">Circle</option>
              </select>
            </label>

            <div className="space-y-2">
              <span className="text-sm font-medium text-neutral-700">Quick presets</span>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "K", background: "#FF8D21", foreground: "#ffffff", shape: "rounded" as const },
                  { label: "KL", background: "#111827", foreground: "#ffffff", shape: "circle" as const },
                  { label: "A", background: "#0f766e", foreground: "#ecfeff", shape: "square" as const },
                  { label: "AI", background: "#1d4ed8", foreground: "#ffffff", shape: "rounded" as const },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setLabel(preset.label);
                      setBackground(preset.background);
                      setForeground(preset.foreground);
                      setShape(preset.shape);
                    }}
                    className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:border-[#FF8D21] hover:text-[#FF8D21]"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setLabel("K");
                  setBackground("#FF8D21");
                  setForeground("#ffffff");
                  setShape("rounded");
                }}
                className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-700"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => {
                  setPromoHeadline("Favicon generated.");
                  setPromoMessage("Your favicon is ready to download.");
                  setPromoOpen(true);
                }}
                className="rounded-full bg-[#FF8D21] px-4 py-2 text-sm font-medium text-white"
              >
                Generate favicon
              </button>
            </div>
          </div>
        </GenericPanel>
      }
      right={
        <GenericPanel title="Preview">
          <div className="space-y-4">
            <div className="flex items-center justify-center rounded-[1.75rem] border border-neutral-200 bg-neutral-50 p-8">
              <div
                className="flex h-64 w-64 items-center justify-center border border-white/60 shadow-[0_18px_40px_rgba(15,23,42,0.10)]"
                style={{ background, color: foreground, borderRadius: previewRadius }}
              >
                <span className={`font-semibold leading-none tracking-[-0.08em] ${displayLabel.length === 1 ? "text-[6.5rem]" : "text-[4.6rem]"}`}>
                  {displayLabel}
                </span>
              </div>
            </div>
            <div className="rounded-[1.25rem] border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">
              <div className="font-medium text-neutral-900">Live preview</div>
              <div className="mt-1">This icon updates as you type, so you can see the final favicon before downloading.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  downloadText(svg, "favicon.svg", "image/svg+xml");
                  setPromoHeadline("Favicon downloaded.");
                  setPromoMessage("Your SVG favicon is ready to use.");
                  setPromoOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700"
              >
                <Download className="h-3.5 w-3.5" />
                Download SVG
              </button>
              <CopyRow
                value={svg}
                onCopied={() => {
                  setPromoHeadline("Favicon copied.");
                  setPromoMessage("Your SVG favicon is ready to paste.");
                }}
              />
            </div>
          </div>
        </GenericPanel>
      }
    />
  );
}

function RenderGeneratedTool({ tool }: { tool: ToolConfig }) {
  if (tool.slug === "random-letter-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Random letters are ready"
        summary="Generate short letter sets for puzzles, placeholders, and quick naming work."
        seedLabel="Alphabet hint"
        seedPlaceholder="letters"
        defaultSeed="letters"
        defaultCount={12}
        maxCount={52}
        actionLabel="Generate letters"
        resultLabel="Letters"
        generate={(_, count) => makeRandomLetters(count)}
      />
    );
  }

  if (tool.slug === "random-animal-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Random animals are ready"
        summary="Create a fast animal list for prompts, games, or themed drafts."
        seedLabel="Theme"
        seedPlaceholder="wild"
        defaultSeed="wild"
        defaultCount={8}
        maxCount={24}
        actionLabel="Generate animals"
        resultLabel="Animals"
        generate={(_, count) => makeAnimals(count)}
      />
    );
  }

  if (tool.slug === "random-city-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Random cities are ready"
        summary="Generate city-style names for mockups, maps, and creative notes."
        seedLabel="Seed"
        seedPlaceholder="north"
        defaultSeed="north"
        defaultCount={8}
        maxCount={60}
        actionLabel="Generate cities"
        resultLabel="Cities"
        generate={(seed, count) => makeCities(count, seed)}
      />
    );
  }

  if (tool.slug === "random-country-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Random countries are ready"
        summary="Create quick country lists for quizzes, forms, and sample content."
        seedLabel="Context"
        seedPlaceholder="world"
        defaultSeed="world"
        defaultCount={8}
        maxCount={60}
        actionLabel="Generate countries"
        resultLabel="Countries"
        generate={(seed, count) => makeCountries(count, seed)}
      />
    );
  }

  if (tool.slug === "fantasy-name-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Fantasy names are ready"
        summary="Generate character-leaning fantasy names with a softer worldbuilding feel."
        seedLabel="Theme"
        seedPlaceholder="ember"
        defaultSeed="ember"
        defaultCount={8}
        maxCount={40}
        actionLabel="Generate names"
        resultLabel="Fantasy names"
        generate={(seed, count) => makeFantasyNames(count, seed)}
      />
    );
  }

  if (tool.slug === "superhero-name-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Superhero names are ready"
        summary="Generate bold hero-style names that feel usable in stories and games."
        seedLabel="Hero seed"
        seedPlaceholder="nova"
        defaultSeed="nova"
        defaultCount={8}
        maxCount={40}
        actionLabel="Generate heroes"
        resultLabel="Hero names"
        generate={(seed, count) => makeSuperheroNames(count, seed)}
      />
    );
  }

  if (tool.slug === "fake-data-generator") {
    return <FakeDataTool tool={tool} />;
  }

  if (tool.slug === "secret-santa-generator") {
    return <SecretSantaTool tool={tool} />;
  }

  if (tool.slug === "bingo-card-generator") {
    return <BingoCardTool tool={tool} />;
  }

  if (tool.slug === "truth-table-generator") {
    return <TruthTableTool tool={tool} />;
  }

  if (tool.slug === "rhyming-word-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Rhyming words are ready"
        summary="Generate rhyme-style alternatives for lyrics, poems, and playful drafts."
        seedLabel="Target word"
        seedPlaceholder="light"
        defaultSeed="light"
        defaultCount={8}
        maxCount={30}
        actionLabel="Generate rhymes"
        resultLabel="Rhymes"
        generate={(seed, count) => makeRhymes(seed, count)}
      />
    );
  }

  if (tool.slug === "color-scheme-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Color schemes are ready"
        summary="Generate quick palette directions for brands, pages, and UI systems."
        seedLabel="Seed word"
        seedPlaceholder="fresh"
        defaultSeed="fresh"
        defaultCount={3}
        maxCount={12}
        actionLabel="Generate schemes"
        resultLabel="Schemes"
        previewCopyJoiner="\n\n"
        renderItem={(value) => {
          const colors = value.split(" ");
          return (
            <div className="flex items-center gap-3">
              {colors.map((color) => (
                <span key={color} className="h-6 w-6 rounded-full border border-neutral-200" style={{ backgroundColor: color }} />
              ))}
              <span className="font-mono text-xs text-neutral-700">{value}</span>
            </div>
          );
        }}
        generate={(seed, count) => makeColorSchemes(seed, count).map((palette) => palette.join(" "))}
      />
    );
  }

  if (tool.slug === "headline-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Headline ideas are ready"
        summary="Generate sharper headline directions for pages, posts, and launches."
        seedLabel="Topic"
        seedPlaceholder="launch a product"
        defaultSeed="launch a product"
        defaultCount={8}
        maxCount={18}
        actionLabel="Generate headlines"
        resultLabel="Headlines"
        generate={(seed, count) => makeHeadlines(seed, count)}
      />
    );
  }

  if (tool.slug === "thesis-statement-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Thesis statements are ready"
        summary="Generate a concise argument line for essays and research drafts."
        seedLabel="Topic"
        seedPlaceholder="technology and learning"
        defaultSeed="technology and learning"
        defaultCount={3}
        maxCount={3}
        actionLabel="Generate theses"
        resultLabel="Thesis statements"
        generate={(seed, count) => makeTheses(seed, count)}
      />
    );
  }

  if (tool.slug === "restaurant-name-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Restaurant names are ready"
        summary="Generate warm, usable restaurant-style names for menus and concepts."
        seedLabel="Cuisine or style"
        seedPlaceholder="modern kitchen"
        defaultSeed="modern kitchen"
        defaultCount={6}
        actionLabel="Generate names"
        resultLabel="Restaurant names"
        generate={(seed, count) => makeRestaurantNames(seed, count)}
      />
    );
  }

  if (tool.slug === "fancy-text-generator" || tool.slug === "glitch-text-generator") {
    return <TextTransformTool tool={tool} />;
  }

  if (tool.slug === "mla-citation-generator") {
    return <MlaCitationTool tool={tool} />;
  }

  if (tool.slug === "business-niche-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Business niches are ready"
        summary="Generate practical niche ideas for tools, products, and services."
        seedLabel="Seed word"
        seedPlaceholder="apps"
        defaultSeed="apps"
        defaultCount={6}
        actionLabel="Generate niches"
        resultLabel="Niches"
        generate={(seed, count) => makeBusinessNiches(seed, count)}
      />
    );
  }

  if (tool.slug === "product-name-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Product names are ready"
        summary="Generate compact product-style names that are easier to scan and compare."
        seedLabel="Seed word"
        seedPlaceholder="launch"
        defaultSeed="launch"
        defaultCount={6}
        actionLabel="Generate names"
        resultLabel="Product names"
        generate={(seed, count) => makeProductNames(seed, count)}
      />
    );
  }

  if (tool.slug === "startup-idea-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Startup ideas are ready"
        summary="Generate a few focused startup angles instead of vague brainstorming noise."
        seedLabel="Seed topic"
        seedPlaceholder="design tools"
        defaultSeed="design tools"
        defaultCount={5}
        actionLabel="Generate ideas"
        resultLabel="Ideas"
        generate={(seed, count) => makeStartupIdeas(seed, count)}
      />
    );
  }

  if (tool.slug === "story-prompt-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Story prompts are ready"
        summary="Generate quick prompt starters for scenes, roleplay, or warmups."
        seedLabel="Seed idea"
        seedPlaceholder="a small decision"
        defaultSeed="a small decision"
        defaultCount={4}
        actionLabel="Generate prompts"
        resultLabel="Prompts"
        generate={(seed, count) => makeStoryPrompts(seed, count)}
      />
    );
  }

  if (tool.slug === "plot-twist-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Plot twists are ready"
        summary="Generate a few sharp turns that push a story in a better direction."
        seedLabel="Seed idea"
        seedPlaceholder="the mission"
        defaultSeed="the mission"
        defaultCount={4}
        actionLabel="Generate twists"
        resultLabel="Twists"
        generate={(seed, count) => makePlotTwists(seed, count)}
      />
    );
  }

  if (tool.slug === "word-mixer-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Word mixes are ready"
        summary="Blend two words into compact mashups for labels, names, and concepts."
        seedLabel="Word pair"
        seedPlaceholder="flow / spark"
        defaultSeed="flow / spark"
        defaultCount={4}
        actionLabel="Generate mixes"
        resultLabel="Mixes"
        generate={(seed, count) => makeWordMixes(seed, count)}
      />
    );
  }

  if (tool.slug === "sequence-generator") {
    return <SequenceTool tool={tool} />;
  }

  if (tool.slug === "icon-label-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Icon labels are ready"
        summary="Generate short labels that stay readable inside small UI surfaces."
        seedLabel="Seed word"
        seedPlaceholder="settings"
        defaultSeed="settings"
        defaultCount={6}
        actionLabel="Generate labels"
        resultLabel="Labels"
        generate={(seed, count) => makeIconLabels(seed, count)}
      />
    );
  }

  if (tool.slug === "character-name-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Character names are ready"
        summary="Generate fictional character names that feel more grounded than random noise."
        seedLabel="Seed name"
        seedPlaceholder="Ash"
        defaultSeed="Ash"
        defaultCount={5}
        actionLabel="Generate names"
        resultLabel="Character names"
        generate={(seed, count) => makeCharacterNames(seed, count)}
      />
    );
  }

  if (tool.slug === "team-name-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Team names are ready"
        summary="Generate names that feel usable for project teams, clubs, or squads."
        seedLabel="Seed word"
        seedPlaceholder="launch"
        defaultSeed="launch"
        defaultCount={6}
        actionLabel="Generate teams"
        resultLabel="Team names"
        generate={(seed, count) => makeTeamNames(seed, count)}
      />
    );
  }

  if (tool.slug === "ai-prompt-starter-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Prompt starters are ready"
        summary="Generate practical starting points for planning, writing, and AI tasks."
        seedLabel="Task or idea"
        seedPlaceholder="write a landing page"
        defaultSeed="write a landing page"
        defaultCount={4}
        actionLabel="Generate starters"
        resultLabel="Prompt starters"
        generate={(seed, count) => makePromptStarters(seed, count)}
      />
    );
  }

  if (tool.slug === "tagline-generator") {
    return (
      <ListToolShell
        tool={tool}
        headline="Taglines are ready"
        summary="Generate short taglines that stay readable in hero sections and ads."
        seedLabel="Seed word"
        seedPlaceholder="Kloner"
        defaultSeed="Kloner"
        defaultCount={4}
        actionLabel="Generate taglines"
        resultLabel="Taglines"
        generate={(seed, count) => makeTaglines(seed, count)}
      />
    );
  }

  if (tool.slug === "random-number-generator") {
    return <RandomNumberTool tool={tool} />;
  }

  if (tool.slug === "random-word-generator") {
    return <RandomWordTool tool={tool} />;
  }

  const [copyValue, setCopyValue] = useState<string>(tool.intro);

  const content = useMemo(() => {
    switch (tool.slug) {
      case "random-number-generator": {
        const result = makeRandomNumbers(8, 1, 100);
        return {
          headline: "Random numbers are ready",
          summary: "A quick set of numbers is ready to copy.",
          left: <GenericPanel title="Generate"><button type="button" onClick={() => setCopyValue(makeRandomNumbers(8, 1, 100).join(", "))} className="rounded-full bg-[#FF8D21] px-4 py-2 text-sm font-medium text-white">Generate numbers</button></GenericPanel>,
          right: <GenericPanel title="Result"><div className="flex flex-wrap gap-2">{result.map((number, index) => <span key={`${number}-${index}`} className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-sm text-neutral-900">{number}</span>)}</div><div className="mt-4 flex gap-2"><CopyRow value={result.join(", ")} onCopied={() => setCopyValue(result.join(", "))} /></div></GenericPanel>,
        };
      }
      case "random-word-generator": {
        const result = makeRandomWords(10, "creative");
        return {
          headline: "Random words are ready",
          summary: "Quick word ideas are ready to copy.",
          left: <GenericPanel title="Generate"><button type="button" onClick={() => setCopyValue(makeRandomWordsToolCopy("creative", 10))} className="rounded-full bg-[#FF8D21] px-4 py-2 text-sm font-medium text-white">Generate words</button></GenericPanel>,
          right: <GenericPanel title="Result"><TextListResult items={result} /><div className="mt-4"><CopyRow value={result.join(" ")} onCopied={() => setCopyValue(result.join(" "))} /></div></GenericPanel>,
        };
      }
      case "lorem-ipsum-generator": {
        const result = makeLorem(3, 3);
        return {
          headline: "Lorem ipsum is ready",
          summary: "Placeholder copy is ready to paste.",
          left: <GenericPanel title="Generate"><button type="button" onClick={() => setCopyValue(makeLorem(3, 3))} className="rounded-full bg-[#FF8D21] px-4 py-2 text-sm font-medium text-white">Generate copy</button></GenericPanel>,
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