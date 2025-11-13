// app/integrations/vercel/callback/page.tsx

export default function VercelIntegrationCallbackPage() {
    return (
        <main className="min-h-screen flex items-center justify-center bg-black text-white px-4">
            <div className="max-w-md text-center">
                <h1 className="text-2xl font-semibold mb-3">
                    Finalizing your Vercel connection
                </h1>
                <p className="text-sm text-neutral-300">
                    Your Vercel account is now connected to Kloner.
                    You can close this tab and return to your dashboard.
                </p>
            </div>
        </main>
    );
}
