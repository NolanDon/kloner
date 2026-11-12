"use client";

import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import { useState } from "react";

const ACCENT = "#FF8D21";

export default function ContactClient(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const submit: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    setMsg("");
    setError("");
    setBusy(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "We couldn’t send your message. Please try again.");
      }
      form.reset();
      setBusy(false);
      setMsg("Your message was sent to Kloner support.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We couldn’t send your message. Please try again.");
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <NavBar />

      <section className="pt-[calc(var(--header-h,56px)+40px)] pb-16 px-6">
        <div className="max-w-lg mx-auto">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Contact</h1>
          <p className="mt-2 text-sm md:text-base text-neutral-600">
            Send a question or report a copyright, privacy, abuse, or illegal-content concern. Reports go to Kloner support.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-neutral-600">Email</label>
              <input
                name="email"
                type="email"
                required
                maxLength={320}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2"
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="contact-category" className="text-xs font-medium text-neutral-600">What is this about?</label>
              <select
                id="contact-category"
                name="category"
                required
                defaultValue="general"
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2"
              >
                <option value="general">General question</option>
                <option value="copyright">Copyright report</option>
                <option value="privacy">Privacy or data request</option>
                <option value="abuse">Abuse or illegal content report</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-neutral-600">Subject <span className="font-normal">(optional)</span></label>
              <input
                name="subject"
                maxLength={160}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2"
                placeholder="Short summary"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-neutral-600">Details</label>
              <textarea
                name="message"
                required
                minLength={10}
                maxLength={8000}
                rows={5}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2 resize-none"
                placeholder="For a rights report, identify the work and the Kloner URL or project involved. For a privacy request, describe the data and action you’re requesting."
              />
            </div>

            <div aria-hidden="true" className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
              <label htmlFor="company-website">Leave this field empty</label>
              <input id="company-website" name="companyWebsite" tabIndex={-1} autoComplete="off" />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {busy ? "Sending…" : "Send message"}
            </button>

            {msg && <p role="status" className="text-sm text-emerald-700 mt-2">{msg}</p>}
            {error && <p role="alert" className="text-sm text-red-700 mt-2">{error}</p>}
          </form>

          <div className="mt-8 text-xs text-neutral-500">
            Do not send passwords, API keys, or other sensitive credentials through this form.
          </div>
          <p className="mt-3 text-xs leading-5 text-neutral-500">
            Formal copyright notices should identify the work, the material you believe infringes it, your contact details, and your good-faith basis for the report. See the{" "}
            <a className="underline underline-offset-2" href="/legal/copyright">Copyright and Abuse Policy</a>.
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
