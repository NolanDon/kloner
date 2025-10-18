// components/NavBar.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { brand } from "@/lib/config";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

type NavItem = { label: string; href: string };

export default function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<NavItem | null>(null);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on);
    return () => window.removeEventListener("scroll", on);
  }, []);

  const shellClasses = scrolled
    ? "bg-smoke/80 border-white/10 backdrop-blur"
    : "bg-smoke/60 border-white/10 backdrop-blur";

  return (
    <div className="fixed top-10 left-0 right-0 z-50" onMouseLeave={() => setOpen(false)}>
      <div className="container-soft">
        <div className={`relative flex items-center px-5 py-2 gap-4 rounded-pill shadow-pill border ${shellClasses}`}>
          {/* Logo */}
          <Link href="/" className="font-black tracking-tight text-xl shrink-0">
            <span className="bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">super</span>
            <span className="text-white/80">power</span>
          </Link>

          {/* Centered nav */}
          <nav className="flex-1 hidden md:flex justify-center items-center gap-6 text-sm text-white/80">
            {brand.nav.map((i: NavItem) => (
              <button
                key={i.label}
                className="relative hover:text-white transition"
                onMouseEnter={() => { setActive(i); setOpen(true); }}
                onFocus={() => { setActive(i); setOpen(true); }}
                aria-expanded={open && active?.label === i.label}
              >
                {i.label}
              </button>
            ))}
          </nav>

          {/* CTA */}
          <div className="ml-auto shrink-0 flex items-center gap-4">
            <a href="#login" className="hidden md:inline hover:text-white text-white/80 transition">Login</a>
            <a
              href={brand.cta.href}
              className="inline-flex items-center gap-2 rounded-full px-6 py-4 bg-accent hover:bg-accent2 text-white transition"
            >
              {brand.cta.label}
            </a>
          </div>

          {/* Dropdown panel */}
          <AnimatePresence>
            {open && (
              <motion.div
                key="dropdown"
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="absolute left-0 right-0 top-full mt-3"
                onMouseEnter={() => setOpen(true)}
              >
                <div className="rounded-3xl border border-white/10 bg-white/90 backdrop-blur shadow-2xl overflow-hidden">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 p-6 md:p-8 text-neutral-900">
                    {/* Left animated promo card */}
                    <Link
                      href={active?.href || "#"}
                      className="hidden md:block rounded-2xl overflow-hidden ring-1 ring-black/10 bg-white shadow-sm"
                      aria-label="Learn more"
                    >
                      <PromoAnimatedCard />
                      <div className="p-4">
                        <div className="text-xs text-neutral-500">Learn more about your body</div>
                        <div className="mt-1 font-semibold">Unlock Your Biological Age Today</div>
                      </div>
                    </Link>

                    {/* Product links WITH ICONS */}
                    <div className="space-y-4">
                      <div className="text-xs font-semibold text-neutral-500 tracking-wider">PRODUCT</div>
                      <DropdownItem
                        Icon={IconSteps}
                        title="How it Works"
                        desc="Get the most from your first premium health membership"
                        href="#how"
                      />
                      <DropdownItem
                        Icon={IconFlask}
                        title="What We Test"
                        desc="100+ biomarkers included in your annual superpower panel"
                        href="#test"
                      />
                      <DropdownItem
                        Icon={IconBriefcase}
                        title="Superpower for Business"
                        desc="All the benefits tailored to your team"
                        href="#business"
                      />
                    </div>

                    {/* Learn more / Other */}
                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-3">
                        <div className="text-xs font-semibold text-neutral-500 tracking-wider">LEARN MORE</div>
                        <SimpleLink href="#reviews" label="Reviews" />
                        <SimpleLink href="#faq" label="FAQs" />
                        <SimpleLink href="#why" label="Our Why" />
                        <SimpleLink href="#blog" label="Blog" />
                      </div>
                      <div className="space-y-3">
                        <div className="text-xs font-semibold text-neutral-500 tracking-wider">OTHER</div>
                        <SimpleLink href="#privacy" label="Privacy Policy" />
                        <SimpleLink href="#consent" label="Informed Medical Consent" />
                        <SimpleLink href="#terms" label="Terms & Conditions" />
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ===== animated promo card (unchanged) ===== */
function PromoAnimatedCard() {
  const reduce = useReducedMotion();
  const DUR = 2.2;
  return (
    <div className="aspect-[4/3] relative overflow-hidden bg-neutral-50">
      <svg className="absolute inset-0 h-full w-full opacity-40" aria-hidden>
        <defs>
          <pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="#e5e7eb" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#p)" />
      </svg>
      <div className="absolute top-4 left-4 right-4 flex gap-2">
        {[
          { label: "ApoB", val: "78" },
          { label: "Age", val: "31.8" },
          { label: "VO₂", val: "44" },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            className="rounded-xl bg-white border border-neutral-200 shadow-sm px-3 py-2 text-xs flex items-center gap-2"
            animate={reduce ? {} : { y: [0, -2, 0] }}
            transition={reduce ? {} : { duration: 3, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }}
          >
            <span className="text-neutral-500">{s.label}</span>
            <motion.span
              className="font-semibold text-neutral-900"
              animate={reduce ? {} : { scale: [1, 1.06, 1] }}
              transition={reduce ? {} : { duration: DUR, repeat: Infinity, repeatDelay: 0.4 }}
            >
              {s.val}
            </motion.span>
          </motion.div>
        ))}
      </div>
      <div className="absolute left-4 right-4 top-16">
        <div className="h-2 w-full rounded bg-neutral-200 overflow-hidden">
          <motion.div
            className="h-full bg-emerald-500"
            animate={reduce ? {} : { width: ["0%", "100%", "0%"] }}
            transition={reduce ? {} : { duration: DUR + 0.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </div>
      <svg viewBox="0 0 320 120" className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[90%] h-24">
        <motion.path
          d="M8,90 C38,76 58,66 88,74 C118,82 132,50 168,56 C198,60 212,44 240,50 C268,56 292,32 312,36"
          fill="none"
          stroke="#10b981"
          strokeWidth="3"
          strokeLinecap="round"
          animate={reduce ? {} : { pathLength: [0, 1, 0] }}
          transition={reduce ? {} : { duration: DUR + 0.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle
          r="5"
          fill="#10b981"
          animate={reduce ? {} : { cx: [8, 312, 8], cy: [90, 36, 90] }}
          transition={reduce ? {} : { duration: DUR + 0.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </svg>
      <motion.div
        className="absolute -right-10 -bottom-10 h-36 w-36 rounded-full bg-emerald-500/10 blur-2xl"
        animate={reduce ? {} : { scale: [1, 1.1, 1], opacity: [0.2, 0.35, 0.2] }}
        transition={reduce ? {} : { duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden
      />
    </div>
  );
}

/* ===== icons + item helpers ===== */

type IconProps = { className?: string };

function IconTile({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative h-10 w-10 rounded-lg ring-1 ring-neutral-200 bg-neutral-100 shadow-sm grid place-items-center overflow-hidden">
      {/* soft looping sheen */}
      <motion.span
        className="absolute -left-10 top-0 h-full w-10 bg-white/30"
        animate={reduce ? {} : { x: ["-120%", "140%"] }}
        transition={reduce ? {} : { duration: 2.2, repeat: Infinity, ease: "linear" }}
        aria-hidden
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function IconSteps({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-5 w-5 text-neutral-700"} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 17h6v3H4zM10 12h6v3h-6zM16 7h4v3h-4z" />
    </svg>
  );
}

function IconFlask({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-5 w-5 text-emerald-600"} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 3h6M10 3v5l-5 8a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 16l-5-8V3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 15h6" />
    </svg>
  );
}

function IconBriefcase({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-5 w-5 text-neutral-800"} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" strokeLinecap="round" />
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <path d="M3 12h18" />
    </svg>
  );
}

function DropdownItem({
  title,
  desc,
  href,
  Icon,
}: {
  title: string;
  desc: string;
  href: string;
  Icon: (p: IconProps) => JSX.Element;
}) {
  return (
    <a href={href} className="group flex gap-3 rounded-xl p-2 -m-2 hover:bg-neutral-50 transition">
      <IconTile>
        <Icon className="h-5 w-5" />
      </IconTile>
      <div>
        <div className="font-semibold group-hover:text-neutral-900">{title}</div>
        <div className="text-sm text-neutral-500">{desc}</div>
      </div>
    </a>
  );
}

function SimpleLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="block hover:text-neutral-900 text-neutral-700 transition">
      {label}
    </a>
  );
}
