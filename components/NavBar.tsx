
"use client";
import Link from "next/link";
import { brand } from "@/lib/config";
import { useEffect, useState } from "react";

export default function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on(); window.addEventListener("scroll", on);
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <div className="fixed top-4 left-0 right-0 z-50">
      <div className="container-soft">
        <div className={`flex items-center gap-6 px-5 py-2 rounded-pill shadow-pill border
          ${scrolled ? "bg-smoke/80 border-white/10 backdrop-blur" : "bg-smoke/60 border-white/10 backdrop-blur"}`}>
          <Link href="/" className="font-black tracking-tight text-xl">
            <span className="bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">super</span>
            <span className="text-white/80">power</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-white/80">
            {brand.nav.map(i => (
              <a key={i.label} href={i.href} className="hover:text-white transition">{i.label}</a>
            ))}
            <span className="opacity-30">|</span>
            <a href="#login" className="hover:text-white transition">Login</a>
          </nav>
          <div className="ml-auto">
            <a href={brand.cta.href} className="inline-flex items-center gap-2 rounded-full px-4 py-2 bg-accent hover:bg-accent2 transition">
              {brand.cta.label}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
