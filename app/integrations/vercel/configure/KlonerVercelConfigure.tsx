// app/integrations/vercel/configure/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ToggleLeft, ToggleRight, Save, Info } from "lucide-react";
import NavBar from "@/components/NavBar";

const ACCENT = "#f55f2a";

export default function KlonerVercelConfigure() {
    const search = useSearchParams();
    const configurationId = search.get("configurationId") || "";
    const teamId = search.get("teamId") || "";

    const [autoProject, setAutoProject] = useState(true);
    const [manageEnv, setManageEnv] = useState(false);
    const [attachDomains, setAttachDomains] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        setSaved(false);
        try {
            // TODO: send these preferences to your backend.
            // await fetch("/api/vercel/integration/preferences", { ... });
            await new Promise((r) => setTimeout(r, 400));
            setSaved(true);
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <NavBar />
            <main className="min-h-screen bg-white py-[120px]">
                <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-10 py-10 space-y-8">
                    <header className="space-y-2">
                        <p className="text-xs font-semibold tracking-[0.18em] text-neutral-500 uppercase">
                            Configuration • Kloner + Vercel
                        </p>
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-800">
                            Configure how Kloner deploys to Vercel
                        </h1>
                        <p className="text-sm text-neutral-600">
                            These options apply only to this Vercel integration configuration. You can change them
                            later from this page.
                        </p>
                    </header>

                    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm text-xs text-neutral-600 space-y-1">
                        <p>
                            <span className="font-semibold text-neutral-800">Configuration ID:</span>{" "}
                            <span className="font-mono text-[11px] break-all">{configurationId || "not provided"}</span>
                        </p>
                        <p>
                            <span className="font-semibold text-neutral-800">Team ID:</span>{" "}
                            <span className="font-mono text-[11px] break-all">{teamId || "not provided"}</span>
                        </p>
                    </section>

                    <section className="space-y-4">
                        <SettingRow
                            label="Automatically create a new Vercel project when I deploy from Kloner"
                            description="If disabled, Kloner will ask you to choose an existing Vercel project before deploying."
                            enabled={autoProject}
                            onToggle={() => setAutoProject((v) => !v)}
                        />
                        <SettingRow
                            label="Allow Kloner to manage project environment variables"
                            description="Let Kloner create and update environment variables required for your cloned project."
                            enabled={manageEnv}
                            onToggle={() => setManageEnv((v) => !v)}
                        />
                        <SettingRow
                            label="Allow Kloner to attach domains to created projects"
                            description="If enabled, Kloner can attach a domain you own in Vercel to the project it creates."
                            enabled={attachDomains}
                            onToggle={() => setAttachDomains((v) => !v)}
                        />
                    </section>

                    <section className="space-y-3">
                        <div className="flex items-center gap-2 text-xs text-neutral-600">
                            <Info className="h-4 w-4 text-neutral-500" />
                            <p>
                                Preferences here do not change your Vercel billing or limits. They only control how
                                Kloner behaves when you trigger a deploy from the Kloner dashboard.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                            style={{ background: ACCENT }}
                        >
                            <Save className="h-4 w-4" />
                            {saving ? "Saving…" : "Save configuration"}
                        </button>

                        {saved && (
                            <p className="text-xs text-emerald-700 pt-1">
                                Preferences saved for this configuration. You can safely close this page.
                            </p>
                        )}
                    </section>
                </div>
            </main>
        </>

    );
}

function SettingRow({
    label,
    description,
    enabled,
    onToggle,
}: {
    label: string;
    description: string;
    enabled: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
                <button
                    type="button"
                    onClick={onToggle}
                    className="mt-0.5 inline-flex h-7 w-11 items-center justify-center rounded-full border border-neutral-300 bg-neutral-50"
                    aria-pressed={enabled}
                >
                    {enabled ? (
                        <ToggleRight className="h-5 w-5" style={{ color: ACCENT }} />
                    ) : (
                        <ToggleLeft className="h-5 w-5 text-neutral-400" />
                    )}
                </button>
                <div className="space-y-1">
                    <p className="text-sm font-semibold text-neutral-800">{label}</p>
                    <p className="text-xs text-neutral-600">{description}</p>
                </div>
            </div>
        </div>
    );
}
