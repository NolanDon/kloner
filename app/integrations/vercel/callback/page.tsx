// app/integrations/vercel/callback/page.tsx
import { Suspense } from "react";
import { VercelIntegrationCallbackClient } from "./VercelIntegrationCallbackClient";

export const dynamic = "force-dynamic";

export default function VercelIntegrationCallbackPage() {
    return (
        <Suspense
            fallback={
                <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
                    <div className="max-w-md w-full text-center space-y-3">
                        <p className="text-[11px] font-semibold tracking-[0.25em] uppercase text-zinc-400">
                            Vercel integration
                        </p>
                        <h1 className="text-xl font-semibold tracking-tight">
                            Finishing connection…
                        </h1>
                        <p className="text-sm text-zinc-300/90 leading-relaxed">
                            Redirecting you back to your Kloner dashboard.
                        </p>
                    </div>
                </main>
            }
        >
            <VercelIntegrationCallbackClient />
        </Suspense>
    );
}
