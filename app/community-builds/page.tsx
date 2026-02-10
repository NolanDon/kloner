// src/app/community-builds/page.tsx
import type { Metadata } from "next";
import CommunityBuildsClient from "./CommunityBuildsClient";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import Image from "next/image";
import logo from "@/public/images/orange_logo.png";

export const metadata: Metadata = {
    title: "Community builds",
    description:
        "Browse approved Kloner community builds, preview live layouts, and remix approved projects shared by other creators.",
    alternates: {
        canonical: "https://kloner.app/community-builds",
    },
    openGraph: {
        url: "https://kloner.app/community-builds",
    },
};

export default function CommunityBuildsPage() {
    return (
        <main className="min-h-screen bg-white text-black">
            <NavBar />
            <section className="bg-white text-black mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 pt-20">
                <header className="mb-12 flex flex-col items-center text-center gap-3">
                    <div className="mt-2 flex items-center justify-center gap-4 pt-10">
                        <span className="text-[13px] uppercase tracking-[0.1em] text-neutral-500">
                            <h1>See what the community has built with</h1>
                        </span>
                        <span className="relative inline-block h-[90px] w-[90px] sm:h-[120px] sm:w-[120px]">
                            <Image
                                src={logo}
                                alt="Kloner logo"
                                fill
                                sizes="(max-width: 640px) 90px, 120px"
                                className="object-contain"
                            />
                        </span>
                    </div>
                </header>

                <div className="flex flex-col gap-1 text-left">
                    <div className="flex flex-col gap-1">
                   
                        <p className="text-[11px] uppercase tracking-[0.24em] text-black/45">
                            Featured builds
                        </p>
                        <p className="max-w-xl text-sm text-black/65 mt-3 mb-6">
                            Scroll through approved layouts, open an interactive preview, or
                            remix a project into your own Kloner workspace.
                        </p>
                    </div>
                </div>
                <div className="container pt-2 pb-20">
                    <CommunityBuildsClient />
                </div>
            </section>

            {/* Crawlable internal links + consistent navigation */}
            <Footer />
        </main>
    );
}