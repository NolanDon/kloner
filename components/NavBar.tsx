// components/NavBar.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { brand } from "@/lib/config";
import { motion, AnimatePresence } from "framer-motion";

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

  // convenience
  const shellClasses =
    scrolled
      ? "bg-smoke/80 border-white/10 backdrop-blur"
      : "bg-smoke/60 border-white/10 backdrop-blur";

  return (
    <div className="fixed top-10 left-0 right-0 z-50" onMouseLeave={() => setOpen(false)}>
      <div className="container-soft">
        <div className={`relative flex items-center px-5 py-2 gap-4 rounded-pill shadow-pill border ${shellClasses}`}>
          {/* Logo (left) */}
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
                onMouseEnter={() => {
                  setActive(i);
                  setOpen(true);
                }}
                onFocus={() => {
                  setActive(i);
                  setOpen(true);
                }}
                aria-expanded={open && active?.label === i.label}
              >
                {i.label}
              </button>
            ))}
          </nav>

          {/* CTA (right) */}
          <div className="ml-auto shrink-0 flex items-center gap-4">
            <a href="#login" className="hidden md:inline hover:text-white text-white/80 transition">
              Login
            </a>
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
                    {/* Left promo card */}
                    <a
                      href={active?.href || "#"}
                      className="hidden md:block rounded-2xl overflow-hidden ring-1 ring-black/10 bg-white shadow-sm"
                    >
                      <div className="aspect-[4/3] bg-[url('/images/hero-poster.jpg')] bg-cover bg-center" />
                      <div className="p-4">
                        <div className="text-xs text-neutral-500">Learn more about your body</div>
                        <div className="mt-1 font-semibold">Unlock Your Biological Age Today</div>
                      </div>
                    </a>

                    {/* Product links */}
                    <div className="space-y-4">
                      <div className="text-xs font-semibold text-neutral-500 tracking-wider">PRODUCT</div>
                      <DropdownItem title="How it Works" desc="Get the most from your first premium health membership" href="#how" />
                      <DropdownItem title="What We Test" desc="100+ biomarkers included in your annual superpower test panel" href="#test" />
                      <DropdownItem title="Superpower for Business" desc="All the benefits of Superpower tailored to your team" href="#business" />
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

/* ------- small helpers ------- */

function DropdownItem({
  title,
  desc,
  href,
}: {
  title: string;
  desc: string;
  href: string;
}) {
  return (
    <a href={href} className="group flex gap-3 rounded-xl p-2 -m-2 hover:bg-neutral-50 transition">
      <div className="h-10 w-10 rounded-lg bg-neutral-100 ring-1 ring-neutral-200 shadow-sm" />
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
