"use client";

import QRCode from "qrcode";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, X } from "lucide-react";

type QrMode = "text" | "url" | "wifi";

function buttonClass(active = false) {
  return [
    "rounded-full border px-4 py-2 text-sm transition",
    active
      ? "border-[#f55f2a] bg-[#f55f2a] text-white"
      : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50",
  ].join(" ");
}

function safeFilename(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "download";
}

function copyToClipboard(value: string) {
  return navigator.clipboard.writeText(value);
}

function triggerDownload(dataUrl: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function randomFrom<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)]!;
}

function secureRandomInt(max: number) {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0]! % max;
}

function rgbToHex(r: number, g: number, b: number) {
  return [r, g, b]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;
  if (expanded.length !== 6) return { r: 255, g: 95, b: 42 };
  const value = Number.parseInt(expanded, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function capitalizeWords(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function bytesToLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function parseDateParts(value: string) {
  const [year, month, day, hour = "0", minute = "0"] = value.split(/[-T:]/);
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
}

function formatPartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const result: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
  }
  return {
    year: Number(result.year),
    month: Number(result.month),
    day: Number(result.day),
    hour: Number(result.hour),
    minute: Number(result.minute),
    second: Number(result.second),
  };
}

function getZoneOffsetMinutes(date: Date, timeZone: string) {
  const parts = formatPartsInTimeZone(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUtc - date.getTime()) / 60000;
}

function zonedTimeToUtc(input: string, timeZone: string) {
  const parts = parseDateParts(input);
  let utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0));

  for (let i = 0; i < 3; i += 1) {
    const offset = getZoneOffsetMinutes(utcGuess, timeZone);
    const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0) - offset * 60000);
    if (Math.abs(next.getTime() - utcGuess.getTime()) < 1000) {
      utcGuess = next;
      break;
    }
    utcGuess = next;
  }

  return utcGuess;
}

const TOOL_SHOWCASE = [
  {
    title: "Preview in browser",
    body: "Live editable preview rendered from a URL.",
    src: "/images/showcase/showcase1.jpg",
    alt: "Kloner showcase preview 1",
  },
  {
    title: "Edit with AI",
    body: "Prompt-driven updates to layout and copy.",
    src: "/images/showcase/showcase2.jpg",
    alt: "Kloner showcase preview 2",
  },
  {
    title: "Export ready",
    body: "Clean structure and production-minded output.",
    src: "/images/showcase/showcase3.jpg",
    alt: "Kloner showcase preview 3",
  },
  {
    title: "Deploy smoothly",
    body: "Ship to a real hosting environment fast.",
    src: "/images/showcase/showcase4.jpg",
    alt: "Kloner showcase preview 4",
  },
  {
    title: "Full workflow",
    body: "From concept to a polished app shell.",
    src: "/images/showcase/showcase5.jpg",
    alt: "Kloner showcase preview 5",
  },
];

const KLONER_POPUP_HREF = "https://kloner.app/?utm_source=kloner&utm_medium=popup&utm_campaign=tool_promo&utm_content=built_in_tool_popup";

function ToolPromoModal({
  open,
  onDismiss,
  preview,
}: {
  open: boolean;
  onDismiss: () => void;
  preview?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;

    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - html.clientWidth;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.paddingRight = prevBodyPaddingRight;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[26000] simple-fade-in">
      <div
        className="absolute inset-0 bg-white/72 backdrop-blur-[8px] simple-fade-in"
        onMouseDown={(e) => {
          e.preventDefault();
          onDismiss();
        }}
        onClick={onDismiss}
      />

      <div className="relative z-20 flex h-full items-center justify-center px-2 py-2 sm:px-4 sm:py-8 simple-fade-in">
        <div
          className="pointer-events-auto relative flex max-h-[calc(100vh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-neutral-200 bg-white text-neutral-900 shadow-[0_28px_120px_rgba(15,23,42,0.16)] simple-fade-in sm:max-h-[calc(100vh-2rem)] sm:rounded-[28px]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDismiss();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDismiss();
            }}
            className="absolute right-3 top-3 z-30 inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition hover:bg-neutral-50 hover:text-neutral-800 sm:right-4 sm:top-4"
            aria-label="Close prompt"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex-1 overflow-y-auto px-4 pb-4 pt-10 sm:px-8 sm:pb-5 sm:pt-8">
            <div className="flex flex-col items-center text-center">
              <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full border border-amber-100 bg-amber-50 text-[#f55f2a] sm:h-12 sm:w-12">
                <CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>

              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#f55f2a] sm:text-xs sm:tracking-[0.24em]">
                Try Kloner
              </p>
              <h3 className="mt-2 max-w-xl text-[1.55rem] font-normal leading-tight tracking-tight text-neutral-900 sm:text-4xl">
                Create websites and web apps in minutes.
              </h3>
              <p className="mt-3 max-w-xl text-sm leading-5 text-neutral-600 sm:leading-6">
                Kloner helps you turn a URL or idea into a fast, editable website or web app.
                If this tool helped, try the full workflow and launch your own product faster.
              </p>

              {preview ? (
                <div className="mt-4 w-full overflow-hidden rounded-[18px] border border-neutral-200 bg-neutral-50 px-3 py-3 text-left shadow-[0_18px_50px_rgba(15,23,42,0.06)] sm:mt-5 sm:rounded-[24px] sm:px-4 sm:py-4">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500 sm:text-xs sm:tracking-[0.22em]">
                    Your result
                  </div>
                  <div className="max-h-[14rem] overflow-auto rounded-[16px] bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)] sm:max-h-[18rem] sm:rounded-[20px] sm:p-4">
                    {preview}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 w-full overflow-hidden rounded-[18px] bg-white/95 px-3 py-3 shadow-[0_18px_50px_rgba(15,23,42,0.08)] sm:mt-5 sm:rounded-[24px] sm:px-4 sm:py-4">
                <div className="mb-3 text-left text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500 sm:text-xs sm:tracking-[0.22em]">
                  What you can build with Kloner
                </div>
                <div className="overflow-hidden">
                  <div className="website-paywall-carousel flex min-w-max gap-3">
                    {Array.from({ length: 2 }).flatMap((_, rowIndex) =>
                      TOOL_SHOWCASE.map((item, index) => (
                        <div
                          key={`${rowIndex}-${item.title}`}
                          className="w-[160px] shrink-0 rounded-[18px] bg-white p-2 text-left shadow-[0_16px_38px_rgba(15,23,42,0.10)] sm:w-[240px] sm:p-3"
                        >
                          <div className="overflow-hidden rounded-[16px] shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                            <img
                              src={item.src}
                              alt={item.alt}
                              className="h-[104px] w-full object-cover sm:h-[160px]"
                            />
                          </div>
                        </div>
                      )),
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-neutral-200 bg-white px-4 py-4 sm:px-8 sm:py-5">
            <div className="flex w-full flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <a
                href={KLONER_POPUP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full min-w-0 items-center justify-center rounded-full bg-[#f55f2a] px-7 py-3.5 text-base font-semibold text-white shadow-[0_16px_36px_rgba(245,95,42,0.24)] transition hover:bg-[#f3602c] hover:shadow-[0_20px_42px_rgba(245,95,42,0.28)] sm:min-w-[200px]"
              >
                Try Kloner
              </a>
            </div>

            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={onDismiss}
                className="text-sm font-medium text-neutral-500 underline underline-offset-4 decoration-neutral-300 transition hover:text-neutral-700 hover:decoration-neutral-500"
              >
                Keep using this tool
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function QrCodeTool() {
  const [mode, setMode] = useState<QrMode>("url");
  const [text, setText] = useState("https://kloner.app");
  const [ssid, setSsid] = useState("Kloner Guest");
  const [password, setPassword] = useState("guest-access");
  const [security, setSecurity] = useState("WPA");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [status, setStatus] = useState("Ready to generate.");
  const [promoOpen, setPromoOpen] = useState(false);

  const payload = useMemo(() => {
    if (mode === "wifi") {
      const escapedSsid = ssid.replace(/([\\;,:])/g, "\\$1");
      const escapedPassword = password.replace(/([\\;,:])/g, "\\$1");
      return `WIFI:T:${security};S:${escapedSsid};P:${escapedPassword};;`;
    }
    return text.trim();
  }, [mode, password, security, ssid, text]);

  useEffect(() => {
    let isMounted = true;

    if (!payload) {
      setQrDataUrl("");
      setStatus("Enter content to generate a QR code.");
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const next = await QRCode.toDataURL(payload, {
          width: 360,
          margin: 1,
          errorCorrectionLevel: "M",
          color: {
            dark: "#111111",
            light: "#FFFFFF",
          },
        });
        if (isMounted) {
          setQrDataUrl(next);
          setStatus("QR code ready.");
        }
      } catch {
        if (isMounted) {
          setQrDataUrl("");
          setStatus("Could not generate a QR code for this input.");
        }
      }
    }, 120);

    return () => {
      isMounted = false;
      window.clearTimeout(timer);
    };
  }, [payload]);

  const downloadName = safeFilename(mode === "wifi" ? ssid : text.slice(0, 24));
  const promoPreview = qrDataUrl ? (
    <div className="space-y-3">
      <img src={qrDataUrl} alt="Generated QR code" className="mx-auto w-56 max-w-full rounded-3xl border border-neutral-100 bg-white p-3" />
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-left text-xs leading-relaxed text-neutral-600 break-all">
        {payload || "—"}
      </div>
      <div className="sticky bottom-0 mt-1 flex flex-wrap justify-center gap-2 bg-white/95 px-1 py-2 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => triggerDownload(qrDataUrl, `${downloadName || "qr-code"}.png`)}
          className="rounded-full bg-[#f55f2a] px-3 py-1.5 text-sm font-medium text-white"
        >
          Download PNG first
        </button>
        <button
          type="button"
          onClick={() => copyToClipboard(payload)}
          className="rounded-full border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700"
        >
          Copy payload
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] items-start">
      <ToolPromoModal open={promoOpen} onDismiss={() => setPromoOpen(false)} preview={promoPreview} />
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass(mode === "text")} onClick={() => setMode("text")} type="button">Text</button>
          <button className={buttonClass(mode === "url")} onClick={() => setMode("url")} type="button">URL</button>
          <button className={buttonClass(mode === "wifi")} onClick={() => setMode("wifi")} type="button">WiFi</button>
        </div>

        {mode !== "wifi" ? (
          <label className="block space-y-2">
            <span className="text-sm font-medium text-neutral-700">Content</span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={5}
              className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]"
              placeholder={mode === "url" ? "https://example.com" : "Type text to encode"}
            />
          </label>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-2 sm:col-span-2">
              <span className="text-sm font-medium text-neutral-700">WiFi SSID</span>
              <input
                value={ssid}
                onChange={(event) => setSsid(event.target.value)}
                className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-neutral-700">Password</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="text"
                className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-neutral-700">Security</span>
              <select
                value={security}
                onChange={(event) => setSecurity(event.target.value)}
                className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]"
              >
                <option value="WPA">WPA / WPA2</option>
                <option value="WEP">WEP</option>
                <option value="nopass">No password</option>
              </select>
            </label>
          </div>
        )}

        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
          <div className="font-medium text-neutral-900">Encoded payload</div>
          <div className="mt-2 break-all text-xs leading-relaxed text-neutral-600">{payload || "—"}</div>
        </div>

        <p className="text-sm text-neutral-600">{status}</p>
      </div>

      <div className="rounded-[2rem] border border-neutral-200 bg-white p-5 shadow-sm">
        {qrDataUrl ? (
          <div className="space-y-4 text-center">
            <img src={qrDataUrl} alt="Generated QR code" className="mx-auto w-64 max-w-full rounded-3xl border border-neutral-100 bg-white p-3" />
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  triggerDownload(qrDataUrl, `${downloadName || "qr-code"}.png`);
                  setPromoOpen(true);
                }}
                className="rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white"
              >
                Download PNG
              </button>
              <button
                type="button"
                onClick={async () => {
                  await copyToClipboard(payload);
                  setPromoOpen(true);
                }}
                className="rounded-full border border-neutral-200 px-4 py-2 text-sm text-neutral-700"
              >
                Copy payload
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[18rem] items-center justify-center rounded-[1.5rem] border border-dashed border-neutral-200 text-sm text-neutral-500">
            QR preview appears here.
          </div>
        )}
      </div>
    </div>
  );
}

export function PercentageCalculatorTool() {
  const [start, setStart] = useState("100");
  const [end, setEnd] = useState("125");
  const [promoOpen, setPromoOpen] = useState(false);

  const startNumber = Number(start);
  const endNumber = Number(end);

  const difference = Number.isFinite(startNumber) && Number.isFinite(endNumber) ? endNumber - startNumber : NaN;
  const changePercent = startNumber !== 0 && Number.isFinite(startNumber) && Number.isFinite(endNumber)
    ? (difference / startNumber) * 100
    : NaN;
  const reversePercent = endNumber !== 0 && Number.isFinite(startNumber) && Number.isFinite(endNumber)
    ? ((startNumber - endNumber) / endNumber) * 100
    : NaN;
  const percentageDifference = Number.isFinite(startNumber) && Number.isFinite(endNumber) && (Math.abs(startNumber) + Math.abs(endNumber)) !== 0
    ? (Math.abs(difference) / ((Math.abs(startNumber) + Math.abs(endNumber)) / 2)) * 100
    : NaN;

  const format = (value: number) => (Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—");
  const summary = `Change: ${format(changePercent)} · Reverse: ${format(reversePercent)} · Difference: ${format(percentageDifference)}`;
  const promoPreview = (
    <div className="grid gap-3 sm:grid-cols-3">
      {[
        { label: "Percentage change", value: format(changePercent) },
        { label: "Reverse percentage", value: format(reversePercent) },
        { label: "Percentage difference", value: format(percentageDifference) },
      ].map((item) => (
        <div key={item.label} className="rounded-[1.25rem] border border-neutral-200 bg-neutral-50 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">{item.label}</div>
          <div className="mt-2 text-2xl font-semibold text-neutral-900">{item.value}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr] items-start">
      <ToolPromoModal open={promoOpen} onDismiss={() => setPromoOpen(false)} preview={promoPreview} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-neutral-700">Starting number</span>
          <input value={start} onChange={(event) => setStart(event.target.value)} type="number" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]" />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-neutral-700">Ending number</span>
          <input value={end} onChange={(event) => setEnd(event.target.value)} type="number" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]" />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Percentage change", value: format(changePercent) },
          { label: "Reverse percentage", value: format(reversePercent) },
          { label: "Percentage difference", value: format(percentageDifference) },
        ].map((item) => (
          <div key={item.label} className="rounded-[1.5rem] border border-neutral-200 bg-neutral-50 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">{item.label}</div>
            <div className="mt-2 text-2xl font-semibold text-neutral-900">{item.value}</div>
          </div>
        ))}
        <div className="sm:col-span-3 flex justify-end">
          <button
            type="button"
            onClick={async () => {
              await copyToClipboard(summary);
              setPromoOpen(true);
            }}
            className="rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white"
          >
            Copy results
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgeCalculatorTool() {
  const [year, setYear] = useState(2000);
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [promoOpen, setPromoOpen] = useState(false);
  const maxYear = new Date().getFullYear();

  const daysInSelectedMonth = new Date(year, month, 0).getDate();

  useEffect(() => {
    if (day > daysInSelectedMonth) {
      setDay(daysInSelectedMonth);
    }
  }, [day, daysInSelectedMonth]);

  const dob = useMemo(() => {
    const paddedMonth = String(month).padStart(2, "0");
    const paddedDay = String(day).padStart(2, "0");
    return `${year}-${paddedMonth}-${paddedDay}`;
  }, [day, month, year]);

  const age = useMemo(() => {
    if (!dob) return null;
    const birth = new Date(`${dob}T00:00:00`);
    const now = new Date();
    if (Number.isNaN(birth.getTime()) || birth > now) return null;

    let years = now.getFullYear() - birth.getFullYear();
    let months = now.getMonth() - birth.getMonth();
    let days = now.getDate() - birth.getDate();

    if (days < 0) {
      months -= 1;
      const previousMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      days += previousMonth.getDate();
    }

    if (months < 0) {
      years -= 1;
      months += 12;
    }

    return { years, months, days };
  }, [dob]);
  const summary = age ? `Age: ${age.years} years, ${age.months} months, ${age.days} days` : "";
  const promoPreview = age ? (
    <div className="grid gap-3 sm:grid-cols-3">
      {[
        { label: "Years", value: age.years },
        { label: "Months", value: age.months },
        { label: "Days", value: age.days },
      ].map((item) => (
        <div key={item.label} className="rounded-[1.25rem] border border-neutral-200 bg-neutral-50 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">{item.label}</div>
          <div className="mt-2 text-2xl font-semibold text-neutral-900">{item.value}</div>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] items-start">
      <ToolPromoModal open={promoOpen} onDismiss={() => setPromoOpen(false)} preview={promoPreview} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-neutral-700">Year</span>
          <input
            value={year}
            onChange={(event) => setYear(Number(event.target.value) || 2000)}
            type="number"
            min={1900}
            max={maxYear}
            className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-neutral-700">Month</span>
          <select
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
            className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]"
          >
            {[
              "January",
              "February",
              "March",
              "April",
              "May",
              "June",
              "July",
              "August",
              "September",
              "October",
              "November",
              "December",
            ].map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-neutral-700">Day</span>
          <select
            value={day}
            onChange={(event) => setDay(Number(event.target.value))}
            className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]"
          >
            {Array.from({ length: daysInSelectedMonth }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <p className="sm:col-span-3 text-xs text-neutral-500">
          The year starts at 2000 and can be typed directly, so you do not have to scroll a long date picker.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Years", value: age ? age.years : "—" },
          { label: "Months", value: age ? age.months : "—" },
          { label: "Days", value: age ? age.days : "—" },
        ].map((item) => (
          <div key={item.label} className="rounded-[1.5rem] border border-neutral-200 bg-neutral-50 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">{item.label}</div>
            <div className="mt-2 text-2xl font-semibold text-neutral-900">{item.value}</div>
          </div>
        ))}
        <div className="sm:col-span-3 flex justify-end">
          <button
            type="button"
            disabled={!age}
            onClick={async () => {
              if (!summary) return;
              await copyToClipboard(summary);
              setPromoOpen(true);
            }}
            className="rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Copy age
          </button>
        </div>
      </div>
    </div>
  );
}

export function JsonFormatterTool() {
  const [rawJson, setRawJson] = useState('{"name":"Kloner","tools":["qr","json"]}');
  const [copied, setCopied] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);

  const formatted = useMemo(() => {
    try {
      const parsed = JSON.parse(rawJson);
      return { value: JSON.stringify(parsed, null, 2), error: "" };
    } catch (error) {
      return { value: "", error: error instanceof Error ? error.message : "Invalid JSON" };
    }
  }, [rawJson]);
  const promoPreview = formatted.value ? (
    <pre className="max-h-[22rem] overflow-auto rounded-[1.25rem] border border-neutral-200 bg-neutral-950 p-4 text-sm text-neutral-100">
      {formatted.value}
    </pre>
  ) : (
    <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {formatted.error || "Invalid JSON"}
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      <ToolPromoModal open={promoOpen} onDismiss={() => setPromoOpen(false)} preview={promoPreview} />
      <div className="space-y-3">
        <textarea
          value={rawJson}
          onChange={(event) => setRawJson(event.target.value)}
          rows={13}
          className="w-full rounded-[1.5rem] border border-neutral-200 bg-white px-4 py-3 font-mono text-sm outline-none focus:border-[#f55f2a]"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              if (!formatted.value) return;
              await copyToClipboard(formatted.value);
              setCopied(true);
              setPromoOpen(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
            className="rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white"
          >
            {copied ? "Copied" : "Copy formatted JSON"}
          </button>
          <button
            type="button"
            onClick={() => setRawJson('{"name":"Kloner","tools":["qr","json"]}')} 
            className="rounded-full border border-neutral-200 px-4 py-2 text-sm text-neutral-700"
          >
            Reset sample
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <pre className="max-h-[28rem] overflow-auto rounded-[1.5rem] border border-neutral-200 bg-neutral-950 p-4 text-sm text-neutral-100">
{formatted.value || formatted.error}
        </pre>
        <div className="text-sm text-neutral-600">
          {formatted.error ? `Parse error: ${formatted.error}` : "Formatted JSON is ready to copy."}
        </div>
      </div>
    </div>
  );
}

export function PasswordGeneratorTool() {
  const [length, setLength] = useState(16);
  const [includeNumbers, setIncludeNumbers] = useState(true);
  const [includeSymbols, setIncludeSymbols] = useState(true);
  const [password, setPassword] = useState("");
  const [promoOpen, setPromoOpen] = useState(false);

  const buildPassword = () => {
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const numbers = "0123456789";
    const symbols = "!@#$%^&*()-_=+[]{};:,.?/";
    let pool = letters;
    if (includeNumbers) pool += numbers;
    if (includeSymbols) pool += symbols;
    let next = "";
    for (let i = 0; i < length; i += 1) {
      next += pool[secureRandomInt(pool.length)]!;
    }
    return next;
  };

  useEffect(() => {
    setPassword(buildPassword());
  }, [length, includeNumbers, includeSymbols]);

  const strength = useMemo(() => {
    let score = 0;
    if (length >= 12) score += 1;
    if (length >= 16) score += 1;
    if (includeNumbers) score += 1;
    if (includeSymbols) score += 1;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
    return score;
  }, [includeNumbers, includeSymbols, length, password]);
  const promoPreview = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3">
        <div className="min-w-0 flex-1 break-all font-mono text-base text-neutral-900">{password}</div>
        <button type="button" onClick={() => copyToClipboard(password)} className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700">
          Copy
        </button>
      </div>
      <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Strength score {strength}/5</div>
      <div className="h-2 rounded-full bg-neutral-200">
        <div className="h-2 rounded-full bg-[#f55f2a]" style={{ width: `${Math.min((strength / 5) * 100, 100)}%` }} />
      </div>
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr] items-start">
      <ToolPromoModal open={promoOpen} onDismiss={() => setPromoOpen(false)} preview={promoPreview} />
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block space-y-2 sm:col-span-1">
            <span className="text-sm font-medium text-neutral-700">Length</span>
            <input value={length} onChange={(event) => setLength(Number(event.target.value))} type="number" min={8} max={64} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]" />
          </label>
          <label className="flex items-center gap-3 rounded-2xl border border-neutral-200 px-4 py-3 text-sm text-neutral-700">
            <input checked={includeNumbers} onChange={(event) => setIncludeNumbers(event.target.checked)} type="checkbox" />
            Numbers
          </label>
          <label className="flex items-center gap-3 rounded-2xl border border-neutral-200 px-4 py-3 text-sm text-neutral-700">
            <input checked={includeSymbols} onChange={(event) => setIncludeSymbols(event.target.checked)} type="checkbox" />
            Symbols
          </label>
        </div>
        <button type="button" onClick={() => {
          setPassword(buildPassword());
        }} className="rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white">
          Generate password
        </button>
      </div>

      <div className="rounded-[1.75rem] border border-neutral-200 bg-white p-4 shadow-[0_14px_36px_rgba(15,23,42,0.08)]">
        <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">Generated password</div>
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3">
          <div className="min-w-0 flex-1 break-all font-mono text-base text-neutral-900">{password}</div>
          <button
            type="button"
            onClick={async () => {
              await copyToClipboard(password);
              setPromoOpen(true);
            }}
            className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:border-[#f55f2a] hover:text-[#f55f2a]"
          >
            Copy
          </button>
        </div>
        <div className="mt-4 h-2 rounded-full bg-neutral-200">
          <div className="h-2 rounded-full bg-[#f55f2a]" style={{ width: `${Math.min((strength / 5) * 100, 100)}%` }} />
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.18em] text-neutral-500">Strength score {strength}/5</div>
      </div>
    </div>
  );
}

export function ImageResizerTool() {
  const [file, setFile] = useState<File | null>(null);
  const [width, setWidth] = useState(1200);
  const [height, setHeight] = useState(1200);
  const [quality, setQuality] = useState(0.82);
  const [format, setFormat] = useState<"image/jpeg" | "image/webp" | "image/png">("image/webp");
  const [maintainAspectRatio, setMaintainAspectRatio] = useState(true);
  const [originalSize, setOriginalSize] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [resultSize, setResultSize] = useState("");
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [originalDimensions, setOriginalDimensions] = useState<{ width: number; height: number } | null>(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const originalObjectUrl = useRef("");

  useEffect(() => {
    if (!file) {
      setOriginalDimensions(null);
      return;
    }

    const url = URL.createObjectURL(file);
    let cancelled = false;

    const image = new Image();
    image.src = url;
    image
      .decode()
      .then(() => {
        if (cancelled) return;
        setOriginalDimensions({ width: image.naturalWidth, height: image.naturalHeight });
      })
      .catch(() => {
        if (!cancelled) setOriginalDimensions(null);
      })
      .finally(() => {
        URL.revokeObjectURL(url);
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => {
    if (!maintainAspectRatio || !originalDimensions) return;
    const derivedHeight = Math.max(1, Math.round((width / originalDimensions.width) * originalDimensions.height));
    setHeight(derivedHeight);
  }, [maintainAspectRatio, originalDimensions, width]);

  useEffect(() => {
    return () => {
      if (originalObjectUrl.current) URL.revokeObjectURL(originalObjectUrl.current);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  const processFile = async () => {
    if (!file) return;
    const imageUrl = URL.createObjectURL(file);
    originalObjectUrl.current = imageUrl;
    const image = new Image();
    image.src = imageUrl;
    await image.decode();

    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    const targetWidth = Math.max(1, Math.min(width, naturalWidth));
    const targetHeight = maintainAspectRatio
      ? Math.max(1, Math.round((targetWidth / naturalWidth) * naturalHeight))
      : Math.max(1, height);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    if (resultUrl) URL.revokeObjectURL(resultUrl);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format, quality));
    if (!blob) return;

    const nextUrl = URL.createObjectURL(blob);
    setResultUrl(nextUrl);
    setResultSize(bytesToLabel(blob.size));
    setDimensions({ width: targetWidth, height: targetHeight });
    setOriginalSize(bytesToLabel(file.size));
  };
  const promoPreview = resultUrl ? (
    <div className="space-y-3">
      <img src={resultUrl} alt="Resized image preview" className="max-h-80 w-full rounded-3xl border border-neutral-100 object-contain bg-neutral-50" />
      <div className="grid gap-2 text-sm text-neutral-600 sm:grid-cols-2">
        <div>Original size: <span className="font-medium text-neutral-900">{originalSize || "—"}</span></div>
        <div>Output size: <span className="font-medium text-neutral-900">{resultSize || "—"}</span></div>
        <div className="sm:col-span-2">Output dimensions: <span className="font-medium text-neutral-900">{dimensions ? `${dimensions.width} × ${dimensions.height}` : "—"}</span></div>
      </div>
      <button type="button" onClick={() => triggerDownload(resultUrl, `resized-${file?.name || "image"}`)} className="rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white">
        Download result first
      </button>
    </div>
  ) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] items-start">
      <ToolPromoModal open={promoOpen} onDismiss={() => setPromoOpen(false)} preview={promoPreview} />
      <div className="space-y-4">
        <input
          type="file"
          accept="image/*"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="block w-full text-sm text-neutral-700 file:mr-4 file:rounded-full file:border-0 file:bg-[#f55f2a] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-neutral-700">Width</span>
            <input value={width} onChange={(event) => setWidth(Number(event.target.value) || 1)} type="number" min={1} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]" />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-neutral-700">Height</span>
            <input
              value={height}
              onChange={(event) => setHeight(Number(event.target.value) || 1)}
              type="number"
              min={1}
              disabled={maintainAspectRatio}
              className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a] disabled:bg-neutral-100 disabled:text-neutral-500"
            />
          </label>
          <label className="block space-y-2 sm:col-span-2">
            <span className="text-sm font-medium text-neutral-700">Format</span>
            <select value={format} onChange={(event) => setFormat(event.target.value as typeof format)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]">
              <option value="image/webp">WebP</option>
              <option value="image/jpeg">JPEG</option>
              <option value="image/png">PNG</option>
            </select>
          </label>
        </div>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-neutral-700">Quality {(quality * 100).toFixed(0)}%</span>
          <input value={quality} onChange={(event) => setQuality(Number(event.target.value))} type="range" min={0.3} max={1} step={0.01} className="w-full" />
        </label>
        <label className="flex items-center gap-3 rounded-2xl border border-neutral-200 px-4 py-3 text-sm text-neutral-700">
          <input checked={maintainAspectRatio} onChange={(event) => setMaintainAspectRatio(event.target.checked)} type="checkbox" />
          Maintain aspect ratio
        </label>
        <p className="text-xs text-neutral-500">
          When aspect ratio is locked, height is calculated automatically from width.
        </p>
        <button type="button" onClick={processFile} disabled={!file} className="rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Resize image
        </button>
      </div>

      <div className="space-y-4 rounded-[1.75rem] border border-neutral-200 bg-white p-4">
        <div className="grid gap-4 sm:grid-cols-2 text-sm text-neutral-600">
          <div>Original size: <span className="font-medium text-neutral-900">{originalSize || "—"}</span></div>
          <div>Output size: <span className="font-medium text-neutral-900">{resultSize || "—"}</span></div>
          <div>Output dimensions: <span className="font-medium text-neutral-900">{dimensions ? `${dimensions.width} × ${dimensions.height}` : "—"}</span></div>
        </div>
        {resultUrl ? (
          <div className="space-y-3">
            <img src={resultUrl} alt="Resized image preview" className="max-h-80 w-full rounded-3xl border border-neutral-100 object-contain bg-neutral-50" />
            <button type="button" onClick={() => {
              triggerDownload(resultUrl, `resized-${file?.name || "image"}`);
              setPromoOpen(true);
            }} className="inline-flex rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white">
              Download result
            </button>
          </div>
        ) : (
          <div className="flex min-h-[18rem] items-center justify-center rounded-[1.5rem] border border-dashed border-neutral-200 text-sm text-neutral-500">
            Upload an image to preview the resized output.
          </div>
        )}
      </div>
    </div>
  );
}

export function TextCaseConverterTool() {
  const [text, setText] = useState("Build tools like this with Kloner.");
  const [promoOpen, setPromoOpen] = useState(false);

  const variants = [
    { label: "Uppercase", value: text.toUpperCase() },
    { label: "Lowercase", value: text.toLowerCase() },
    { label: "Capitalized", value: capitalizeWords(text) },
  ];
  const promoPreview = (
    <div className="grid gap-3">
      {variants.map((variant) => (
        <div key={variant.label} className="rounded-[1.25rem] border border-neutral-200 bg-neutral-50 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">{variant.label}</div>
          <div className="mt-2 break-words text-base text-neutral-900">{variant.value}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr] items-start">
      <ToolPromoModal open={promoOpen} onDismiss={() => setPromoOpen(false)} preview={promoPreview} />
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={8}
        className="w-full rounded-[1.5rem] border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]"
      />
      <div className="grid gap-3">
        {variants.map((variant) => (
          <div key={variant.label} className="rounded-[1.5rem] border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">{variant.label}</div>
              <button type="button" onClick={async () => {
                await copyToClipboard(variant.value);
                setPromoOpen(true);
              }} className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700">Copy</button>
            </div>
            <div className="mt-3 break-words text-base text-neutral-900">{variant.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const ADJECTIVES = ["swift", "bright", "quiet", "solar", "urban", "wild", "neon", "steady", "future", "velvet"];
const NOUNS = ["fox", "atlas", "signal", "pilot", "orbit", "canvas", "pixel", "spark", "drift", "cloud"];
const STYLES = {
  cool: ["nova", "pulse", "glow", "flare", "echo"],
  pro: ["studio", "stack", "labs", "works", "hq"],
  gamer: ["raid", "quest", "byte", "shadow", "storm"],
} as const;

export function UsernameGeneratorTool() {
  const [seed, setSeed] = useState("kloner");
  const [count, setCount] = useState(8);
  const [style, setStyle] = useState<keyof typeof STYLES>("cool");
  const [includeNumbers, setIncludeNumbers] = useState(true);
  const [results, setResults] = useState<string[]>([]);
  const [promoOpen, setPromoOpen] = useState(false);

  const buildUsernames = () => {
    const seen = new Set<string>();
    const items: string[] = [];
    const base = seed.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    while (items.length < count) {
      const adjective = randomFrom(ADJECTIVES);
      const noun = randomFrom(NOUNS);
      const styleWord = randomFrom(STYLES[style]);
      const number = includeNumbers ? secureRandomInt(9999).toString().padStart(2, "0") : "";
      const pieces = [base || adjective, styleWord, noun, number].filter(Boolean);
      const candidate = pieces.join("").slice(0, 24);
      if (!seen.has(candidate)) {
        seen.add(candidate);
        items.push(candidate);
      }
    }
    return items;
  };

  useEffect(() => {
    setResults(buildUsernames());
  }, [count, includeNumbers, style, seed]);
  const promoPreview = (
    <div className="grid gap-2 sm:grid-cols-2">
      {results.map((item) => (
        <button key={item} type="button" onClick={() => copyToClipboard(item)} className="rounded-[1.25rem] border border-neutral-200 bg-neutral-50 px-4 py-3 text-left text-sm text-neutral-800 hover:border-[#f55f2a]">
          {item}
        </button>
      ))}
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] items-start">
      <ToolPromoModal open={promoOpen} onDismiss={() => setPromoOpen(false)} preview={promoPreview} />
      <div className="space-y-4">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-neutral-700">Seed keyword</span>
          <input value={seed} onChange={(event) => setSeed(event.target.value)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]" />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-neutral-700">Count</span>
            <input value={count} onChange={(event) => setCount(Number(event.target.value))} type="number" min={3} max={20} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]" />
          </label>
          <label className="block space-y-2 sm:col-span-2">
            <span className="text-sm font-medium text-neutral-700">Style</span>
            <select value={style} onChange={(event) => setStyle(event.target.value as keyof typeof STYLES)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]">
              <option value="cool">Cool</option>
              <option value="pro">Professional</option>
              <option value="gamer">Gaming</option>
            </select>
          </label>
        </div>
        <label className="flex items-center gap-3 rounded-2xl border border-neutral-200 px-4 py-3 text-sm text-neutral-700">
          <input checked={includeNumbers} onChange={(event) => setIncludeNumbers(event.target.checked)} type="checkbox" />
          Include numbers
        </label>
        <button type="button" onClick={() => {
          setResults(buildUsernames());
        }} className="rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white">
          Generate usernames
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {results.map((item) => (
          <button key={item} type="button" onClick={async () => {
            await copyToClipboard(item);
            setPromoOpen(true);
          }} className="rounded-[1.25rem] border border-neutral-200 bg-neutral-50 px-4 py-3 text-left text-sm text-neutral-800 hover:border-[#f55f2a]">
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ColorPickerTool() {
  const [hex, setHex] = useState("#f55f2a");
  const rgb = useMemo(() => hexToRgb(hex), [hex]);
  const [r, setR] = useState(rgb.r);
  const [g, setG] = useState(rgb.g);
  const [b, setB] = useState(rgb.b);
  const [promoOpen, setPromoOpen] = useState(false);

  useEffect(() => {
    const next = hexToRgb(hex);
    setR(next.r);
    setG(next.g);
    setB(next.b);
  }, [hex]);

  useEffect(() => {
    setHex(`#${rgbToHex(r, g, b)}`.toLowerCase());
  }, [r, g, b]);

  const rgbLabel = `rgb(${r}, ${g}, ${b})`;
  const promoPreview = (
    <div className="space-y-3">
      <div className="h-24 rounded-[1.25rem] border border-white/50 shadow-inner" style={{ background: hex }} />
      <div className="grid gap-2 sm:grid-cols-2 text-sm">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">HEX</div>
          <div className="mt-2 font-mono text-lg text-neutral-900">{hex}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">RGB</div>
          <div className="mt-2 font-mono text-lg text-neutral-900">{rgbLabel}</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] items-start">
      <ToolPromoModal open={promoOpen} onDismiss={() => setPromoOpen(false)} preview={promoPreview} />
      <div className="space-y-4">
        <input type="color" value={hex} onChange={(event) => setHex(event.target.value)} className="h-20 w-full cursor-pointer rounded-[1.5rem] border border-neutral-200 bg-white p-2" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "R", value: r, set: setR },
            { label: "G", value: g, set: setG },
            { label: "B", value: b, set: setB },
          ].map((item) => (
            <label key={item.label} className="block space-y-2">
              <span className="text-sm font-medium text-neutral-700">{item.label}</span>
              <input type="number" min={0} max={255} value={item.value} onChange={(event) => item.set(Number(event.target.value))} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]" />
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-4 rounded-[1.75rem] border border-neutral-200 bg-neutral-50 p-4">
        <div className="h-32 rounded-[1.5rem] border border-white/50 shadow-inner" style={{ background: hex }} />
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">HEX</div>
            <div className="mt-2 font-mono text-lg text-neutral-900">{hex}</div>
            <button type="button" onClick={async () => {
              await copyToClipboard(hex);
              setPromoOpen(true);
            }} className="mt-3 rounded-full border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700">Copy</button>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-neutral-500">RGB</div>
            <div className="mt-2 font-mono text-lg text-neutral-900">{rgbLabel}</div>
            <button type="button" onClick={async () => {
              await copyToClipboard(rgbLabel);
              setPromoOpen(true);
            }} className="mt-3 rounded-full border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700">Copy</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const TIMEZONES = [
  ["London", "Europe/London"],
  ["New York", "America/New_York"],
  ["Los Angeles", "America/Los_Angeles"],
  ["Berlin", "Europe/Berlin"],
  ["Dubai", "Asia/Dubai"],
  ["Mumbai", "Asia/Kolkata"],
  ["Singapore", "Asia/Singapore"],
  ["Tokyo", "Asia/Tokyo"],
  ["Sydney", "Australia/Sydney"],
  ["São Paulo", "America/Sao_Paulo"],
] as const;

export function TimeZoneConverterTool() {
  const defaultSourceZone = TIMEZONES[0]![1];
  const defaultTargetZone = TIMEZONES[1]![1];
  const [sourceZone, setSourceZone] = useState<string>(defaultSourceZone);
  const [targetZone, setTargetZone] = useState<string>(defaultTargetZone);
  const [sourceTime, setSourceTime] = useState(() => {
    const now = new Date();
    return now.toISOString().slice(0, 16);
  });
  const [promoOpen, setPromoOpen] = useState(false);

  const converted = useMemo(() => {
    if (!sourceTime) return null;
    const utcDate = zonedTimeToUtc(sourceTime, sourceZone);
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: targetZone,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(utcDate);

    const sourceParts = formatPartsInTimeZone(utcDate, sourceZone);
    const targetParts = formatPartsInTimeZone(utcDate, targetZone);

    return {
      formatted,
      sourceLabel: `${sourceParts.year}-${String(sourceParts.month).padStart(2, "0")}-${String(sourceParts.day).padStart(2, "0")} ${String(sourceParts.hour).padStart(2, "0")}:${String(sourceParts.minute).padStart(2, "0")}`,
      targetLabel: `${targetParts.year}-${String(targetParts.month).padStart(2, "0")}-${String(targetParts.day).padStart(2, "0")} ${String(targetParts.hour).padStart(2, "0")}:${String(targetParts.minute).padStart(2, "0")}`,
    };
  }, [sourceTime, sourceZone, targetZone]);
  const promoPreview = converted ? (
    <div className="space-y-3 rounded-[1.25rem] border border-neutral-200 bg-neutral-50 p-4">
      <div className="text-2xl font-semibold text-neutral-900">{converted.formatted}</div>
      <div className="grid gap-2 text-sm text-neutral-600">
        <div>Source wall time: <span className="font-medium text-neutral-900">{converted.sourceLabel}</span></div>
        <div>Target wall time: <span className="font-medium text-neutral-900">{converted.targetLabel}</span></div>
      </div>
    </div>
  ) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr] items-start">
      <ToolPromoModal open={promoOpen} onDismiss={() => setPromoOpen(false)} preview={promoPreview} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-2 sm:col-span-2">
          <span className="text-sm font-medium text-neutral-700">Source date and time</span>
          <input value={sourceTime} onChange={(event) => setSourceTime(event.target.value)} type="datetime-local" className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]" />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-neutral-700">From</span>
          <select value={sourceZone} onChange={(event) => setSourceZone(event.target.value)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]">
            {TIMEZONES.map(([label, value]) => <option key={value} value={value}>{label} ({value})</option>)}
          </select>
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-neutral-700">To</span>
          <select value={targetZone} onChange={(event) => setTargetZone(event.target.value)} className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#f55f2a]">
            {TIMEZONES.map(([label, value]) => <option key={value} value={value}>{label} ({value})</option>)}
          </select>
        </label>
      </div>

      <div className="rounded-[1.75rem] border border-neutral-200 bg-neutral-50 p-5">
        <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Converted time</div>
        <div className="mt-3 text-2xl font-semibold text-neutral-900">{converted?.formatted || "—"}</div>
        <div className="mt-4 grid gap-2 text-sm text-neutral-600">
          <div>Source wall time: <span className="font-medium text-neutral-900">{converted?.sourceLabel || "—"}</span></div>
          <div>Target wall time: <span className="font-medium text-neutral-900">{converted?.targetLabel || "—"}</span></div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={!converted}
            onClick={async () => {
              if (!converted) return;
              await copyToClipboard(`${converted.sourceLabel} → ${converted.targetLabel} (${converted.formatted})`);
              setPromoOpen(true);
            }}
            className="rounded-full bg-[#f55f2a] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Copy converted time
          </button>
        </div>
      </div>
    </div>
  );
}
