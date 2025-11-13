// components/NavBar.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { brand } from "@/lib/config";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, LogOut, User2, LayoutGrid, Home, ChevronRight, Globe, Camera, Hammer, Rocket, Wand2, Eye, ScanSearch } from "lucide-react";
import { useAuth } from "@/src/hooks/useAuth";
import { signOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

const ACCENT = "#f55f2a";

type NavItem = { label: string; href: string };
type BrandShape = { nav: NavItem[]; cta: { href: string } };

export default function NavBar(): JSX.Element {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<NavItem | null>(null);
  const [mOpen, setMOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const { user } = (useAuth() ?? {}) as { user: User | null };

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 800);
    on();
    window.addEventListener("scroll", on);
    return () => window.removeEventListener("scroll", on);
  }, []);

  // lock body scroll when mobile menu open
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = mOpen ? "hidden" : prev || "";
    return () => { el.style.overflow = prev; };
  }, [mOpen]);

  const initials = useMemo(() => {
    if (!user) return "";
    const name = user.displayName || user.email || "";
    const parts = name.replace(/@.*/, "").replace(/[_.\-]+/g, " ").trim().split(/\s+/).slice(0, 2);
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }, [user]);

  const shellClasses =
    "rounded-[999px] " +
    (scrolled ? "bg-smoke/70 border-white/10 backdrop-blur" : "bg-smoke/40 border-white/10 backdrop-blur");

  const onSignOut = async (): Promise<void> => {
    try {
      await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
      await signOut(auth);
      setUserMenuOpen(false);
    } catch { }
  };

  const br = brand as unknown as BrandShape;

  return (
    <div className="px-4 fixed left-0 right-0 top-5 z-50" onMouseLeave={() => setOpen(false)}>
      <div className="mx-auto max-w-6xl">
        <div className={`relative flex items-center gap-3 px-3 py-1 md:px-1 mx-2 ${shellClasses}`}
          style={{ height: "4rem" }} >
          {/* Logo */}
          <Link href="/" className="ml-3 font-black tracking-tight text-lg md:text-xl shrink-0 text-white">
            <span className="text-white">kloner</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex flex-1 items-center justify-center">
            <ul className="flex items-center gap-6 text-[15px] text-white/85">
              {br.nav.map((i, idx) => (
                <li key={i.label} className="flex items-center">
                  <button
                    className="relative hover:text-white transition  whitespace-nowrap"
                    onMouseEnter={() => { setActive(i); setOpen(true); }}
                    onFocus={() => { setActive(i); setOpen(true); }}
                    aria-expanded={Boolean(open && active?.label === i.label)}
                  >
                    {i.label}
                  </button>
                  {idx === 2 && <span className="ml-5 h-5 w-px bg-white/15 rounded-full" aria-hidden />}
                </li>
              ))}
            </ul>
          </nav>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-2 md:gap-4">
            {/* Mobile burger */}
            <button
              aria-label={mOpen ? "Close menu" : "Open menu"}
              aria-expanded={mOpen}
              onClick={() => { setMOpen(v => !v); setOpen(false); }}
              className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-full text-white/90 hover:bg-white/10 ring-1 ring-white/10"
            >
              {mOpen ? <X size={18} strokeWidth={2.2} /> : <Menu size={18} strokeWidth={2.2} />}
            </button>

            {/* Auth (desktop) */}
            {!user ? (
              <>
                <a href="/login" className="hidden md:inline text-sm text-white/85 hover:text-white">Login</a>
              </>
            ) : (
              <>
                <Link href="/dashboard" className="hidden md:inline text-sm text-white/85 hover:text-white">Dashboard</Link>
                <div className="relative hidden md:block">
                  <button
                    onClick={() => setUserMenuOpen(v => !v)}
                    aria-haspopup="menu"
                    aria-expanded={userMenuOpen}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white ring-1 ring-white/20 hover:bg-white/10"
                  >
                    <span className="text-sm">{initials || "ME"}</span>
                  </button>
                  <AnimatePresence>
                    {userMenuOpen && (
                      <motion.div
                        key="user-menu"
                        initial={{ opacity: 0, y: -6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.16, ease: "easeOut" }}
                        className="absolute right-0 mt-2 w-56 rounded-2xl border border-white/10 bg-white/95 backdrop-blur shadow-2xl overflow-hidden"
                        onMouseLeave={() => setUserMenuOpen(false)}
                      >
                        <div className="px-4 py-3">
                          <div className="text-sm text-neutral-500">Signed in</div>
                          <div className="text-sm text-neutral-800 truncate">{user.displayName || user.email}</div>
                        </div>
                        <div className="h-px bg-neutral-200/70" />
                        <div className="py-1 text-sm">
                          <MenuLink href="/dashboard" label="Dashboard" />
                          <MenuLink href="/settings" label="Settings" />
                          <button
                            onClick={() => void onSignOut()}
                            className="w-full text-left px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 transition"
                          >
                            Sign out
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}

            <a
              href="/dashboard/new"
              className="hidden md:inline-flex items-center justify-center h-14 rounded-full px-5 text-[15px] text-white  whitespace-nowrap"
              style={{ backgroundColor: ACCENT }}
            >
              Start project
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
                className="absolute left-4 right-4 top-full mt-3 hidden md:block"
                onMouseEnter={() => setOpen(true)}
              >
                <MegaPanel active={active} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Mobile Menu (new sheet) */}
        <AnimatePresence>
          {mOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                key="mb-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
                onClick={() => setMOpen(false)}
              />
              {/* Sheet */}
              <motion.nav
                key="mb-sheet"
                initial={{ y: -16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -12, opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-[70] rounded-3xl border border-white/15 bg-white/95 shadow-2xl backdrop-blur"
                role="dialog"
                aria-modal="true"
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-grid h-7 w-7 place-items-center rounded-xl" style={{ background: ACCENT }}>
                      <LayoutGrid className="h-3.5 w-3.5 text-white" />
                    </span>
                    <span className="text-sm font-semibold text-neutral-800">Menu</span>
                  </div>
                  <button
                    onClick={() => setMOpen(false)}
                    aria-label="Close menu"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="h-px bg-neutral-200/70" />

                {/* Quick actions */}
                <div className="grid grid-cols-3 gap-3 px-4 py-3">
                  <QuickAction href="/#how" icon={ScanSearch} label="Crawl" onNavigate={() => setMOpen(false)} />
                  <QuickAction href="/dashboard/view" icon={Camera} label="Screenshots" onNavigate={() => setMOpen(false)} />
                  <QuickAction href="/dashboard/view" icon={Hammer} label="Generate" onNavigate={() => setMOpen(false)} />
                  <QuickAction href="/dashboard" icon={Eye} label="Customize" onNavigate={() => setMOpen(false)} />
                  <QuickAction href="/docs" icon={Wand2} label="Docs" onNavigate={() => setMOpen(false)} />
                  <QuickAction href="/price" icon={Rocket} label="Deploy" onNavigate={() => setMOpen(false)} />
                </div>

                <div className="h-px bg-neutral-200/70" />

                {/* Links */}
                <ul className="px-2 py-2">
                  {br.nav.map((i) => (
                    <li key={i.label}>
                      <MobileLink href={i.href} label={i.label} onNavigate={() => setMOpen(false)} />
                    </li>
                  ))}
                </ul>

                <div className="h-px bg-neutral-200/70" />

                {/* Auth section */}
                <div className="px-4 py-3">
                  {!user ? (
                    <div className="flex gap-2">
                      <a
                        href="/login"
                        onClick={() => setMOpen(false)}
                        className="inline-flex flex-1 items-center justify-center rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800"
                      >
                        <User2 className="mr-2 h-4 w-4" /> Login
                      </a>
                      <a
                        href={br.cta.href}
                        onClick={() => setMOpen(false)}
                        className="inline-flex flex-1 items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold text-white"
                        style={{ background: ACCENT }}
                      >
                        Start Project
                      </a>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <a
                        href="/dashboard"
                        onClick={() => setMOpen(false)}
                        className="inline-flex flex-1 items-center justify-center rounded-full border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800"
                      >
                        <Home className="mr-2 h-4 w-4" /> Dashboard
                      </a>
                      <button
                        onClick={async () => { await onSignOut(); setMOpen(false); }}
                        className="inline-flex flex-1 items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold text-white"
                        style={{ background: ACCENT }}
                      >
                        <LogOut className="mr-2 h-4 w-4" /> Sign out
                      </button>
                    </div>
                  )}
                </div>

                {/* Safe bottom padding */}
                <div className="pb-[max(10px,env(safe-area-inset-bottom))]" />
              </motion.nav>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------- pieces -------------------------------- */

function MobileLink({ href, label, onNavigate }: { href: string; label: string; onNavigate: () => void }) {
  return (
    <a
      href={href}
      onClick={onNavigate}
      className="group flex items-center justify-between rounded-xl px-3 py-3 text-neutral-800 hover:bg-neutral-50"
    >
      <span className="text-[15px]">{label}</span>
      <ChevronRight className="h-4 w-4 text-neutral-400 group-hover:translate-x-0.5 transition-transform" />
    </a>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
  onNavigate,
}: {
  href: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onNavigate}
      className="group grid place-items-center gap-2 rounded-2xl border border-neutral-200 bg-white/70 px-3 py-4 text-center hover:border-neutral-300"
    >
      <div className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: ACCENT }}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <span className="text-xs font-semibold text-neutral-800">{label}</span>
    </a>
  );
}

/* keep your existing MegaPanel/AnimatedPromoCard/etc below (unchanged) */
function MenuLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="block px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 transition">
      {label}
    </a>
  );
}

function MegaPanel({ active }: { active: NavItem | null }): JSX.Element {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/95 backdrop-blur shadow-2xl overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 p-6 md:p-8 text-neutral-800">
        <Link
          href={active?.href || "#"}
          className="hidden md:block rounded-2xl overflow-hidden ring-1 ring-black/10 bg-white shadow-sm"
          aria-label="Explore"
        >
          <AnimatedPromoCard />
          <div className="p-4">
            <div className="text-xs text-neutral-500">Clone any site</div>
            <div className="mt-1 text-sm">Paste a URL. Customize. Deploy.</div>
          </div>
        </Link>

        <div className="space-y-4">
          <div className="text-sm text-neutral-500 tracking-wider">PRODUCT</div>
          <SimpleLink href="#how" label="How it Works" />
          <SimpleLink href="#templates" label="Templates" />
          <SimpleLink href="#pricing" label="Pricing" />
          <SimpleLink href="#docs" label="Docs" />
        </div>

        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-3">
            <div className="text-sm text-neutral-500 tracking-wider">LEARN</div>
            <SimpleLink href="#stories" label="Customer Stories" />
            <SimpleLink href="#faq" label="FAQs" />
            <SimpleLink href="#changelog" label="Changelog" />
            <SimpleLink href="#blog" label="Blog" />
          </div>
          <div className="space-y-3">
            <div className="text-sm text-neutral-500 tracking-wider">OTHER</div>
            <SimpleLink href="#privacy" label="Privacy Policy" />
            <SimpleLink href="#terms" label="Terms & Conditions" />
            <SimpleLink href="#security" label="Security" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SimpleLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="block hover:text-neutral-800 text-neutral-700 rounded-pill transition text-[13px]">
      {label}
    </a>
  );
}

export function AnimatedPromoCard(): JSX.Element {
  return (
    <div className="relative w-full max-w-sm rounded-2xl border border-neutral-200 bg-gradient-to-br from-orange-50/70 via-white to-white shadow-sm overflow-hidden h-[220px]">
      <div className="pointer-events-none absolute -inset-x-1/2 -top-1/3 h-1/2 rotate-12 bg-white/50 blur-2xl animate-[sheen_5s_linear_infinite]" />
      <div className="flex items-center gap-2 px-4 pt-4">
        <Wand2 className="h-4 w-4" style={{ color: ACCENT }} />
        <h3 className="text-sm font-semibold text-neutral-800 tracking-tight">Kloner Workflow</h3>
      </div>
      <div className="absolute left-4 top-12 space-y-2 ">
        <MetricPill icon={ScanSearch} label="Crawl" delay={0} />
        <MetricPill icon={Camera} label="Screenshot" delay={0.25} />
        <MetricPill icon={Hammer} label="Generate" delay={0.5} />
        <MetricPill icon={Eye} label="Customize" delay={0.75} />
        <MetricPill icon={Rocket} label="Deploy" delay={1.0} />
      </div>
      <style jsx>{`
        @keyframes sheen { 0%{transform:translateX(-20%) rotate(12deg);opacity:.6} 50%{transform:translateX(40%) rotate(12deg);opacity:.2} 100%{transform:translateX(100%) rotate(12deg);opacity:.6} }
        @keyframes popin { 0%{transform:translateY(6px) scale(.98);opacity:0} 100%{transform:translateY(0) scale(1);opacity:1} }
      `}</style>
    </div>
  );
}

function MetricPill({
  icon: Icon,
  label,
  delay = 0,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  delay?: number;
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-neutral-700 shadow-sm backdrop-blur"
      style={{ animation: "popin .4s ease forwards", animationDelay: `${delay}s`, opacity: 0 }}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}
