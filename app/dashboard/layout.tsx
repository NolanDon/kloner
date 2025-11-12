// app/dashboard/layout.tsx
"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { onAuthStateChanged, signOut as fbSignOut, type User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Link from "next/link";
import Image from "next/image";
import logo from "@/public/images/logo.png";
import CenterLoader from "@/components/ui/CenterLoader";

const ACCENT = "#f55f2a";

function NavItem({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
    return (
        <Link
            href={href}
            className={`block rounded-lg px-3 py-2 text-sm ${active ? "bg-neutral-50 text-neutral-900 ring-1 ring-neutral-200" : "text-neutral-700 hover:bg-neutral-50"
                }`}
        >
            {children}
        </Link>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div className="px-3 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{children}</div>;
}

function AccountBlock() {
    const router = useRouter();
    const [user, setUser] = useState<FirebaseUser | null>(null);

    useEffect(() => {
        const off = onAuthStateChanged(auth, (u) => setUser(u));
        return () => off();
    }, []);

    const initials = useMemo(() => {
        if (!user) return "ME";
        const name = user.displayName || user.email || "";
        const parts = name.replace(/@.*/, "").replace(/[_.\-]+/g, " ").trim().split(/\s+/).slice(0, 2);
        if (parts.length === 0) return "ME";
        if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
        return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    }, [user]);

    async function handleSignOut() {
        await fbSignOut(auth);
        router.replace("/login");
    }

    return (
        <div className="mt-auto p-4 border-t border-neutral-200">
            <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full grid place-items-center font-semibold text-white" style={{ backgroundColor: ACCENT }}>
                    {initials}
                </div>
                <div className="min-w-0">
                    <div className="text-sm font-medium text-neutral-900 truncate">{user?.displayName || user?.email || "Signed in"}</div>
                    <div className="text-xs text-neutral-500 truncate">Account</div>
                </div>
            </div>
            <button onClick={handleSignOut} className="mt-3 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
                Sign out
            </button>
        </div>
    );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
    const router = useRouter();
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const off = onAuthStateChanged(auth, (u) => {
            if (!u) {
                router.replace("/login?next=/dashboard");
                return;
            }
            setUser(u);
            setReady(true);
        });
        return () => off();
    }, [router]);

    if (!ready) {
        return (
            <main className="bg-white min-h-screen">
                <CenterLoader />
            </main>
        );
    }

    function SidebarShell() {
        const pathname = usePathname();
        const inDashboard = pathname === "/dashboard";
        const inPreview = pathname.startsWith("/dashboard/view") || pathname === "/dashboard";

        return (
            <div className="flex h-screen flex-col w-full">
                {/* Brand */}
                <div className="px-5 py-5 border-b border-neutral-200">
                    <Link href="/" className="inline-flex items-center gap-2">
                        <div className="relative h-8 w-8 overflow-hidden rounded-full bg-white/20 ring-1 ring-white/40">
                            <Image src={logo} alt="" fill priority className="object-cover" />
                        </div>
                        <div className="font-semibold tracking-tight">Kloner</div>
                    </Link>
                </div>

                {/* Nav */}
                <nav className="flex-1 p-3 text-sm overflow-y-auto">
                    <SectionLabel>General</SectionLabel>
                    <div className="space-y-1">
                        <NavItem href="/" active={false}>Home</NavItem>
                    </div>

                    <SectionLabel>Preview</SectionLabel>
                    <div className="space-y-1">
                        <NavItem href="/dashboard" active={inDashboard}>Dashboard</NavItem>
                        <NavItem href="/dashboard/view" active={inPreview && !inDashboard}>Preview Builder</NavItem>
                    </div>

                    <SectionLabel>General</SectionLabel>
                    <div className="space-y-1">
                        <NavItem href="/settings" active={usePathname() === "/settings"}>Settings</NavItem>
                        <NavItem href="/docs" active={usePathname() === "/docs"}>Docs</NavItem>
                    </div>
                </nav>

                <AccountBlock />
            </div>
        );
    }

    return (
        <main className="bg-white">
            <div className="mx-auto max-w-[1400px] grid grid-cols-1 md:grid-cols-[auto,1fr]">
                <aside className="hidden md:flex md:w-64 lg:w-72 shrink-0 border-r border-neutral-200 bg-white">
                    <SidebarShell />
                </aside>

                <section className="min-h-screen">
                    {/* Mobile header */}
                    <div className="md:hidden sticky top-0 z-10 bg-white border-b border-neutral-200">
                        <div className="flex items-center justify-between px-4 py-3">
                            <a href="/" className="inline-flex items-center gap-2">
                                <div className="h-8 w-8 grid place-items-center rounded-lg text-white font-black" style={{ backgroundColor: ACCENT }}>
                                    K
                                </div>
                                <div className="font-semibold">Kloner</div>
                            </a>
                            <a href="/settings" className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
                                Settings
                            </a>
                        </div>
                    </div>

                    {children}
                </section>
            </div>
        </main>
    );
}
