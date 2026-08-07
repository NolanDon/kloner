"use client";

import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
    onAuthStateChanged,
    type User as FirebaseUser,
    signOut,
} from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { resetAuthClientCaches } from "@/lib/auth-client";
import { checkSignupBlocklist } from "@/lib/signupBlocklistClient";
import { collection, onSnapshot, DocumentData } from "firebase/firestore";
import { useAppActivityHeartbeat } from "@/src/hooks/useAppActivityHeartbeat";
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
    Archive,
    Headphones,
    BarChart3,
    CreditCard,
    Users,
    ShieldCheck,
    Monitor,
    Crown,
} from "lucide-react";
import KlonerLoader from "@/components/KlonerLoader";
import { type UserTier } from "@/src/lib/credits";

const ACCENT = "#FF8D21";

type NavItemConfig = {
    href: string;
    label: string;
    icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    adminOnly?: boolean;
    supportOnly?: boolean; // supportAgent or admin
    external?: boolean; // NEW
};

type NavSectionConfig = {
    label: string;
    items: NavItemConfig[];
};

function isExternalHref(href: string): boolean {
    return /^https?:\/\//i.test(href);
}

const BASE_NAV_SECTIONS: NavSectionConfig[] = [
    {
        label: "General",
        items: [
            { href: "/", label: "Home", icon: Home },
            // { href: "/affiliate", label: "Affiliate Hub", icon: Users },
            // {
            //     href: "/community-builds",
            //     label: "Community templates",
            //     icon: Sparkles,
            // },

            // // external links
            {
                href: "/price",
                label: "Pricing",
                icon: CreditCard,
            },
        ],
    },
    {
        label: "Preview",
        items: [
            { href: "/dashboard/view", label: "Dashboard", icon: LayoutTemplate },
        ],
    },
    {
        label: "Archive",
        items: [
            { href: "/dashboard/archived", label: "Archive", icon: Archive },
        ],
    },
    // {
    //     label: "Deployments",
    //     items: [
    //         {
    //             href: "/dashboard/deployments",
    //             label: "Deployments",
    //             icon: Rocket,
    //         },
    //     ],
    // },
    {
        label: "Settings",
        items: [
            {
                href: "/dashboard/settings",
                label: "Settings",
                icon: SettingsIcon,
            },
        ],
    },
    {
        label: "Quick Start",
        items: [{ href: "/dashboard/docs", label: "Docs", icon: BookText }],
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
                href: "/admin/users",
                label: "Users",
                icon: Users,
                adminOnly: true,
            },
            {
                href: "/admin/renders",
                label: "User renders",
                icon: Monitor,
                adminOnly: true,
            },
            {
                href: "/admin/analytics",
                label: "Analytics",
                icon: BarChart3,
                adminOnly: true,
            },
            {
                href: "/dashboard/observability",
                label: "Observability",
                icon: Monitor,
                adminOnly: true,
            },
            {
                href: "/admin/support-docs",
                label: "Support docs",
                icon: BookText,
                adminOnly: true,
            },
            {
                href: "/admin/affiliates",
                label: "Affiliates",
                icon: CreditCard,
                adminOnly: true,
            },
            {
                href: "/admin/community-builds",
                label: "Community builds",
                icon: ShieldCheck,
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
    return BASE_NAV_SECTIONS.map((section) => {
        const visibleItems = section.items.filter((item) => {
            if (item.adminOnly && !isAdmin) return false;
            if (item.supportOnly && !(isSupportAgent || isAdmin)) return false;
            return true;
        });

        return { ...section, items: visibleItems };
    }).filter((section) => section.items.length > 0);
}

function NavItem({
    href,
    label,
    icon: Icon,
    active,
    unreadCount,
    external,
}: {
    href: string;
    label: string;
    icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    active: boolean;
    unreadCount?: number;
    external?: boolean;
}) {
    const showBadge = typeof unreadCount === "number" && unreadCount > 0;
    const isExt = !!external || isExternalHref(href);

    const handleClickLink = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (active) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    const baseClass = `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
        active
            ? "cursor-default bg-neutral-50 text-neutral-800 ring-1 ring-neutral-200"
            : "text-neutral-700 hover:bg-neutral-50"
    }`;

    // External: render <a>, not Next <Link>.
    if (isExt) {
        return (
            <a
                href={href}
                onClick={handleClickLink}
                aria-disabled={active}
                target="_blank"
                rel="noopener noreferrer"
                className={baseClass}
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
            </a>
        );
    }

    return (
        <Link
            href={href}
            onClick={handleClickLink}
            aria-disabled={active}
            className={baseClass}
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

function PlanBlock({
    planLabel,
    billingState,
    userTier,
}: {
    planLabel: string;
    billingState: "free" | "active" | "trialing" | "trial_cancelled";
    userTier: UserTier | "unknown";
}) {
    if (userTier === "unknown") return null;

    const badgeLabel = billingState === "trialing" ? "trialing" : planLabel;

    return (
        <div className="border-b border-neutral-200 px-4 py-4">
            <div className="inline-flex w-fit items-center gap-1 rounded-full border border-[rgba(255,141,33,0.45)] bg-white px-3 py-1">
                <Crown className="h-3.5 w-3.5 text-[#FF8D21]" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#FF8D21]">
                    {badgeLabel}
                </span>
            </div>
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
            resetAuthClientCaches();
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
                    <div className="text-xs text-neutral-500 truncate">
                        Account
                    </div>
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
    planLabel,
    billingState,
    userTier,
}: {
    isAdmin: boolean;
    isSupportAgent: boolean;
    supportUnreadCount: number;
    planLabel: string;
    billingState: "free" | "active" | "trialing" | "trial_cancelled";
    userTier: UserTier | "unknown";
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
                            sizes="90px"
                            priority
                            className="object-contain"
                        />
                    </div>
                </Link>
            </div>

            <PlanBlock
                planLabel={planLabel}
                billingState={billingState}
                userTier={userTier}
            />

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
                                    active={
                                        !item.external &&
                                        !isExternalHref(item.href)
                                            ? navItemIsActive(
                                                  pathname,
                                                  item.href,
                                              )
                                            : false
                                    }
                                    unreadCount={
                                        item.href === "/support/agent"
                                            ? supportUnreadCount
                                            : undefined
                                    }
                                    external={item.external}
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

    // track scroll position so we can "lock" background without it moving
    const scrollYRef = useRef(0);

    useEffect(() => {
        if (!open) return;

        // Lock background scroll in a mobile-safe way:
        // - Use body position:fixed so touch scroll won't bleed through to the page behind.
        // - Keep the current scrollY and restore it on close.
        const body = document.body;
        const html = document.documentElement;

        scrollYRef.current = window.scrollY || 0;

        const prevBodyOverflow = body.style.overflow;
        const prevBodyPosition = body.style.position;
        const prevBodyTop = body.style.top;
        const prevBodyLeft = body.style.left;
        const prevBodyRight = body.style.right;
        const prevBodyWidth = body.style.width;
        const prevHtmlOverflow = html.style.overflow;
        const prevOverscroll = (html.style as any).overscrollBehaviorY;

        html.style.overflow = "hidden";
        (html.style as any).overscrollBehaviorY = "none";

        body.style.overflow = "hidden";
        body.style.position = "fixed";
        body.style.top = `-${scrollYRef.current}px`;
        body.style.left = "0";
        body.style.right = "0";
        body.style.width = "100%";

        return () => {
            html.style.overflow = prevHtmlOverflow;
            (html.style as any).overscrollBehaviorY = prevOverscroll || "";

            body.style.overflow = prevBodyOverflow;
            body.style.position = prevBodyPosition;
            body.style.top = prevBodyTop;
            body.style.left = prevBodyLeft;
            body.style.right = prevBodyRight;
            body.style.width = prevBodyWidth;

            window.scrollTo(0, scrollYRef.current);
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
            resetAuthClientCaches();
            await signOut(auth);
            close();
            router.replace("/login");
        } catch {
            // ignore
        }
    };

    return (
        <div className="md:hidden sticky top-0 z-[500] border-b border-neutral-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 pt-[env(safe-area-inset-top)]">
            <div className="flex items-center justify-between px-3 py-2">
                <Link
                    href="/"
                    className="flex items-center gap-2 font-black tracking-tight text-lg shrink-0"
                >
                    <div className="relative h-[64px] w-[64px]">
                        <Image
                            src={logo}
                            alt="kloner logo"
                            fill
                            sizes="44px"
                            priority
                            className="object-contain"
                        />
                    </div>
                </Link>

                <button
                    onClick={() => setOpen(true)}
                    aria-label="Open quick menu"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-sm"
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
                            className="fixed inset-0 z-[600] bg-black/20"
                            onClick={close}
                        />

                        <motion.div
                            key="mbl-sheet"
                            initial={{ y: -12, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: -10, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-[610] rounded-3xl border border-neutral-200 bg-white shadow-2xl"
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

                            {/* SCROLL CONTAINER FIX:
                               - cap height to viewport
                               - enable inner scrolling with momentum
                               - stop scroll chaining/bleed to background
                             */}
                            <ul
                                className="px-2 py-2 overflow-y-auto [-webkit-overflow-scrolling:touch] overscroll-contain"
                                style={{
                                    maxHeight:
                                        "calc(100dvh - 220px - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
                                    touchAction: "pan-y",
                                }}
                            >
                                {flatItems.map(
                                    ({
                                        href,
                                        label,
                                        icon: Icon,
                                        external,
                                    }) => {
                                        const isExt =
                                            !!external ||
                                            isExternalHref(href);
                                        const active = !isExt
                                            ? navItemIsActive(pathname, href)
                                            : false;

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
                                                {isExt ? (
                                                    <a
                                                        href={href}
                                                        onClick={handleClick}
                                                        aria-disabled={active}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] ${
                                                            active
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
                                                ) : (
                                                    <a
                                                        href={href}
                                                        onClick={handleClick}
                                                        aria-disabled={active}
                                                        className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] ${
                                                            active
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
                                                )}
                                            </li>
                                        );
                                    },
                                )}
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
    const [userTier, setUserTier] = useState<UserTier | "unknown">("unknown");
    const [billingState, setBillingState] = useState<"free" | "active" | "trialing" | "trial_cancelled">("free");

    useAppActivityHeartbeat("dashboard-shell");

    useEffect(() => {
        const off = onAuthStateChanged(auth, async (u) => {
            if (!u) {
                router.replace("/login?next=/dashboard");
                return;
            }

            const blocked = await checkSignupBlocklist(u.email).catch(() => ({ blocked: false, reason: null }));
            if (blocked.blocked) {
                try {
                    await fetch("/api/auth/session", {
                        method: "DELETE",
                        credentials: "include",
                    });
                } catch {
                    // ignore
                }
                resetAuthClientCaches();
                try {
                    await signOut(auth);
                } catch {
                    // ignore
                }
                router.replace(`/login?reason=blocked${blocked.reason ? `&message=${encodeURIComponent(blocked.reason)}` : ""}`);
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

    useEffect(() => {
        if (!ready) return;

        let cancelled = false;

        (async () => {
            try {
                const res = await fetch("/api/billing/tier", {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store",
                });

                if (!res.ok) return;

                const data = await res.json().catch(() => null);
                if (cancelled || !data) return;

                setUserTier(
                    data?.tier === "pro" || data?.tier === "agency" || data?.tier === "enterprise"
                        ? data.tier
                        : "free",
                );
                setBillingState(
                    typeof data?.billingState === "string" && data.billingState.trim()
                        ? (data.billingState.trim().toLowerCase() as "free" | "active" | "trialing" | "trial_cancelled")
                        : "free",
                );
            } catch {
                if (!cancelled) {
                    setUserTier("free");
                    setBillingState("free");
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [ready]);

    const planLabel = userTier === "unknown"
        ? "Detecting plan…"
        : userTier === "free"
            ? "Free plan"
            : userTier === "pro"
                ? "Pro plan"
                : userTier === "agency"
                    ? "Agency plan"
                    : "Enterprise plan";

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

                    if (status !== "closed") total += unread;
                });
                setSupportUnreadCount(total);
            },
            (err) => {
                console.error(
                    "[AppShell] support_inbox onSnapshot failed",
                    err,
                );
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
                        planLabel={planLabel}
                        billingState={billingState}
                        userTier={userTier}
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
