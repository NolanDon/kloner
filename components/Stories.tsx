"use client";

import Image from "next/image";
import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Images,
  MessageSquare,
  Monitor,
  Moon,
  Paintbrush,
  Sun,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import SectionReveal from "./SectionReveal";
import logo from "@/public/images/orange_logo.png";

type EditorMode = "chat" | "custom";
type Appearance = "light" | "dark";

const slides: { mode: EditorMode; appearance: Appearance }[] = [
  { mode: "chat", appearance: "light" },
  { mode: "chat", appearance: "dark" },
  { mode: "custom", appearance: "light" },
  { mode: "custom", appearance: "dark" },
];

function PreviewSite({ dark }: { dark: boolean }) {
  return (
    <div className={`h-full min-w-0 flex-1 overflow-hidden ${dark ? "bg-[#151412] text-[#eee4d1]" : "bg-[#f8f7f3] text-[#202020]"}`}>
      <div className={`flex h-9 items-center justify-between border-b px-3 sm:h-11 sm:px-5 ${dark ? "border-white/10" : "border-black/10"}`}>
        <div className="flex items-center gap-2 text-[9px] font-semibold sm:text-xs"><span className={`grid h-5 w-5 place-items-center border text-[8px] sm:h-6 sm:w-6 ${dark ? "border-white/40" : "border-black/40"}`}>LL</span> League Ledger</div>
        <div className={`hidden h-5 w-[35%] items-center rounded-full border px-2 text-[8px] sm:flex ${dark ? "border-white/10 text-white/40" : "border-black/10 text-black/40"}`}><span className="mr-2">⌕</span> Search tools, categories, or tasks</div>
        <div className="text-[8px] font-semibold sm:text-[10px]">How we score ↗</div>
      </div>
      <div className={`flex h-7 items-center gap-3 border-b px-3 text-[7px] sm:h-9 sm:gap-5 sm:px-5 sm:text-[9px] ${dark ? "border-white/10 text-white/55" : "border-black/10 text-black/55"}`}>
        <span>▦ &nbsp;Overview</span><span>♧ &nbsp;All tools</span><span>▤ &nbsp;AI writing</span><span>◉ &nbsp;Research</span><span className="hidden sm:inline">▧ &nbsp;Image &amp; video</span>
      </div>
      <div className="grid h-[calc(100%-4rem)] grid-cols-[1.1fr_0.9fr] gap-3 p-4 sm:h-[calc(100%-5rem)] sm:gap-6 sm:p-7 md:gap-10 md:p-10">
        <div className="flex min-w-0 flex-col justify-center">
          <p className={`mb-2 font-mono text-[6px] tracking-[.15em] sm:mb-3 sm:text-[8px] ${dark ? "text-white/45" : "text-black/45"}`}>THE INDEPENDENT AI BUYING GUIDE</p>
          <h4 className="text-[clamp(17px,3.2vw,50px)] font-bold leading-[.98] tracking-[-.05em]">Make a better call <em className="font-serif font-medium">on AI.</em></h4>
          <p className={`mt-3 max-w-md text-[8px] leading-relaxed sm:mt-5 sm:text-xs md:text-sm ${dark ? "text-white/55" : "text-black/55"}`}>Straight answers to the questions that matter: what works, what it costs, and who it is actually for.</p>
          <div className="mt-3 flex items-center gap-3 sm:mt-5"><span className={`px-2 py-1.5 text-[7px] font-semibold sm:px-3 sm:py-2 sm:text-[9px] ${dark ? "bg-[#eee4d1] text-[#171614]" : "bg-[#171614] text-white"}`}>Browse comparisons&nbsp; →</span><span className="text-[7px] font-semibold sm:text-[9px]">Our approach&nbsp; ›</span></div>
        </div>
        <div className={`my-auto border p-3 sm:p-5 ${dark ? "border-white/10 bg-[#292722]" : "border-black/10 bg-[#ebe9df]"}`}>
          <p className={`font-mono text-[6px] tracking-widest sm:text-[8px] ${dark ? "text-white/45" : "text-black/45"}`}>LEAGUE LEDGER / FIELD NOTES</p>
          <div className="mt-5 flex items-center gap-2 sm:mt-8"><strong className="text-2xl sm:text-4xl">9.1</strong><div><span className={`block text-[6px] uppercase sm:text-[8px] ${dark ? "text-white/45" : "text-black/45"}`}>Current pick</span><b className="text-[9px] sm:text-sm">ChatGPT</b></div></div>
          <div className={`mt-4 border-t pt-3 text-[6px] sm:mt-6 sm:pt-4 sm:text-[8px] ${dark ? "border-white/15 text-white/50" : "border-black/15 text-black/50"}`}>WHAT WE LOOK AT <span className="float-right">Usefulness, value, clarity</span></div>
          <div className={`mt-2 border-t pt-2 text-[6px] sm:text-[8px] ${dark ? "border-white/15 text-white/50" : "border-black/15 text-black/50"}`}>LAST REVIEWED <span className="float-right">October 2026</span></div>
        </div>
      </div>
    </div>
  );
}

function ChatEditor({ dark }: { dark: boolean }) {
  const panel = dark ? "bg-[#201f1c] text-[#e8dfcd] border-[#4a453b]" : "bg-white text-[#292929] border-[#e7e5e1]";
  const bubble = dark ? "bg-[#2a2824] border-[#49443b] text-[#e8dfcd]" : "bg-white border-[#e8e6e2] text-[#292929] shadow-sm";
  return (
    <div className={`flex h-full w-[25%] min-w-[118px] max-w-[260px] shrink-0 flex-col border-r ${panel}`}>
      <div className={`flex h-8 items-center gap-1 border-b px-2 sm:h-10 sm:gap-2 sm:px-3 ${dark ? "border-[#403d37]" : "border-[#eee]"}`}>
        {([[MessageSquare, "Chat"], [Images, "Images"], [Paintbrush, "Custom"]] as const).map(([Icon, label], i) => <span key={label} className={`flex items-center gap-1 rounded-full px-1.5 py-1 text-[6px] font-semibold sm:gap-1.5 sm:px-2 sm:text-[8px] ${i === 0 ? "bg-[#ff8d21] text-white" : dark ? "text-[#b7af9f]" : "text-[#737373]"}`}><Icon className="h-2 w-2 sm:h-3 sm:w-3" />{label}</span>)}
      </div>
      <div className={`flex h-8 items-center justify-between border-b px-2 text-[7px] font-semibold sm:h-10 sm:px-3 sm:text-[9px] ${dark ? "border-[#403d37]" : "border-[#eee]"}`}><span><span className="mr-1 text-[#ff8d21]">▣</span> Copper Otter</span><span className={dark ? "text-[#a9a092]" : "text-[#888]"}>Timeline⌄</span></div>
      <div className={`flex min-h-0 flex-1 flex-col gap-2 p-2 sm:gap-3 sm:p-3 ${dark ? "bg-[#171614]" : "bg-[#fffaf6]"}`}>
        <div className={`max-w-[96%] rounded-[12px] border p-2 text-[7px] leading-relaxed sm:rounded-[16px] sm:p-3 sm:text-[9px]` + " " + bubble}>Hi, I&apos;m your personal AI assistant. Tell me what you&apos;d like to change.<span className={`mt-1 block text-[6px] ${dark ? "text-[#a79d8d]" : "text-[#999]"}`}>2:57:09 AM</span></div>
        <div className={`max-w-[80%] rounded-[12px] border p-2 text-[7px] leading-relaxed sm:rounded-[16px] sm:p-3 sm:text-[9px]` + " " + bubble}>Saved a restore point.<span className={`mt-1 block text-[6px] ${dark ? "text-[#a79d8d]" : "text-[#999]"}`}>3:26:42 AM</span></div>
        <div className={`mt-auto rounded-lg border p-1.5 sm:p-2 ${dark ? "border-[#49443b] bg-[#201f1c]" : "border-[#e7e5e1] bg-white"}`}><div className={`rounded-md px-2 py-2 text-[7px] sm:text-[9px] ${dark ? "bg-[#2a2824] text-white/45" : "bg-[#faf9f7] text-black/45"}`}>Ask me to change something…</div></div>
      </div>
    </div>
  );
}

function EditorCarousel() {
  const [index, setIndex] = useState(0);
  const reduceMotion = useReducedMotion();
  const slide = slides[index];
  const dark = slide.appearance === "dark";
  const goTo = (next: number) => setIndex((next + slides.length) % slides.length);

  return (
    <div className="overflow-hidden rounded-lg border border-[#aaa59c] bg-[#111] shadow-[0_14px_35px_rgba(0,0,0,.18)] sm:rounded-xl">
      <div className={`flex h-6 items-center justify-between border-b px-2.5 sm:h-8 sm:px-4 ${dark ? "border-white/10 bg-[#242320]" : "border-[#e6e4e0] bg-[#f8f8f8]"}`}>
        <div className="flex items-center gap-1.5" aria-hidden="true"><span className="h-1.5 w-1.5 rounded-full bg-[#ff625b] sm:h-2 sm:w-2" /><span className="h-1.5 w-1.5 rounded-full bg-[#ffc344] sm:h-2 sm:w-2" /><span className="h-1.5 w-1.5 rounded-full bg-[#38c980] sm:h-2 sm:w-2" /></div>
        <span className={`text-[7px] sm:text-[9px] ${dark ? "text-white/45" : "text-black/45"}`}>preview.kloner</span>
        <span className="w-5" />
      </div>
      <div className="relative aspect-[16/9] overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={`${slide.mode}-${slide.appearance}`} initial={reduceMotion ? false : { opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? undefined : { opacity: 0, x: -12 }} transition={{ duration: 0.2 }} className="absolute inset-0 flex">
            {slide.mode === "chat" ? (
              <Image
                src="/images/editor-demo/ai-editor-dark.webp"
                alt="Kloner AI chat editor beside a live website preview in dark mode"
                fill
                sizes="(min-width: 1280px) 1000px, 90vw"
                className="object-contain"
              />
            ) : (
              <>
                <ChatEditor dark={true} />
                <PreviewSite dark={true} />
              </>
            )}
          </motion.div>
        </AnimatePresence>
        <span className="absolute bottom-2 right-2 rounded-full bg-[#ff8d21] p-1 text-white shadow-md sm:bottom-3 sm:right-3 sm:p-1.5"><Monitor className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5" /></span>
      </div>
      <div className={`flex flex-wrap items-center justify-between gap-2 border-t px-2.5 py-2 sm:px-4 sm:py-3 ${dark ? "border-white/10 bg-[#201f1c] text-[#eee4d1]" : "border-[#e6e4e0] bg-white text-[#292929]"}`}>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button type="button" onClick={() => goTo(slide.mode === "chat" ? (dark ? 3 : 2) : (dark ? 1 : 0))} aria-pressed={slide.mode === "chat"} className={`flex items-center gap-1 rounded-full px-2 py-1 text-[8px] font-semibold transition sm:px-3 sm:py-1.5 sm:text-[10px] ${slide.mode === "chat" ? "bg-[#ff8d21] text-white" : dark ? "bg-white/5 text-[#c4baa8] hover:bg-white/10" : "bg-black/5 text-[#605b53] hover:bg-black/10"}`}><MessageSquare className="h-3 w-3" /> AI chat</button>
          <button type="button" onClick={() => goTo(slide.mode === "custom" ? (dark ? 1 : 0) : (dark ? 3 : 2))} aria-pressed={slide.mode === "custom"} className={`flex items-center gap-1 rounded-full px-2 py-1 text-[8px] font-semibold transition sm:px-3 sm:py-1.5 sm:text-[10px] ${slide.mode === "custom" ? "bg-[#ff8d21] text-white" : dark ? "bg-white/5 text-[#c4baa8] hover:bg-white/10" : "bg-black/5 text-[#605b53] hover:bg-black/10"}`}><Paintbrush className="h-3 w-3" /> Manual edit</button>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`flex rounded-full p-0.5 ${dark ? "bg-white/5" : "bg-black/5"}`} aria-label="Preview appearance">
            <button type="button" onClick={() => goTo(slide.mode === "chat" ? 0 : 2)} aria-label="Show light mode" aria-pressed={!dark} className={`rounded-full p-1 ${!dark ? "bg-white shadow-sm" : "opacity-60 hover:opacity-100"}`}><Sun className="h-3 w-3" /></button>
            <button type="button" onClick={() => goTo(slide.mode === "chat" ? 1 : 3)} aria-label="Show dark mode" aria-pressed={dark} className={`rounded-full p-1 ${dark ? "bg-[#555047] text-[#f4d99e]" : "opacity-60 hover:opacity-100"}`}><Moon className="h-3 w-3" /></button>
          </div>
          <span className={`hidden text-[8px] sm:inline sm:text-[9px] ${dark ? "text-white/50" : "text-black/45"}`}>{index + 1}/4</span>
          <button type="button" onClick={() => goTo(index - 1)} aria-label="Previous editor preview" className={`grid h-6 w-6 place-items-center rounded-full border transition sm:h-7 sm:w-7 ${dark ? "border-white/15 hover:bg-white/10" : "border-black/10 hover:bg-black/5"}`}><ChevronLeft className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => goTo(index + 1)} aria-label="Next editor preview" className={`grid h-6 w-6 place-items-center rounded-full border transition sm:h-7 sm:w-7 ${dark ? "border-white/15 hover:bg-white/10" : "border-black/10 hover:bg-black/5"}`}><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

function LaptopEditorPlaceholder() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="mx-auto w-full max-w-5xl px-2 sm:px-4" style={{ perspective: "1400px" }}>
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 100, rotateX: 62, scale: 0.92 }}
        whileInView={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
        viewport={{ once: true, amount: 0.25 }}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 62, damping: 19, mass: 0.9, delay: 0.08 }}
        style={{ transformOrigin: "bottom center", transformStyle: "preserve-3d" }}
        className="relative rounded-[1.15rem] border border-[#49443d] bg-[#171614] p-1.5 shadow-[0_35px_75px_rgba(0,0,0,0.24),0_8px_18px_rgba(255,141,33,0.09)] sm:rounded-[1.6rem] sm:p-3"
      >
        <EditorCarousel />
      </motion.div>

      <div className="relative mx-auto h-3 w-[104%] -translate-x-[2%] rounded-b-[1.2rem] bg-gradient-to-b from-[#c5c1bb] via-[#918c85] to-[#d4d0ca] shadow-[0_14px_22px_rgba(0,0,0,0.2)] sm:h-4">
        <div className="mx-auto h-1 w-16 rounded-b-md bg-[#77716a]/70 sm:w-24" />
      </div>
      <div className="mx-auto h-2 w-[82%] rounded-b-[50%] bg-black/10 blur-[2px]" aria-hidden="true" />
    </div>
  );
}

export default function Stories() {
  return (
    <section className="section stories-editor-demo mt-20 mb-20 bg-white text-black" id="reviews">
      <div className="container-soft">
        <div className="mb-8 flex items-center justify-between gap-4 sm:mb-10">
          <h2 className="mt-1 flex flex-wrap items-center justify-start gap-x-3 gap-y-1 text-base text-neutral-600 sm:text-lg">
            <span className="block text-[16px] uppercase tracking-[0.1em] text-neutral-500">
              Make every detail yours with Kloner
            </span>
            <span className="relative inline-block h-[72px] w-[72px] shrink-0 sm:h-[92px] sm:w-[92px]">
              <Image src={logo} alt="Kloner logo" fill sizes="(min-width: 640px) 92px, 72px" className="object-contain" />
            </span>
          </h2>
        </div>

        <div className="mb-10 grid gap-3 sm:mb-12 sm:gap-5 md:grid-cols-[0.72fr_1fr] md:items-end md:gap-10">
          <SectionReveal>
            <h2 className="max-w-xl text-4xl leading-tight tracking-tight text-neutral-900 sm:text-4xl md:text-6xl">
              Your website, edited live.
            </h2>
             <p className="max-w-2xl text-base leading-relaxed text-neutral-600 sm:text-lg mt-10">
              Refine copy, images, colors, and layout in the in-app editor, then see every change in your live preview before you launch.
            </p>
          </SectionReveal>
       
        </div>

        <LaptopEditorPlaceholder />
      </div>
    </section>
  );
}
