"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "kloner-theme";
const THEME_CHANGE_EVENT = "kloner:theme-change";

function readTheme(): "light" | "dark" {
  const rootTheme = document.documentElement.dataset.theme;
  if (rootTheme === "dark" || rootTheme === "light") return rootTheme;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // Keep the app's dark default when storage is unavailable.
  }
  return "dark";
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
}

export default function ThemeToggle({
  className = "",
  variant = "icon",
}: {
  className?: string;
  variant?: "icon" | "switch";
}) {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const syncTheme = () => setTheme(readTheme());
    syncTheme();
    window.addEventListener(THEME_CHANGE_EVENT, syncTheme);
    window.addEventListener("storage", syncTheme);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
      window.removeEventListener("storage", syncTheme);
    };
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  const Icon = variant === "switch"
    ? (theme === "dark" ? Moon : Sun)
    : (theme === "dark" ? Sun : Moon);

  if (variant === "switch") {
    const isDark = theme === "dark";
    return (
      <button
        type="button"
        onClick={toggleTheme}
        role="switch"
        aria-checked={isDark}
        aria-label="Darkmode"
        title={isDark ? "Darkmode on" : "Darkmode off"}
        className={`dashboard-sidebar-item flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8D21] ${className}`}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-neutral-200 bg-white text-neutral-700 darkmode-sidebar-icon" aria-hidden="true">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="truncate">Darkmode</span>
        <span className={`darkmode-switch-track ml-auto inline-flex h-6 w-11 shrink-0 items-center rounded-full p-[3px] ${isDark ? "is-on" : ""}`} aria-hidden="true">
          <span className={`darkmode-switch-thumb flex h-[18px] w-[18px] items-center justify-center rounded-full shadow-sm transition-transform ${isDark ? "translate-x-[20px]" : "translate-x-0"}`}>
            <Icon className="darkmode-switch-icon h-3 w-3" />
          </span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-current/15 text-current transition hover:bg-current/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8D21] ${className}`}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  );
}
