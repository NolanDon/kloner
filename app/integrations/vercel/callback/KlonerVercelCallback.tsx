// app/integrations/vercel/callback/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import NavBar from "@/components/NavBar";

const ACCENT = "#f55f2a";

type State = "pending" | "ok" | "error";

export default function KlonerVercelCallback() {
    const search = useSearchParams();
    const [state, setState] = useState<State>("pending");
    const [message, setMessage] = useState<string>("Linking your Vercel installation…");

    useEffect(() => {
        const configurationId = search.get("configurationId");
        const teamId = search.get("teamId");
        const projectId = search.get("projectId");

        if (!configurationId) {
            setState("error");
            setMessage("Missing configurationId. Open this page only from the Vercel integration flow.");
            return;
        }

        // TODO: call your backend to persist configurationId + teamId + projectId if needed.
        // Example:
        //
        // fetch("/api/vercel/integration/complete", {
        //   method: "POST",
        //   headers: { "content-type": "application/json" },
        //   credentials: "include",
        //   body: JSON.stringify({ configurationId, teamId, projectId }),
        // })
        //   .then(r => r.ok ? r.json() : Promise.reject(r))
        //   .then(() => { setState("ok"); setMessage("Vercel is now connected to Kloner."); })
        //   .catch(() => { setState("error"); setMessage("Failed to store the integration configuration."); });

        // Placeholder happy-path so the page renders sensibly before backend wiring:
        setTimeout(() => {
            setState("ok");
            setMessage("Vercel is now connected to Kloner. You can close this page and return to the dashboard.");
        }, 400);
    }, [search]);

    const configurationId = search.get("configurationId") || "";
    const teamId = search.get("teamId") || "";
    const projectId = search.get("projectId") || "";

    return (
        <>
            <NavBar />
            <main className="min-h-screen bg-white py-[120px]">
                <div className="mx-auto max-w-xl px-4 sm:px-6 lg:px-10 py-10">
                    <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-800 mb-4">
                        Finalizing your Vercel connection
                    </h1>

                    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm space-y-3">
                        <Status state={state} message={message} />

                        <div className="mt-3 space-y-1 text-xs text-neutral-600">
                            <p>Details provided by Vercel:</p>
                            {configurationId && (
                                <div>
                                    <span className="font-semibold text-neutral-800">Configuration ID:</span>{" "}
                                    <span className="font-mono text-[11px] break-all">{configurationId}</span>
                                </div>
                            )}
                            {teamId && (
                                <div>
                                    <span className="font-semibold text-neutral-800">Team ID:</span>{" "}
                                    <span className="font-mono text-[11px] break-all">{teamId}</span>
                                </div>
                            )}
                            {projectId && (
                                <div>
                                    <span className="font-semibold text-neutral-800">Default project ID:</span>{" "}
                                    <span className="font-mono text-[11px] break-all">{projectId}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </>
    );
}

function Status({ state, message }: { state: State; message: string }) {
    if (state === "pending") {
        return (
            <div className="flex items-center gap-2 text-sm text-neutral-800">
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: ACCENT }} />
                <span>{message}</span>
            </div>
        );
    }
    if (state === "ok") {
        return (
            <div className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>{message}</span>
            </div>
        );
    }
    return (
        <div className="flex items-center gap-2 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <span>{message}</span>
        </div>
    );
}
