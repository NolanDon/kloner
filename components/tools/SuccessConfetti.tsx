"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Lottie from "lottie-react";
import { CheckCircle2, X } from "lucide-react";

const CONFETTI_URL = "/lotties/confetti.json";

let confettiAnimationPromise: Promise<any> | null = null;
let confettiAnimationCache: any | null = null;

type SuccessConfettiProps = {
  open: boolean;
  title: string;
  message: string;
  onDismiss: () => void;
};

export function useConfettiAnimation(open: boolean) {
  const [animationData, setAnimationData] = useState<any>(null);
  const [animationError, setAnimationError] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setAnimationError(false);

    if (confettiAnimationCache) {
      setAnimationData(confettiAnimationCache);
      return () => {
        cancelled = true;
      };
    }

    setAnimationData(null);

    if (!confettiAnimationPromise) {
      confettiAnimationPromise = fetch(CONFETTI_URL, { cache: "force-cache" })
        .then((response) => {
          if (!response.ok) {
            throw new Error("missing confetti animation");
          }

          return response.json();
        })
        .then((json) => {
          confettiAnimationCache = json;
          return json;
        })
        .catch((error) => {
          confettiAnimationPromise = null;
          throw error;
        });
    }

    void confettiAnimationPromise
      .then((json) => {
        if (!cancelled) {
          setAnimationData(json);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAnimationError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  return { animationData, animationError };
}

export default function SuccessConfetti({ open, title, message, onDismiss }: SuccessConfettiProps) {
  const { animationData, animationError } = useConfettiAnimation(open);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeout = window.setTimeout(onDismiss, 1900);
    return () => window.clearTimeout(timeout);
  }, [onDismiss, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[26000] pointer-events-none">
      <div className="absolute inset-0 bg-neutral-950/5 backdrop-blur-[1px] simple-fade-in" />

      {animationData && !animationError ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <Lottie animationData={animationData} loop autoplay className="absolute inset-x-0 bottom-[-8%] h-[22rem] opacity-70" />
        </div>
      ) : null}

      <div className="absolute bottom-4 right-4 pointer-events-auto w-[min(22rem,calc(100vw-2rem))] simple-fade-in sm:bottom-6 sm:right-6">
        <div className="relative overflow-hidden rounded-[24px] border border-neutral-200 bg-white shadow-[0_24px_96px_rgba(15,23,42,0.18)]">
          <div className="absolute inset-0 bg-gradient-to-br from-[#fff7f1] via-white to-[#fff0e8]" aria-hidden />
          <div className="relative p-4 sm:p-5">
            <button
              type="button"
              onClick={onDismiss}
              className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-800"
              aria-label="Close success message"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-start gap-3 pr-10">
              <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#FF8D21]">Success</p>
                <h3 className="mt-1 text-base font-semibold text-neutral-900">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-neutral-600">{message}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}