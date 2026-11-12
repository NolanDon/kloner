// components/ui/CenterLoader.tsx
"use client";

import KlonerWordmark from "@/components/KlonerWordmark";

/** Full-screen centered pulsing logo */
export default function CenterLoader(): JSX.Element {
    return (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-white">
            <div className="animate-pulse"><KlonerWordmark className="text-5xl" /></div>
        </div>
    );
}
