"use client";

import {
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ArrowRightSquare } from "lucide-react";
import { auth } from "@/lib/firebase";
import {
  getPublicHttpUrlRejectionReason,
  stripProtocol,
  validateAndNormalizePublicHttpUrl,
} from "@/src/lib/publicHttpUrl";

type BlogUrlCtaProps = {
  title: string;
  description: string;
};

export default function BlogUrlCta({ title, description }: BlogUrlCtaProps) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const idBase = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const cleaned = stripProtocol(e.target.value);
    setUrl(cleaned);
    setError(
      cleaned && !validateAndNormalizePublicHttpUrl(cleaned)
        ? getPublicHttpUrlRejectionReason(cleaned) ||
            "Please enter a valid public http(s) URL."
        : null,
    );
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    e.preventDefault();

    const cleaned = stripProtocol(pasted);
    setUrl(cleaned);
    setError(
      !validateAndNormalizePublicHttpUrl(cleaned)
        ? getPublicHttpUrlRejectionReason(cleaned) ||
            "Please enter a valid public http(s) URL."
        : null,
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;

    const stripped = stripProtocol(url);
    const normalized = validateAndNormalizePublicHttpUrl(stripped);

    if (!normalized) {
      setError(
        getPublicHttpUrlRejectionReason(stripped) ||
          "Please enter a valid public http(s) URL.",
      );
      return;
    }

    setError(null);
    setIsSubmitting(true);

    const user = auth.currentUser;
    if (user) {
      router.replace(
        `/dashboard/view?u=${encodeURIComponent(normalized)}&focusUrl=1`,
      );
      return;
    }

    try {
      localStorage.removeItem("kloner.pendingPrompt");
      localStorage.setItem("kloner.pendingUrl", normalized);
    } catch {
      // ignore
    }

    router.push(`/login?mode=signup&u=${encodeURIComponent(normalized)}`);
  }

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-[#FF8D21]/18 bg-[#FF8D21] shadow-sm">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_40%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0))]" />
      <div className="relative px-4 py-4 sm:px-5 sm:py-5">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
            {title}
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-white/70">
            {description}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-4">
          <label className="sr-only" htmlFor={`blog-url-${idBase}`}>
            Website URL
          </label>

          <div className="rounded-full bg-white p-1.5 shadow-[0_14px_30px_rgba(0,0,0,0.10)] ring-1 ring-white/35 backdrop-blur-md">
            <div className="flex items-stretch gap-1.5">
              <div className="flex min-h-[42px] flex-1 items-center rounded-full px-4 sm:px-5">
                <span className="hidden mr-1 text-lg font-medium text-neutral-500 sm:inline">
                  https://
                </span>

                <input
                  id={`blog-url-${idBase}`}
                  value={url}
                  onChange={handleChange}
                  onPaste={handlePaste}
                  placeholder="example.com"
                  inputMode="url"
                  autoCapitalize="none"
                  className="w-full bg-transparent text-base font-medium text-neutral-900 outline-none placeholder:text-neutral-400 sm:text-[17px]"
                  autoComplete="off"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${idBase}-error` : undefined}
                />
              </div>

              <button
                type="submit"
                disabled={!url || !!error || isSubmitting}
                className="inline-flex min-h-[42px] w-11 shrink-0 items-center justify-center rounded-full bg-[#FF8D21] text-white transition-all hover:bg-[#D96E11] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-4"
                aria-label="Clone website from URL"
              >
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2 text-sm font-semibold">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/45 border-t-white" />
                    <span className="hidden sm:inline">Cloning</span>
                  </span>
                ) : (
                  <>
                    <ArrowRightSquare
                      className="h-5 w-5 sm:hidden"
                      aria-hidden
                    />
                    <span className="hidden text-sm font-semibold sm:inline">
                      Clone
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>

          {error ? (
            <div
              id={`${idBase}-error`}
              className="mt-2 text-xs font-medium text-white/90"
              aria-live="polite"
            >
              {error}
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
