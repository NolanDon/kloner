"use client";

import {
    ReactNode,
    useEffect,
    useMemo,
    useState,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import {
    onAuthStateChanged,
    type User as FirebaseUser,
    signOut,
} from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import {
    collection,
    onSnapshot,
    DocumentData,
} from "firebase/firestore";
import Link from "next/link";
import Image from "next/image";
import logo from "@/public/images/orange_logo.png";
import { AnimatePresence, motion } from "framer-motion";
import {
    MoreHorizontal,
    X,
    Home,
    LayoutTemplate,
    BookText,
    Settings as SettingsIcon,
    LogOut,
    Hammer,
    Archive,
    Rocket,
    Headphones,
    BarChart3,
    CreditCard,
    Users,
} from "lucide-react";
import KlonerLoader from "@/components/KlonerLoader";

const ACCENT = "#f55f2a";

type NavItemConfig = {
    href: string;
    label: string;
    icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    adminOnly?: boolean;
    supportOnly?: boolean; // supportAgent or admin
};

type NavSectionConfig = {
    label: string;
    items: NavItemConfig[];
};

const BASE_NAV_SECTIONS: NavSectionConfig[] = [
    {
        label: "General",
        items: [{ href: "/", label: "Home", icon: Home },
        { href: "/affiliate", label: "Affiliate Hub", icon: Users }, // <-- add
        ]
    },
    {
        label: "Preview",
        items: [
            { href: "/dashboard", label: "Dashboard", icon: LayoutTemplate },
            { href: "/dashboard/view", label: "Builder", icon: Hammer },
        ],
    },
    {
        label: "Archive",
        items: [
            {
                href: "/dashboard/archived",
                label: "Archive",
                icon: Archive,
            },
        ],
    },
    {
        label: "Deployments",
        items: [
            {
                href: "/dashboard/deployments",
                label: "Deployments",
                icon: Rocket,
            },
        ],
    },
    {
        label: "Settings",
        items: [
            { href: "/dashboard/settings", label: "Settings", icon: SettingsIcon },
        ],
    },
    {
        label: "Quick Start",
        items: [
            { href: "/dashboard/docs", label: "Docs", icon: BookText },
        ],
    },
    {
        label: "Support",
        items: [
            {
                href: "/support/agent",
                label: "Support Inbox",
                icon: Headphones,
                supportOnly: true,
            },
        ],
    },
    {
        label: "Admin",
        items: [
            {
                href: "/admin/analytics",
                label: "Analytics",
                icon: BarChart3,
                adminOnly: true,
            },
            {
                href: "/admin/support-docs",
                label: "Support docs",
                icon: BookText,          // or any icon you prefer
                adminOnly: true,
            },
            {
                href: "/admin/affiliates",
                label: "Affiliates",
                icon: CreditCard,
                adminOnly: true,
            },
        ],
    },
];


// STRICT match now – no startsWith for dashboard etc.
function navItemIsActive(pathname: string, href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href;
}

function filterNavSections(
    pathname: string,
    isAdmin: boolean,
    isSupportAgent: boolean,
): NavSectionConfig[] {
    return BASE_NAV_SECTIONS
        .map((section) => {
            const visibleItems = section.items.filter((item) => {
                if (item.adminOnly && !isAdmin) return false;
                if (item.supportOnly && !(isSupportAgent || isAdmin)) return false;
                return true;
            });

            return { ...section, items: visibleItems };
        })
        .filter((section) => section.items.length > 0);
}

function NavItem({
    href,
    label,
    icon: Icon,
    active,
    unreadCount,
}: {
    href: string;
    label: string;
    icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    active: boolean;
    unreadCount?: number;
}) {
    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (active) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    const showBadge =
        typeof unreadCount === "number" && unreadCount > 0;

    return (
        <Link
            href={href}
            onClick={handleClick}
            aria-disabled={active}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${active
                ? "cursor-default bg-neutral-50 text-neutral-800 ring-1 ring-neutral-200"
                : "text-neutral-700 hover:bg-neutral-50"
                }`}
        >
            {Icon && (
                <span className="grid h-7 w-7 place-items-center rounded-md border border-neutral-200 bg-white">
                    <Icon className="h-3.5 w-3.5" />
                </span>
            )}
            <span className="truncate">{label}</span>
            {showBadge && (
                <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-2 py-[1.5px] text-[10px] font-semibold text-white">
                    {unreadCount}
                </span>
            )}
        </Link>
    );
}


function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="px-3 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            {children}
        </div>
    );
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
        const parts = name
            .replace(/@.*/, "")
            .replace(/[_.\-]+/g, " ")
            .trim()
            .split(/\s+/)
            .slice(0, 2);
        if (parts.length === 0) return "ME";
        if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
        return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    }, [user]);

    const onSignOut = async (): Promise<void> => {
        try {
            await fetch("/api/auth/session", {
                method: "DELETE",
                credentials: "include",
            });
            await signOut(auth);
            router.replace("/login");
        } catch {
            // ignore
        }
    };

    return (
        <div className="mt-auto p-4 border-t border-neutral-200">
            <div className="flex items-center gap-3">
                <div
                    className="h-10 w-10 rounded-full grid place-items-center text-white"
                    style={{ backgroundColor: ACCENT }}
                >
                    {initials}
                </div>
                <div className="min-w-0">
                    <div className="text-sm text-neutral-800 truncate">
                        {user?.displayName || user?.email || "Signed in"}
                    </div>
                    <div className="text-xs text-neutral-500 truncate">Account</div>
                </div>
            </div>
            <button
                onClick={onSignOut}
                className="mt-3 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
                Sign out
            </button>
        </div>
    );
}

function SidebarShell({
    isAdmin,
    isSupportAgent,
    supportUnreadCount,
}: {
    isAdmin: boolean;
    isSupportAgent: boolean;
    supportUnreadCount: number;
}) {
    const pathname = usePathname();
    const navSections = useMemo(
        () => filterNavSections(pathname, isAdmin, isSupportAgent),
        [pathname, isAdmin, isSupportAgent],
    );

    return (
        <div className="flex h-full flex-col w-full">
            <div className="px-5 py-5 border-b border-neutral-200">
                <Link
                    href="/"
                    className="flex items-center gap-2 font-black tracking-tight text-xl md:text-2xl shrink-0"
                >
                    <div className="relative h-[90px] w-[90px]">
                        <Image
                            src={logo}
                            alt="kloner logo"
                            fill
                            priority
                            className="object-contain"
                        />
                    </div>
                </Link>
            </div>

            <nav className="flex-1 p-3 text-sm overflow-y-auto">
                {navSections.map((section) => (
                    <div key={section.label} className="mb-1">
                        <SectionLabel>{section.label}</SectionLabel>
                        <div className="space-y-1">
                            {section.items.map((item) => (
                                <NavItem
                                    key={item.href}
                                    href={item.href}
                                    label={item.label}
                                    icon={item.icon}
                                    active={navItemIsActive(pathname, item.href)}
                                    unreadCount={
                                        item.href === "/support/agent"
                                            ? supportUnreadCount
                                            : undefined
                                    }
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </nav>

            <AccountBlock />
        </div>
    );
}

function MobileHeader({
    isAdmin,
    isSupportAgent,
}: {
    isAdmin: boolean;
    isSupportAgent: boolean;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const el = document.documentElement;
        const prev = el.style.overflow;
        el.style.overflow = open ? "hidden" : prev || "";
        return () => {
            el.style.overflow = prev;
        };
    }, [open]);

    const close = () => setOpen(false);

    const flatItems: NavItemConfig[] = useMemo(
        () =>
            filterNavSections(pathname, isAdmin, isSupportAgent).flatMap(
                (s) => s.items,
            ),
        [pathname, isAdmin, isSupportAgent],
    );

    const onSignOut = async (): Promise<void> => {
        try {
            await fetch("/api/auth/session", {
                method: "DELETE",
                credentials: "include",
            });
            await signOut(auth);
            close();
            router.replace("/login");
        } catch {
            // ignore
        }
    };

    return (
        <div className="md:hidden sticky top-0 z-10 bg-white border-b border-neutral-200">
            <div className="flex items-center justify-between px-4 py-3">
                <Link
                    href="/"
                    className="flex items-center gap-2 font-black tracking-tight text-xl md:text-2xl shrink-0"
                >
                    <div className="relative h-[70px] w-[70px]">
                        <Image
                            src={logo}
                            alt="kloner logo"
                            fill
                            priority
                            className="object-contain"
                        />
                    </div>
                </Link>

                <button
                    onClick={() => setOpen(true)}
                    aria-label="Open quick menu"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700"
                >
                    <MoreHorizontal className="h-4 w-4" />
                </button>
            </div>

            <AnimatePresence>
                {open && (
                    <>
                        <motion.div
                            key="mbl-backdrop"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            className="fixed inset-0 z-[80]"
                            onClick={close}
                        />
                        <motion.div
                            key="mbl-sheet"
                            initial={{ y: -12, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: -10, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-[90] rounded-3xl border border-neutral-200 bg-white shadow-2xl"
                            role="dialog"
                            aria-modal="true"
                        >
                            <div className="flex items-center justify-between px-4 pt-3 pb-2">
                                <div className="text-sm font-semibold text-neutral-800">
                                    Quick Menu
                                </div>
                                <button
                                    onClick={close}
                                    aria-label="Close"
                                    className="h-9 w-9 grid place-items-center rounded-full hover:bg-neutral-100"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="h-px bg-neutral-200/80" />

                            <ul className="px-2 py-2">
                                {flatItems.map(({ href, label, icon: Icon }) => {
                                    const active = navItemIsActive(pathname, href);

                                    const handleClick = (
                                        e: React.MouseEvent<HTMLAnchorElement>,
                                    ) => {
                                        if (active) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            close();
                                            return;
                                        }
                                        close();
                                    };

                                    return (
                                        <li key={href}>
                                            <a
                                                href={href}
                                                onClick={handleClick}
                                                aria-disabled={active}
                                                className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] ${active
                                                    ? "cursor-default bg-neutral-50 text-neutral-800 ring-1 ring-neutral-200"
                                                    : "text-neutral-800 hover:bg-neutral-50"
                                                    }`}
                                            >
                                                {Icon && (
                                                    <span className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 bg-white">
                                                        <Icon className="h-4 w-4" />
                                                    </span>
                                                )}
                                                {label}
                                            </a>
                                        </li>
                                    );
                                })}
                            </ul>

                            <div className="h-px bg-neutral-200/80" />

                            <div className="px-4 py-3">
                                <button
                                    onClick={onSignOut}
                                    className="w-full inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white"
                                    style={{ background: ACCENT }}
                                >
                                    <LogOut className="h-4 w-4" />
                                    Sign out
                                </button>
                            </div>

                            <div className="pb-[max(8px,env(safe-area-inset-bottom))]" />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}

export default function AppShellLayout({ children }: { children: ReactNode }) {
    const router = useRouter();
    const [ready, setReady] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isSupportAgent, setIsSupportAgent] = useState(false);
    const [supportUnreadCount, setSupportUnreadCount] = useState(0);

    useEffect(() => {
        const off = onAuthStateChanged(auth, async (u) => {
            if (!u) {
                router.replace("/login?next=/dashboard");
                return;
            }

            try {
                const tokenResult = await u.getIdTokenResult();
                const claims = tokenResult.claims as any;
                setIsAdmin(!!claims.admin);
                setIsSupportAgent(!!claims.supportAgent);
            } catch {
                setIsAdmin(false);
                setIsSupportAgent(false);
            }

            setReady(true);
        });
        return () => off();
    }, [router]);

    // unread count listener for support inbox (only for support/admin)
    useEffect(() => {
        if (!isAdmin && !isSupportAgent) {
            setSupportUnreadCount(0);
            return;
        }

        const inboxCol = collection(db, "support_inbox");

        const unsub = onSnapshot(
            inboxCol,
            (snap) => {
                let total = 0;
                snap.forEach((doc) => {
                    const data = doc.data() as DocumentData;
                    const status = (data.status as string) || "open";
                    const unread =
                        typeof data.unreadCount === "number"
                            ? data.unreadCount
                            : 0;

                    // if you only want unread on non-closed threads:
                    if (status !== "closed") {
                        total += unread;
                    }
                });
                setSupportUnreadCount(total);
            },
            (err) => {
                console.error("[AppShell] support_inbox onSnapshot failed", err);
            },
        );

        return () => unsub();
    }, [isAdmin, isSupportAgent]);

    if (!ready) {
        return <KlonerLoader />;
    }

    return (
        <main className="bg-white h-screen overflow-auto">
            <div className="mx-auto max-w-[1400px] h-full grid grid-cols-1 md:grid-cols-[auto,1fr]">
                <aside className="hidden md:block md:w-64 lg:w-72 shrink-0 border-r border-neutral-200 bg-white h-full sticky top-0">
                    <SidebarShell
                        isAdmin={isAdmin}
                        isSupportAgent={isSupportAgent}
                        supportUnreadCount={supportUnreadCount}
                    />
                </aside>

                <section className="min-h-screen overflow-y-scroll scrollbar-hide">
                    <MobileHeader
                        isAdmin={isAdmin}
                        isSupportAgent={isSupportAgent}
                    />
                    <div className="flex-1">{children}</div>
                </section>
            </div>
        </main>
    );
}
