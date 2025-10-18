// components/NavBar.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { brand } from "@/lib/config";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react"; // ← use lucide icons

type NavItem = { label: string; href: string };

export default function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);          // desktop mega
  const [active, setActive] = useState<NavItem | null>(null);
  const [mOpen, setMOpen] = useState(false);         // mobile menu

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
    <div
      className="fixed left-0 right-0 z-50 top-2 md:top-4"
      onMouseLeave={() => setOpen(false)}
    >
      <div className="container-soft">
        <div
          className={`relative flex items-center px-4 md:px-5 py-2 gap-3 md:gap-4 rounded-pill shadow-pill border ${shellClasses}`}
        >
          {/* Logo */}
          <Link href="/" className="font-black tracking-tight text-lg md:text-xl shrink-0">
            <span className="bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">super</span>
            <span className="text-white/80">power</span>
          </Link>

          {/* Desktop nav (centered) */}
          <nav className="hidden md:flex flex-1 justify-center items-center gap-6 text-sm text-white/80">
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

          {/* Right side */}
          <div className="ml-auto shrink-0 flex items-center gap-2 md:gap-4">
            {/* Hamburger (mobile) */}
            <button
              aria-label={mOpen ? "Close menu" : "Open menu"}
              aria-expanded={mOpen}
              onClick={() => { setMOpen(v => !v); setOpen(false); }}
              className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-white/15 text-white/85 hover:bg-white/10 transition"
            >
              {mOpen ? <X size={18} strokeWidth={2.2} /> : <Menu size={18} strokeWidth={2.2} />}
            </button>

            {/* Login (desktop) */}
            <a href="#login" className="hidden md:inline hover:text-white text-white/80 transition">
              Login
            </a>

            {/* CTA (desktop) with glow + arrow hover */}
            <a
              href={brand.cta.href}
              className="
                group relative hidden md:inline-flex items-center gap-2
                rounded-full h-12 px-6
                bg-accent hover:bg-accent2 text-white
                shadow-[0_6px_18px_rgba(0,0,0,0.25)]
                hover:shadow-[0_14px_40px_rgba(0,0,0,0.35)]
                transition-all duration-200
              "
            >
              <span className="pointer-events-none absolute inset-0 rounded-full" />
              <span className="relative">{brand.cta.label}</span>
              <ChevronArrow className="relative h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </a>
          </div>

          {/* Desktop mega dropdown */}
          <AnimatePresence>
            {open && (
              <motion.div
                key="dropdown"
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="absolute left-0 right-0 top-full mt-3 hidden md:block"
                onMouseEnter={() => setOpen(true)}
              >
                <MegaPanel active={active} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Mobile dropdown (slide-down under pill) */}
        <AnimatePresence>
          {mOpen && (
            <motion.div
              key="mobile"
              initial={{ opacity: 0, height: 0, y: -6 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -6 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="md:hidden mt-2 overflow-hidden rounded-2xl border border-white/10 bg-white/90 backdrop-blur shadow-2xl"
            >
              <div className="p-3">
                {brand.nav.map((i: NavItem) => (
                  <a
                    key={i.label}
                    href={i.href}
                    onClick={() => setMOpen(false)}
                    className="block rounded-xl px-3 py-3 text-neutral-900 hover:bg-neutral-50 transition"
                  >
                    {i.label}
                  </a>
                ))}
                <div className="my-2 h-px bg-neutral-200/70" />
                <a
                  href="#login"
                  onClick={() => setMOpen(false)}
                  className="block rounded-xl px-3 py-3 text-neutral-700 hover:bg-neutral-50 transition"
                >
                  Login
                </a>

                {/* CTA (mobile) with same effect + arrow */}
                <a
                  href={brand.cta.href}
                  onClick={() => setMOpen(false)}
                  className="
                    group relative mt-2 mb-1 inline-flex w-full items-center justify-center
                    rounded-full h-12 px-5
                    bg-accent hover:bg-accent2 text-white
                    shadow-[0_6px_18px_rgba(0,0,0,0.20)]
                    hover:shadow-[0_12px_28px_rgba(0,0,0,0.28)]
                    transition-all duration-200
                  "
                >
                  <span className="pointer-events-none absolute inset-0 rounded-full" />
                  <span className="relative">{brand.cta.label}</span>
                  <ChevronArrow className="relative ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------- pieces ---------- */

function ChevronArrow({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
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

/* Desktop mega as a separate component (unchanged content-wise) */
function MegaPanel({ active }: { active: NavItem | null }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/90 backdrop-blur shadow-2xl overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 p-6 md:p-8 text-neutral-900">
        {/* Left promo card placeholder */}
        <Link
          href={active?.href || "#"}
          className="hidden md:block rounded-2xl overflow-hidden ring-1 ring-black/10 bg-white shadow-sm"
          aria-label="Learn more"
        >
          <div className="aspect-[4/3] bg-[url('/images/hero-poster.jpg')] bg-cover bg-center" />
          <div className="p-4">
            <div className="text-xs text-neutral-500">Learn more about your body</div>
            <div className="mt-1 ">Unlock Your Biological Age Today</div>
          </div>
        </Link>

        {/* Product links */}
        <div className="space-y-4">
          <div className="text-xs  text-neutral-500 tracking-wider">PRODUCT</div>
          <SimpleLink href="#how" label="How it Works" />
          <SimpleLink href="#test" label="What We Test" />
          <SimpleLink href="#business" label="Overdrive for Business" />
        </div>

        {/* Learn more / Other */}
        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-3">
            <div className="text-xs  text-neutral-500 tracking-wider">LEARN MORE</div>
            <SimpleLink href="#reviews" label="Reviews" />
            <SimpleLink href="#faq" label="FAQs" />
            <SimpleLink href="#why" label="Our Why" />
            <SimpleLink href="#blog" label="Blog" />
          </div>
          <div className="space-y-3">
            <div className="text-xs  text-neutral-500 tracking-wider">OTHER</div>
            <SimpleLink href="#privacy" label="Privacy Policy" />
            <SimpleLink href="#consent" label="Informed Medical Consent" />
            <SimpleLink href="#terms" label="Terms & Conditions" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SimpleLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="block hover:text-neutral-900 text-neutral-700 transition">
      {label}
    </a>
  );
}
