// src/app/community-builds/page.tsx
import type { Metadata } from "next";
import CommunityBuildsClient from "./CommunityBuildsClient";
import NavBar from "@/components/NavBar";
import Image from "next/image";
import logo from "@/public/images/orange_logo.png";

export const metadata: Metadata = {
    title: "Community builds | Kloner",
    description:
        "Browse approved Kloner community builds, preview live layouts, and remix approved projects shared by other creators.",
};

export default function CommunityBuildsPage() {
    return (
        <main className="min-h-screen bg-white text-black">
            <NavBar />
            <section className="bg-white text-black mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 pt-20">
                <header className="mb-12 flex flex-col items-center text-center gap-3">
                    <div className="mt-2 flex items-center justify-center gap-4 pt-10">
                        <span className="text-[13px] uppercase tracking-[0.1em] text-neutral-500">
                            See what the community has built with
                        </span>
                        <span className="relative inline-block h-[90px] w-[90px] sm:h-[120px] sm:w-[120px]">
                            <Image
                                src={logo}
                                alt="Kloner logo"
                                fill
                                className="object-contain"
                            />
                        </span>
                    </div>
                </header>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center justify-center text-center">
                    <div className="flex flex-col gap-1">
                        <p className="text-[11px] uppercase tracking-[0.24em] text-black/45">
                            Featured builds
                        </p>
                        <p className="max-w-xl text-sm text-black/65">
                            Scroll through approved layouts, open an interactive preview, or
                            remix a project into your own Kloner workspace.
                        </p>
                    </div>
                </div>
                <div className="container pt-5 pb-20">
                    <CommunityBuildsClient />
                </div>
            </section>
        </main>
    );
}