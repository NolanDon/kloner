// page.tsx (or wherever this wrapper lives)
import type { Metadata } from "next";
import { Suspense } from "react";
import LoginPage from "./LoginForm";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
    title: "Login",
    description: "Sign in to Kloner to generate editable previews and manage your projects.",
    alternates: { canonical: "https://kloner.app/login" },
    robots: { index: false, follow: true },
    openGraph: { url: "https://kloner.app/login" },
};

export default function Page() {
    return (
        <>
            <main className="min-h-[100dvh] bg-white text-black px-4 sm:px-6 pt-6 pb-10 sm:pt-10 sm:pb-12 md:pt-14 md:pb-16 flex items-start md:items-center justify-center">
                <div className="w-full max-w-md">
                    <Suspense fallback={null}>
                        <LoginPage />
                    </Suspense>
                </div>
            </main>
            <Footer />
        </>
    );
}
