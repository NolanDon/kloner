// components/NavBar.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { brand } from "@/lib/config";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

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
          className={`relative flex items-center px-4 md:px-5 py-1 gap-3 md:gap-4 rounded-pill shadow-pill border ${shellClasses}`}
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
              aria-label="Open menu"
              aria-expanded={mOpen}
              onClick={() => { setMOpen(v => !v); setOpen(false); }}
              className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-white/15 text-white/85 hover:bg-white/10 transition"
            >
              <Hamburger open={mOpen} />
            </button>

            {/* Login (desktop) */}
            <a href="#login" className="hidden md:inline hover:text-white text-white/80 transition">
              Login
            </a>

            {/* CTA */}
            <a
              href={brand.cta.href}
              className="hidden md:inline-flex items-center gap-2 rounded-full px-6 py-4 bg-accent hover:bg-accent2 text-white transition"
            >
              {brand.cta.label}
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
                <a
                  href={brand.cta.href}
                  onClick={() => setMOpen(false)}
                  className="mt-2 mb-1 inline-flex w-full items-center justify-center rounded-full px-5 py-3 bg-accent hover:bg-accent2 text-white transition"
                >
                  {brand.cta.label}
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

function Hamburger({ open }: { open: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" className="stroke-current">
      <g
        style={{
          transformOrigin: "12px 12px",
          transition: "transform .2s ease, opacity .2s ease",
          transform: open ? "rotate(45deg)" : "rotate(0deg)",
        }}
      >
        <line x1="4" x2="20" y1="7" y2="7" strokeWidth="2" strokeLinecap="round" />
        <line
          x1="4"
          x2="20"
          y1="12"
          y2="12"
          strokeWidth="2"
          strokeLinecap="round"
          style={{ opacity: open ? 0 : 1 }}
        />
        <line
          x1="4"
          x2="20"
          y1="17"
          y2="17"
          strokeWidth="2"
          strokeLinecap="round"
          style={{ transformOrigin: "12px 17px", transform: open ? "translateY(-5px) rotate(90deg)" : "none" }}
        />
      </g>
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
          <SimpleLink href="#business" label="Superpower for Business" />
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
