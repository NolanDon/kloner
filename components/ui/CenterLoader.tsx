// components/ui/CenterLoader.tsx
"use client";

import Image from "next/image";
import logo from "@/public/images/orange_logo.png";

/** Full-screen centered pulsing logo */
export default function CenterLoader(): JSX.Element {
    return (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-white">
            <div className="animate-pulse">
                <Image
                    src={logo}
                    alt="Kloner"
                    priority
                    className="h-[90px] w-[90px] object-contain"
                />
            </div>
        </div>
    );
}
