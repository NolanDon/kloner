// components/NavBar.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { brand } from "@/lib/config";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/src/hooks/useAuth";
import { signOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Globe, Camera, Hammer, Rocket, Wand2, Eye, ScanSearch } from "lucide-react";

const ACCENT = "#f55f2a";

/* ------------------------------- types ------------------------------- */
type NavItem = { label: string; href: string };
type BrandShape = { nav: NavItem[]; cta: { href: string } };
type ChevronArrowProps = { className?: string };
type SimpleLinkProps = { href: string; label: string };
type MetricPillProps = { label: string; delay?: number };
type MegaPanelProps = { active: NavItem | null };

/* ------------------------------ component ---------------------------- */
export default function NavBar(): JSX.Element {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<NavItem | null>(null);
  const [mOpen, setMOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const { user } = (useAuth() ?? {}) as { user: User | null };

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on);
    return () => window.removeEventListener("scroll", on);
  }, []);

  const initials = useMemo(() => {
    if (!user) return "";
    const name = user.displayName || user.email || "";
    const parts = name
      .replace(/@.*/, "")
      .replace(/[_.\-]+/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 2);
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }, [user]);

  const shellClasses =
    "rounded-[999px] " +
    (scrolled
      ? "bg-smoke/70 border-white/10 backdrop-blur"
      : "bg-smoke/40 border-white/10 backdrop-blur");

  const onSignOut = async (): Promise<void> => {
    try {
      await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
      await signOut(auth);
      setUserMenuOpen(false);
    } catch { }
  };

  const br = brand as unknown as BrandShape;

  return (
    <div className="fixed left-0 right-0 top-5 z-50" onMouseLeave={() => setOpen(false)}>
      <div className="mx-auto max-w-6xl px-3">
        <div className={`relative flex items-center gap-3 px-3 py-2 md:px-4 ${shellClasses}`}>
          {/* Logo */}
          <Link href="/" className="ml-2 font-black tracking-tight text-lg md:text-xl shrink-0 text-white">
            <span className="text-white">kloner</span>
          </Link>

          {/* Desktop nav (centered) */}
          <nav className="hidden md:flex flex-1 items-center justify-center">
            <ul className="flex items-center gap-6 text-[15px] text-white/85">
              {br.nav.map((i, idx) => (
                <li key={i.label} className="flex items-center">
                  <button
                    className="relative hover:text-white transition"
                    onMouseEnter={() => {
                      setActive(i);
                      setOpen(true);
                    }}
                    onFocus={() => {
                      setActive(i);
                      setOpen(true);
                    }}
                    aria-expanded={Boolean(open && active?.label === i.label)}
                  >
                    {i.label}
                  </button>

                  {/* Soft divider after specific item to match screenshot */}
                  {idx === 2 && (
                    <span className="mx-6 h-5 w-px bg-white/15 rounded-full" aria-hidden />
                  )}
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
              onClick={() => {
                setMOpen((v) => !v);
                setOpen(false);
              }}
              className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-full text-white/90 hover:bg-white/10 ring-1 ring-white/10"
            >
              {mOpen ? <X size={18} strokeWidth={2.2} /> : <Menu size={18} strokeWidth={2.2} />}
            </button>

            {/* Auth area (desktop) */}
            {!user ? (
              <>
                <a href="/login" className="hidden md:inline text-sm text-white/85 hover:text-white">
                  Login
                </a>
                <a
                  href={br.cta.href}
                  className="hidden md:inline-flex items-center justify-center h-11 rounded-full px-5 text-[15px] font-medium text-white transition-all"
                  style={{ backgroundColor: ACCENT }}
                >
                  Start Project
                </a>
              </>
            ) : (
              <>
                <Link href="/dashboard" className="hidden md:inline text-sm text-white/85 hover:text-white">
                  Dashboard
                </Link>

                <div className="relative hidden md:block">
                  <button
                    onClick={() => setUserMenuOpen((v) => !v)}
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
                          <div className="text-sm text-neutral-900 truncate">{user.displayName || user.email}</div>
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

                <a
                  href="/dashboard/new"
                  className="hidden md:inline-flex items-center justify-center h-11 rounded-full px-5 text-[15px] font-medium text-white transition-all
                   shadow-[0_6px_18px_rgba(0,0,0,0.25)]
                  hover:bg-accent2
                  hover:shadow-[0_14px_40px_rgba(0,0,0,0.35)]
                  transition"
                  style={{ backgroundColor: ACCENT }}
                >
                  New project
                </a>
              </>
            )}
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

        {/* Mobile dropdown */}
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
                {br.nav.map((i) => (
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

                {!user ? (
                  <>
                    <a
                      href="/login"
                      onClick={() => setMOpen(false)}
                      className="block rounded-xl px-3 py-3 text-neutral-700 hover:bg-neutral-50 transition"
                    >
                      Login
                    </a>
                    <a
                      href={br.cta.href}
                      onClick={() => setMOpen(false)}
                      className="group relative mt-2 mb-1 inline-flex w-full items-center justify-center rounded-full h-12 px-5 text-white"
                      style={{ backgroundColor: ACCENT }}
                    >
                      <span className="relative">Try Superpower</span>
                      <ChevronArrow className="relative ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                    </a>
                  </>
                ) : (
                  <>
                    <a
                      href="/dashboard"
                      onClick={() => setMOpen(false)}
                      className="block rounded-xl px-3 py-3 text-neutral-900 hover:bg-neutral-50 transition"
                    >
                      Dashboard
                    </a>
                    <a
                      href="/settings"
                      onClick={() => setMOpen(false)}
                      className="block rounded-xl px-3 py-3 text-neutral-900 hover:bg-neutral-50 transition"
                    >
                      Settings
                    </a>
                    <button
                      onClick={async () => {
                        await onSignOut();
                        setMOpen(false);
                      }}
                      className="w-full text-left rounded-xl px-3 py-3 text-neutral-900 hover:bg-neutral-50 transition"
                    >
                      Sign out
                    </button>
                    <a
                      href="/dashboard/new"
                      onClick={() => setMOpen(false)}
                      className="group relative mt-2 mb-1 inline-flex w-full items-center justify-center rounded-full h-12 px-5 text-white"
                      style={{ backgroundColor: ACCENT }}
                    >
                      <span className="relative">New project</span>
                      <ChevronArrow className="relative ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                    </a>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------- pieces -------------------------------- */
function ChevronArrow({ className = "" }: ChevronArrowProps): JSX.Element {
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

function MegaPanel({ active }: MegaPanelProps): JSX.Element {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/90 backdrop-blur shadow-2xl overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 p-6 md:p-8 text-neutral-900">
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

function SimpleLink({ href, label }: SimpleLinkProps): JSX.Element {
  return (
    <a href={href} className="block hover:text-neutral-900 text-neutral-700 rounded-pill transition text-[13px]">
      {label}
    </a>
  );
}

/** Compact, icon-forward promo card */
export function AnimatedPromoCard(): JSX.Element {
  return (
    <div className="relative w-full max-w-sm rounded-2xl border border-neutral-200 bg-gradient-to-br from-orange-50/70 via-white to-white shadow-sm overflow-hidden  h-[220px]">
      {/* sheen */}
      <div className="pointer-events-none absolute -inset-x-1/2 -top-1/3 h-1/2 rotate-12 bg-white/50 blur-2xl animate-[sheen_5s_linear_infinite]" />

      {/* header */}
      <div className="flex items-center gap-2 px-4 pt-4">
        <Wand2 className="h-4 w-4 text-[--accent]" />
        <h3 className="text-sm font-semibold text-neutral-800 tracking-tight">
          Kloner Workflow
        </h3>
      </div>

      {/* left metric pills */}
      <div className="absolute left-4 top-12 space-y-2 ">
        <MetricPill icon={ScanSearch} label="Crawl" delay={0} />
        <MetricPill icon={Camera} label="Screenshot" delay={0.25} />
        <MetricPill icon={Hammer} label="Generate" delay={0.5} />
        <MetricPill icon={Eye} label="Customize" delay={0.75} />
        <MetricPill icon={Rocket} label="Deploy" delay={1.0} />
      </div>

      {/* subtle illustration / anchor */}
      {/* <div className="flex items-end justify-end pr-4 pb-4 h-[220px]">
        <div className="relative grid place-items-center rounded-xl border border-neutral-200 bg-white/70 backdrop-blur px-4 py-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-neutral-700" />
            <span className="text-xs font-medium text-neutral-700">example.com</span>
          </div>
          <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[10px] font-semibold text-neutral-700">
            <Rocket className="h-3 w-3" />
            Ready to Publish
          </span>
        </div>
      </div> */}

      <style jsx>{`
        @keyframes sheen {
          0% { transform: translateX(-20%) rotate(12deg); opacity: .6; }
          50% { transform: translateX(40%) rotate(12deg); opacity: .2; }
          100% { transform: translateX(100%) rotate(12deg); opacity: .6; }
        }
        @keyframes popin {
          0% { transform: translateY(6px) scale(.98); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
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

function MenuLink({ href, label }: SimpleLinkProps): JSX.Element {
  return (
    <a href={href} className="block px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 transition">
      {label}
    </a>
  );
}
