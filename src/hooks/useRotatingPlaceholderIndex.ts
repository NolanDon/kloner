"use client";

import { useEffect, useState } from "react";

export function useRotatingPlaceholderIndex({
  enabled,
  length,
  intervalMs = 3200,
}: {
  enabled: boolean;
  length: number;
  intervalMs?: number;
}): number {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (!Number.isFinite(length) || length <= 0) return;

    const t = window.setInterval(() => {
      setIdx((i) => (i + 1) % length);
    }, intervalMs);

    return () => window.clearInterval(t);
  }, [enabled, length, intervalMs]);

  // Keep idx in range if length changes.
  useEffect(() => {
    if (!Number.isFinite(length) || length <= 0) return;
    setIdx((i) => i % length);
  }, [length]);

  return idx;
}
