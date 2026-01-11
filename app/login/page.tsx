// page.tsx (or wherever this wrapper lives)
import type { Metadata } from "next";
import { Suspense } from "react";
import LoginPage from "./LoginForm";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
    title: "Login | Kloner",
    description: "Sign in to Kloner to generate editable previews and manage your projects.",
    alternates: { canonical: "https://kloner.app/login" },
    robots: { index: false, follow: true },
    openGraph: { url: "https://kloner.app/login" },
};

export default function Page() {
    return (
        <>
            <Suspense fallback={null}>
                <LoginPage />
            </Suspense>
            <Footer />
        </>
    );
}
