"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const DISMISSAL_KEY = "kloner-moqup-banner-dismissed-until";
const DISMISSAL_DAYS = 30;
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";
const MOQUP_URL =
  "https://moqup.app/?utm_source=kloner&utm_medium=referral&utm_campaign=global_banner";

export default function MoqupReferralBanner() {
  const [visible, setVisible] = useState(true);

  const syncNavbarOffset = useCallback(() => {
    const banner = document.querySelector<HTMLElement>(".moqup-referral-banner");
    const hidden = document.documentElement.dataset.moqupPromoDismissed === "true";
    const offset = !visible || hidden || !banner
      ? 0
      : Math.max(0, Math.ceil(banner.getBoundingClientRect().bottom));
    document.documentElement.style.setProperty("--moqup-banner-offset", `${offset}px`);
  }, [visible]);

  useEffect(() => {
    if (IS_DEVELOPMENT) {
      delete document.documentElement.dataset.moqupPromoDismissed;
      return;
    }

    try {
      const dismissedUntil = Number(window.localStorage.getItem(DISMISSAL_KEY));
      if (Number.isFinite(dismissedUntil) && dismissedUntil > Date.now()) {
        document.documentElement.dataset.moqupPromoDismissed = "true";
        setVisible(false);
      } else {
        window.localStorage.removeItem(DISMISSAL_KEY);
        delete document.documentElement.dataset.moqupPromoDismissed;
      }
    } catch {
      delete document.documentElement.dataset.moqupPromoDismissed;
    }
  }, []);

  useEffect(() => {
    let frame = 0;
    const scheduleSync = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncNavbarOffset();
      });
    };

    syncNavbarOffset();
    window.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync);
    return () => {
      window.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("resize", scheduleSync);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [syncNavbarOffset]);

  const dismiss = () => {
    if (IS_DEVELOPMENT) {
      setVisible(false);
      return;
    }

    const expires = Date.now() + DISMISSAL_DAYS * 24 * 60 * 60 * 1000;
    try {
      window.localStorage.setItem(DISMISSAL_KEY, String(expires));
    } catch {
      // Keep it dismissed for this visit if storage is unavailable.
    }
    document.documentElement.dataset.moqupPromoDismissed = "true";
    document.documentElement.style.setProperty("--moqup-banner-offset", "0px");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <aside className="moqup-referral-banner" aria-label="Discover Moqup">
      <div className="moqup-referral-content">
        <Image
          className="moqup-referral-avatar"
          src="/images/moqup-milo-avatar.webp"
          alt=""
          width={44}
          height={44}
          priority
          aria-hidden="true"
        />
        <div className="moqup-referral-copy">
          <span className="moqup-referral-eyebrow">AI SOCIAL MEDIA MANAGER</span>
          <p>Turn your website URL into a month of on-brand social posts.</p>
        </div>
        <a className="moqup-referral-cta" href={MOQUP_URL} target="_blank" rel="noopener noreferrer">
          Try Moqup <span aria-hidden="true">↗</span>
        </a>
        <button
          className="moqup-referral-dismiss"
          type="button"
          onClick={dismiss}
          aria-label={IS_DEVELOPMENT ? "Close Moqup promotion until reload" : "Dismiss Moqup promotion for 30 days"}
          title={IS_DEVELOPMENT ? "Close until reload" : "Dismiss for 30 days"}
        >
          <X aria-hidden="true" size={15} />
        </button>
      </div>
    </aside>
  );
}
