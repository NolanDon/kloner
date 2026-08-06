// app/login/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import {
    GoogleAuthProvider,
    signInWithPopup,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    inMemoryPersistence,
    indexedDBLocalPersistence,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    deleteUser,
    sendPasswordResetEmail,
    getIdToken,
    getAdditionalUserInfo,
    signOut,
    type User,
} from "firebase/auth";
import { bootstrapServerSession, ensureSessionAndCsrf as ensureSessionAndCsrfImpl, resetAuthClientCaches } from "@/lib/auth-client";
import { checkSignupBlocklist } from "@/lib/signupBlocklistClient";
import type { FirebaseError } from "firebase/app";
import {
    collection,
    getDocs,
    query,
    where,
    addDoc,
    serverTimestamp,
    doc,
    setDoc,
    getDoc,
} from "firebase/firestore";
import Image from "next/image";
import { validateAndNormalizePublicHttpUrl } from "@/src/lib/publicHttpUrl";
import { ArrowLeft } from "lucide-react";

const ACCENT = "#FF8D21";
const POLICY_ACCEPTANCE_VERSION = "2026-05-20";

// Backwards-compatible export: many parts of the app import this helper.
// Keep it here, but the implementation lives in a shared client module.
export const ensureSessionAndCsrf = ensureSessionAndCsrfImpl;

type Mode = "signin" | "signup";

function isFirebaseError(e: unknown): e is FirebaseError {
    return typeof e === "object" && e !== null && "code" in e;
}

function isPermissionDeniedError(e: unknown): boolean {
    return isFirebaseError(e) && String(e.code || "").toLowerCase().includes("permission-denied");
}

async function retryOwnerWriteAfterTokenRefresh<T>(u: User, op: () => Promise<T>): Promise<T> {
    try {
        return await op();
    } catch (e) {
        if (!isPermissionDeniedError(e)) throw e;

        // Fresh signups can briefly race before Firestore reads the latest auth token.
        await getIdToken(u, true).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 300));
        return await op();
    }
}

function normalizeError(e: unknown): string {
    if (isFirebaseError(e)) {
        // Ensure `code` is a string so we can safely call `includes` on it.
        const code = typeof e.code === "string" ? e.code : String((e as any).code ?? "");
        if (code.includes("auth/popup-closed-by-user")) return "Sign-in popup closed.";
        if (code.includes("auth/cancelled-popup-request")) return "Popup already open.";
        if (code.includes("auth/popup-blocked")) return "Popup was blocked by the browser.";
        if (code.includes("auth/invalid-email")) return "Invalid email.";
        if (code.includes("auth/missing-password")) return "Password required.";
        if (code.includes("auth/invalid-credential")) return "Incorrect email or password.";
        if (code.includes("auth/invalid-login-credentials")) return "Incorrect email or password.";
        if (code.includes("auth/wrong-password")) return "Incorrect email or password.";
        if (code.includes("auth/user-not-found")) return "Account not found.";
        if (code.includes("auth/user-disabled")) return "This account is disabled. Contact support if this is unexpected.";
        if (code.includes("auth/email-already-in-use")) return "Email already registered.";
        if (code.includes("auth/weak-password")) return "Password is too weak. Use at least 6 characters.";
        if (code.includes("auth/network-request-failed")) return "Network error. Check your connection and try again.";
        if (code.includes("auth/too-many-requests")) return "Too many attempts. Try again later.";

        const rawMessage = String(e.message || "");
        const looksLikeRawFirebase =
            rawMessage.includes("Firebase: Error") ||
            /auth\/[a-z0-9-]+/i.test(rawMessage);
        return looksLikeRawFirebase ? "Couldn’t sign in. Please try again." : (rawMessage || "Request failed.");
    }
    if (e instanceof Error) return e.message;
    return "Request failed.";
}

async function ensureBestAuthPersistence(): Promise<void> {
    // Prefer IndexedDB, then progressively fall back for restricted browsers/privacy modes.
    const candidates = [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
        inMemoryPersistence,
    ];

    for (const persistence of candidates) {
        try {
            await setPersistence(auth, persistence);
            return;
        } catch {
            // Keep trying fallbacks; auth can still proceed with the next option.
        }
    }
}

/* ───────── URL helpers ───────── */

function normUrl(s: string): string {
    return validateAndNormalizePublicHttpUrl(s) || s.trim();
}
function isHttpUrl(s: string): s is string {
    return !!validateAndNormalizePublicHttpUrl(s);
}
function hash64(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h << 5) - h + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h).toString(36);
}

/* ───────── Affiliate helpers ───────── */

function readCookie(name: string): string | null {
    if (typeof document === "undefined") return null;
    const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[2]) : null;
}

function cleanAff(v: unknown): string {
    if (typeof v !== "string") return "";
    return v.trim().slice(0, 128);
}

function getAffiliateFromClient(): { affiliateRef: string; affiliateCode: string } {
    const cookieRef = cleanAff(readCookie("kl_aff_ref") || "");
    const cookieCode = cleanAff(readCookie("kl_aff_code") || "");

    let lsRef = "";
    let lsCode = "";
    try {
        lsRef = cleanAff(localStorage.getItem("kl_aff_ref") || "");
        lsCode = cleanAff(localStorage.getItem("kl_aff_code") || "");
    } catch {
        // ignore
    }

    return {
        affiliateRef: cookieRef || lsRef,
        affiliateCode: cookieCode || lsCode,
    };
}

/**
 * Ensure the user has createdAt set (and keep updatedAt fresh).
 * - If createdAt missing, set it.
 * - Always set updatedAt.
 */
async function ensureUserCreatedAt(u: User): Promise<void> {
    const userRef = doc(db, "kloner_users", u.uid);
    try {
        const snap = await getDoc(userRef);
        const existing = snap.exists() ? (snap.data() as any) : null;

        const updates: Record<string, any> = {
            updatedAt: serverTimestamp(),
        };

        if (!existing?.createdAt) {
            updates.createdAt = serverTimestamp();
        }

        await retryOwnerWriteAfterTokenRefresh(u, () => setDoc(userRef, updates, { merge: true }));
    } catch (e) {
        console.error("Failed to ensure createdAt on user doc", e);
    }
}

/**
 * Attach affiliate attribution to the user's root doc.
 * Non-destructive: won't overwrite existing affiliate fields.
 */
async function attachAffiliateToUserDoc(u: User): Promise<void> {
    const { affiliateRef, affiliateCode } = getAffiliateFromClient();
    if (!affiliateRef && !affiliateCode) return;

    const userRef = doc(db, "kloner_users", u.uid);

    try {
        const snap = await getDoc(userRef);
        const existing = snap.exists() ? (snap.data() as any) : null;

        const updates: Record<string, any> = {
            affiliateLastSeenAt: serverTimestamp(),
        };

        if (affiliateRef && !existing?.affiliateRef) {
            updates.affiliateRef = affiliateRef;
            updates.affiliateCapturedAt = serverTimestamp();
            updates.affiliateSource = "query_param";
        }

        if (affiliateCode && !existing?.affiliateCode) {
            updates.affiliateCode = affiliateCode;
            updates.affiliateCodeCapturedAt = serverTimestamp();
            updates.affiliateCodeSource = "query_param";
        }

        const hasAny =
            "affiliateRef" in updates ||
            "affiliateCode" in updates ||
            "affiliateLastSeenAt" in updates;

        if (!hasAny) return;

        await retryOwnerWriteAfterTokenRefresh(u, () => setDoc(userRef, updates, { merge: true }));
    } catch (e) {
        console.error("Failed to attach affiliate attribution", e);
    }
}

async function recordSignupConsent(u: User, method: "google" | "email" | "apple"): Promise<void> {
    const userRef = doc(db, "kloner_users", u.uid);

    try {
        await retryOwnerWriteAfterTokenRefresh(u, () =>
            setDoc(
                userRef,
                {
                    consent: {
                        termsAcceptedAt: serverTimestamp(),
                        privacyAcceptedAt: serverTimestamp(),
                        termsVersion: POLICY_ACCEPTANCE_VERSION,
                        privacyVersion: POLICY_ACCEPTANCE_VERSION,
                        source: "login_form_signup",
                        method,
                    },
                    consentUpdatedAt: serverTimestamp(),
                },
                { merge: true },
            )
        );
    } catch (e) {
        console.error("Failed to record signup consent", e);
    }
}

/* ───────── Session cookie (throttled) ───────── */

async function setSessionCookie(): Promise<void> {
    await bootstrapServerSession({
        forceRefresh: false,
        minIntervalMs: 30 * 60 * 1000,
        timeoutMs: 12_000,
        reason: "login_form",
    });
}

/* ───────── URL + generate helpers (split) ───────── */

/**
 * Ensure the URL doc exists for this user (idempotent).
 * Returns the cleaned URL.
 */
async function ensureUrlDoc(uid: string, url: string): Promise<string> {
    const cleaned = normUrl(url);
    if (!isHttpUrl(cleaned)) throw new Error("Invalid URL.");
    const urlHash = hash64(cleaned);

    const col = collection(db, "kloner_users", uid, "kloner_urls");

    const [byHash, byUrl] = await Promise.all([
        getDocs(query(col, where("urlHash", "==", urlHash))),
        getDocs(query(col, where("url", "==", cleaned))),
    ]);

    const exists = !byHash.empty || !byUrl.empty;
    if (!exists) {
        await addDoc(col, {
            url: cleaned,
            urlHash,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            status: "queued",
            screenshotsPrefix: `screenshots/${uid}/${urlHash}`,
            screenshotPaths: [],
        });
    }

    return cleaned;
}

/**
 * Queue a generate run for an existing URL doc.
 * Safe to fire-and-forget from the UI.
 */
async function queueGenerate(cleanedUrl: string): Promise<void> {
    const csrf = await ensureSessionAndCsrf();

    const r = await fetch("/api/private/generate", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(csrf ? { "x-csrf": csrf } : {}),
        },
        body: JSON.stringify({ url: cleanedUrl }),
        credentials: "same-origin",
    });

    if (!r.ok) {
        const j = await r.json().catch(() => ({} as any));
        throw new Error(j?.userMessage || j?.message || j?.error || "Failed to queue capture.");
    }
}

/* ───────── Signup notification + welcome mail (with CSRF) ───────── */

async function notifyKlonerSignup(
    user: User,
    method: "google" | "email" | "apple" = "email"
): Promise<void> {
    try {
        const csrf = await ensureSessionAndCsrf();
        const headers: HeadersInit = {
            "content-type": "application/json",
            ...(csrf ? { "x-csrf": csrf } : {}),
        };

        const payload = {
            uid: user.uid,
            email: user.email || "",
            name: user.displayName || "",
            plan: "free",
            createdAt: new Date().toISOString(),
            source: "kloner_login_page",
            method,
        };

        await Promise.allSettled([
            // fetch("/api/private/send-signup-alert", {
            //     method: "POST",
            //     headers,
            //     credentials: "same-origin",
            //     cache: "no-store",
            //     body: JSON.stringify(payload),
            // }),
            fetch("/api/private/send-welcome-email", {
                method: "POST",
                headers,
                credentials: "same-origin",
                cache: "no-store",
                body: JSON.stringify(payload),
            }),
        ]);
    } catch (err) {
        console.error("❌ Failed to send Kloner signup notifications", err);
    }
}

/* ───────── Page component ───────── */

export default function LoginPage(): JSX.Element {
    const router = useRouter();
    const search = useSearchParams();

    const initialMode = (search.get("mode") as Mode) || "signin";
    const [mode, setMode] = useState<Mode>(initialMode);
    const [loading, setLoading] = useState<boolean>(false);
    const [err, setErr] = useState<string>("");
    const [resetSuccess, setResetSuccess] = useState<string>("");

    const [email, setEmail] = useState<string>("");
    const [pw, setPw] = useState<string>("");
    const [showPw, setShowPw] = useState<boolean>(false);

    const [acceptedTerms, setAcceptedTerms] = useState<boolean>(false);
    const [pendingUrl, setPendingUrl] = useState<string>("");
    const [pendingPrompt, setPendingPrompt] = useState<string>("");

    const termsAcceptanceError =
        mode === "signup" && err === "You must accept the Terms and Privacy Policy to create an account.";

    useEffect(() => {
        const reason = (search.get("reason") || "").trim().toLowerCase();
        if (reason !== "session_expired") return;
        setMode("signin");
        setLoading(false);
        setErr("Your session expired. Please sign in again.");
        setResetSuccess("");
    }, [search]);

    useEffect(() => {
        const reason = (search.get("reason") || "").trim().toLowerCase();
        if (reason !== "blocked") return;
        setMode("signin");
        setLoading(false);
        setErr(search.get("message")?.trim() || "This account is blocked.");
        setResetSuccess("");
    }, [search]);

    // Initialize pendingUrl/pendingPrompt from query or localStorage
    useEffect(() => {
        let initial = search.get("u") || "";
        if (!initial) {
            try {
                initial = localStorage.getItem("kloner.pendingUrl") || "";
            } catch {
                // ignore
            }
        }
        const normalizedInitial = validateAndNormalizePublicHttpUrl(initial);
        setPendingUrl(normalizedInitial || "");
        if (initial && !normalizedInitial) {
            try {
                localStorage.removeItem("kloner.pendingUrl");
            } catch {
                // ignore
            }
        }

        let initialPrompt = search.get("prompt") || search.get("p") || "";
        if (!initialPrompt) {
            try {
                initialPrompt = localStorage.getItem("kloner.pendingPrompt") || "";
            } catch {
                // ignore
            }
        }
        setPendingPrompt(initialPrompt);
    }, [search]);

    const clearPendingUrl = () => {
        setPendingUrl("");
        try {
            localStorage.removeItem("kloner.pendingUrl");
        } catch {
            // ignore
        }
        const params = new URLSearchParams(search.toString());
        params.delete("u");
        const qs = params.toString();
        router.replace(qs ? `/login?${qs}` : "/login");
    };

    const clearPendingPrompt = () => {
        setPendingPrompt("");
        try {
            localStorage.removeItem("kloner.pendingPrompt");
        } catch {
            // ignore
        }
        const params = new URLSearchParams(search.toString());
        params.delete("prompt");
        params.delete("p");
        const qs = params.toString();
        router.replace(qs ? `/login?${qs}` : "/login");
    };

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            if (!u) return;
            try {
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
                    setErr(blocked.reason || "This account is blocked.");
                    setLoading(false);
                    router.replace("/login?reason=blocked");
                    return;
                }

                await setSessionCookie();

                const pendingP = pendingPrompt?.trim();
                if (pendingP) {
                    try {
                        try {
                            localStorage.removeItem("kloner.pendingPrompt");
                        } catch {
                            // ignore
                        }
                        router.replace(
                            `/dashboard/view?wizard=1&source=prompt&prompt=${encodeURIComponent(pendingP)}`,
                        );
                        return;
                    } catch (e) {
                        console.error("failed to redirect with pending prompt", e);
                    }
                }

                const pending = pendingUrl?.trim();
                if (pending) {
                    try {
                        try {
                            localStorage.removeItem("kloner.pendingUrl");
                        } catch {
                            // ignore
                        }

                        const cleaned = validateAndNormalizePublicHttpUrl(pending);
                        if (cleaned) {
                            const nextPath =
                                mode === "signin"
                                    ? `/dashboard/view?u=${encodeURIComponent(cleaned)}&focusUrl=1`
                                    : `/dashboard/view?u=${encodeURIComponent(cleaned)}&aq=1`;
                            router.replace(nextPath);
                            return;
                        }

                        // If the pending URL is invalid for any reason, fall through to normal redirect.

                        return;
                    } catch (e) {
                        console.error("failed to auto-add pending url", e);
                        // fall through to normal redirect
                    }
                }

                const next = search.get("next") || "/dashboard/view";
                router.replace(next);

                void Promise.allSettled([
                    ensureUserCreatedAt(u),
                    attachAffiliateToUserDoc(u),
                ]).catch((e) => {
                    console.error("failed to finish post-login user setup", e);
                });
            } catch {
                router.replace("/dashboard/view");
            }
        });
        return () => unsub();
    }, [router, search, pendingUrl, pendingPrompt]);

    const signInWithGoogle = async (): Promise<void> => {
        setErr("");
        setResetSuccess("");

        if (mode === "signup" && !acceptedTerms) {
            setErr("You must accept the Terms and Privacy Policy to create an account.");
            return;
        }

        setLoading(true);
        try {
            await ensureBestAuthPersistence();
            const precheck = await checkSignupBlocklist();
            if (precheck.blocked) {
                setErr(precheck.reason || "This signup is blocked.");
                setLoading(false);
                return;
            }

            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: "select_account" });

            const cred = await signInWithPopup(auth, provider);
            const isNew = !!getAdditionalUserInfo(cred)?.isNewUser;

            const postcheck = await checkSignupBlocklist(cred.user.email);
            if (postcheck.blocked) {
                await deleteUser(cred.user).catch(() => null);
                setErr(postcheck.reason || "This signup is blocked.");
                setLoading(false);
                return;
            }

            await setSessionCookie();

            if (isNew) {
                void Promise.allSettled([
                    ensureUserCreatedAt(cred.user),
                    attachAffiliateToUserDoc(cred.user),
                    recordSignupConsent(cred.user, "google"),
                    notifyKlonerSignup(cred.user, "google"),
                ]).catch((e) => {
                    console.error("failed to finish google signup setup", e);
                });
            }
        } catch (e) {
            setErr(normalizeError(e));
            setLoading(false);
        }
    };

    const submitEmail: React.FormEventHandler<HTMLFormElement> = async (e) => {
        e.preventDefault();
        setErr("");
        setResetSuccess("");

        if (mode === "signup" && !acceptedTerms) {
            setErr("You must accept the Terms and Privacy Policy to create an account.");
            return;
        }

        setLoading(true);
        try {
            await ensureBestAuthPersistence();
            if (!email || !pw) throw new Error("Enter email and password.");

            const blockcheck = await checkSignupBlocklist(mode === "signup" ? email.trim() : null);
            if (mode === "signup" && blockcheck.blocked) {
                setErr(blockcheck.reason || "This signup is blocked.");
                setLoading(false);
                return;
            }

            if (mode === "signin") {
                await signInWithEmailAndPassword(auth, email.trim(), pw);
                await setSessionCookie();
            } else {
                const cred = await createUserWithEmailAndPassword(auth, email.trim(), pw);

                const postcheck = await checkSignupBlocklist(cred.user.email);
                if (postcheck.blocked) {
                    await deleteUser(cred.user).catch(() => null);
                    setErr(postcheck.reason || "This signup is blocked.");
                    setLoading(false);
                    return;
                }

                await setSessionCookie();
                void Promise.allSettled([
                    ensureUserCreatedAt(cred.user),
                    attachAffiliateToUserDoc(cred.user),
                    recordSignupConsent(cred.user, "email"),
                    notifyKlonerSignup(cred.user, "email"),
                ]).catch((e) => {
                    console.error("failed to finish email signup setup", e);
                });
            }
        } catch (e2) {
            setErr(normalizeError(e2));
            setLoading(false);
        }
    };

    const doReset = async (): Promise<void> => {
        setErr("");
        setResetSuccess("");
        if (!email) {
            setErr("Enter your email, then tap Reset.");
            return;
        }
        try {
            await sendPasswordResetEmail(auth, email.trim());
            setResetSuccess("Password reset email sent.");
        } catch (e) {
            setErr(normalizeError(e));
        }
    };

    return (
        <main className="min-h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(255,141,33,0.12),_transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(15,23,42,0.08),_transparent_30%),linear-gradient(180deg,_#fffaf6_0%,_#fff_58%,_#fff7f1_100%)] text-black">
            <Link href="/" className="absolute left-4 top-4 z-20 hidden items-center justify-center transition hover:opacity-90 sm:inline-flex sm:left-6 sm:top-6">
                <Image src="/images/orange_logo.png" alt="Kloner home" width={144} height={144} className="h-20 w-20 object-contain sm:h-20 sm:w-20 lg:h-24 lg:w-24" priority />
            </Link>

            <section className="grid min-h-[100dvh] w-full grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.78fr)]">
                <div className="relative order-1 flex items-center justify-center px-4 pb-8 pt-4 sm:px-6 lg:order-1 lg:px-10 lg:py-10">
                    <div className="w-full max-w-xl rounded-[32px] border border-black/5 bg-white/90 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl sm:p-6 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
                        <div className="mb-4 flex items-center justify-start lg:hidden">
                            <button
                                type="button"
                                onClick={() => router.back()}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-neutral-700 shadow-sm transition hover:bg-neutral-50"
                                aria-label="Go back"
                            >
                                <ArrowLeft className="h-5 w-5" aria-hidden />
                            </button>
                        </div>

                        <div className="mb-5 flex justify-center">
                            <div className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 p-1 text-xs shadow-sm">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMode("signin");
                                        setErr("");
                                    }}
                                    className={`px-3 py-1.5 rounded-full font-medium transition ${mode === "signin"
                                            ? "bg-accent text-white"
                                            : "text-neutral-600 hover:text-black"
                                        }`}
                                >
                                    Sign in
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMode("signup");
                                        setErr("");
                                    }}
                                    className={`px-3 py-1.5 rounded-full font-medium transition ${mode === "signup"
                                            ? "bg-accent text-white"
                                            : "text-neutral-600 hover:text-black"
                                        }`}
                                >
                                    Create account
                                </button>
                            </div>
                        </div>

                        <div className="mb-5 text-center">
                            <h1 className="text-3xl font-semibold tracking-tight text-neutral-950 sm:text-4xl">
                                {mode === "signin" ? "Sign in" : "Create account"}
                            </h1>
                            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-neutral-600 sm:text-base">
                                {mode === "signin"
                                    ? "Use Google or email to access your Kloner dashboard."
                                    : "Clone websites in minutes. Quick signup with email or Google, then one-click deploy."}
                            </p>
                        </div>

                        {pendingPrompt ? (
                            <div className="mb-3 flex items-start justify-between gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-xs text-indigo-900 shadow-sm">
                                <div>
                                    We will start from this prompt after you{" "}
                                    {mode === "signin" ? "sign in" : "sign up"}: {" "}
                                    <span className="font-medium break-words">{pendingPrompt}</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={clearPendingPrompt}
                                    className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-indigo-500 text-[11px] leading-none text-indigo-800 hover:bg-indigo-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                                    aria-label="Do not auto-add this prompt"
                                >
                                    ×
                                </button>
                            </div>
                        ) : null}

                        {pendingUrl ? (
                            <div className="mb-4 flex items-start justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 shadow-sm">
                                <div>
                                    We will add this URL after you {" "}
                                    {mode === "signin" ? "sign in" : "sign up"}:{"\n "}
                                    <span className="font-medium break-all">{pendingUrl}</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={clearPendingUrl}
                                    className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-500 text-[11px] leading-none text-emerald-700 hover:bg-emerald-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                                    aria-label="Do not auto-add this URL"
                                >
                                    ×
                                </button>
                            </div>
                        ) : null}

                        <div className="rounded-[28px] border border-black/5 bg-white p-4 shadow-[0_16px_50px_rgba(15,23,42,0.08)] sm:p-6">
                            <form onSubmit={submitEmail} className="space-y-3">
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-neutral-600">
                                        Email
                                    </label>
                                    <input
                                        type="email"
                                        autoComplete="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-[#FF8D21] focus:ring-2 focus:ring-[#FF8D21]/15"
                                        placeholder="you@example.com"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="block text-xs font-medium text-neutral-600">
                                        Password
                                    </label>
                                    <div className="flex items-stretch gap-2">
                                        <input
                                            type={showPw ? "text" : "password"}
                                            autoComplete={
                                                mode === "signin" ? "current-password" : "new-password"
                                            }
                                            value={pw}
                                            onChange={(e) => setPw(e.target.value)}
                                            className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-[#FF8D21] focus:ring-2 focus:ring-[#FF8D21]/15"
                                            placeholder={
                                                mode === "signin"
                                                    ? "Your password"
                                                    : "Create a strong password"
                                            }
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPw((v) => !v)}
                                            className="shrink-0 rounded-2xl border border-neutral-200 bg-white px-3 text-sm transition hover:bg-neutral-50"
                                            aria-label="Toggle password visibility"
                                        >
                                            {showPw ? "Hide" : "Show"}
                                        </button>
                                    </div>
                                </div>

                                {mode === "signup" && (
                                    <div className={`mt-2 rounded-2xl border px-3 py-2.5 ${termsAcceptanceError ? "border-red-300 bg-red-50/70" : "border-neutral-200 bg-neutral-50"}`}>
                                        <label className="flex items-start gap-2 text-xs text-neutral-700">
                                            <input
                                                type="checkbox"
                                                checked={acceptedTerms}
                                                onChange={(e) => setAcceptedTerms(e.target.checked)}
                                                className={`mt-0.5 h-3.5 w-3.5 rounded ${termsAcceptanceError ? "border-red-400 text-[#FF8D21] focus:ring-red-300" : "border-neutral-300"}`}
                                            />
                                            <span className={termsAcceptanceError ? "text-red-800" : ""}>
                                                I have read and agree to the{" "}
                                                <a
                                                    href="/terms"
                                                    className={`font-medium underline underline-offset-2 ${termsAcceptanceError ? "text-red-700" : ""}`}
                                                    style={{ color: termsAcceptanceError ? undefined : ACCENT }}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    Terms and Conditions
                                                </a>{" "}
                                                and{" "}
                                                <a
                                                    href="/privacy"
                                                    className={`font-medium underline underline-offset-2 ${termsAcceptanceError ? "text-red-700" : ""}`}
                                                    style={{ color: termsAcceptanceError ? undefined : ACCENT }}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    Privacy Policy
                                                </a>
                                                .
                                            </span>
                                        </label>
                                        {termsAcceptanceError ? (
                                            <p className="mt-2 text-[11px] font-medium text-red-700">
                                                Accept the terms to continue.
                                            </p>
                                        ) : null}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
                                    style={{ backgroundColor: ACCENT }}
                                >
                                    {loading
                                        ? mode === "signin"
                                            ? "Signing in…"
                                            : "Creating…"
                                        : mode === "signin"
                                            ? "Sign in"
                                            : "Create account"}
                                </button>
                            </form>

                            <div className="my-4 grid grid-cols-3 items-center gap-3">
                                <div className="h-px bg-neutral-200" />
                                <div className="text-center text-xs text-neutral-500">or</div>
                                <div className="h-px bg-neutral-200" />
                            </div>

                            <button
                                onClick={signInWithGoogle}
                                disabled={loading}
                                className="w-full inline-flex items-center justify-center gap-3 rounded-2xl border border-neutral-200 bg-white text-black px-4 py-3 font-medium hover:bg-neutral-50 transition disabled:opacity-50 focus:outline-none text-sm"
                            >
                                <Image
                                    src="/images/g.webp"
                                    alt="Google"
                                    width={20}
                                    height={20}
                                    className="h-5 w-5"
                                    priority
                                />
                                {loading ? "Please wait…" : "Continue with Google"}
                            </button>

                            {err && !termsAcceptanceError ? (
                                <p className="mt-4 rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                                    {err}
                                </p>
                            ) : resetSuccess ? (
                                <p className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                                    {resetSuccess}
                                </p>
                            ) : null}

                            <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMode((m) => (m === "signin" ? "signup" : "signin"));
                                        setErr("");
                                    }}
                                    className="font-medium"
                                    style={{ color: ACCENT }}
                                >
                                    {mode === "signin"
                                        ? "Create an account"
                                        : "Have an account? Sign in"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void doReset()}
                                    className="text-neutral-500 hover:text-neutral-700"
                                >
                                    Reset password
                                </button>
                            </div>
                        </div>

                        <div className="mt-4 text-center text-xs text-neutral-500">
                            By continuing you agree to the{" "}
                            <a
                                href="/terms"
                                className="font-medium"
                                style={{ color: ACCENT }}
                                target="_blank"
                                rel="noreferrer"
                            >
                                Terms and Conditions
                            </a>{" "}
                            and{" "}
                            <a
                                href="/privacy"
                                className="font-medium"
                                style={{ color: ACCENT }}
                                target="_blank"
                                rel="noreferrer"
                            >
                                Privacy Policy
                            </a>
                            .
                        </div>
                    </div>
                </div>

                <div className="relative order-2 min-h-[28rem] overflow-hidden border-b border-black/5 bg-neutral-950 text-white lg:min-h-[100dvh] lg:border-b-0 lg:border-l">
                    <div className="absolute inset-0">
                        <Image
                            src="/images/hero_bg.png"
                            alt="Abstract Kloner hero artwork"
                            fill
                            priority
                            sizes="(max-width: 1024px) 100vw, 50vw"
                            className="object-cover object-center"
                        />
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.14),_transparent_34%),linear-gradient(180deg,_rgba(10,10,10,0.18)_0%,_rgba(9,9,11,0.55)_100%)]" />
                    </div>

                    <div className="relative flex min-h-[28rem] flex-col justify-end px-6 py-8 sm:px-10 sm:py-10 lg:min-h-[100dvh] lg:px-12 lg:py-12">
                        <div className="max-w-xl">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/65">Login / Signup</p>
                            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                                Build, edit, and launch from one account.
                            </h2>
                            <p className="mt-4 max-w-lg text-sm leading-6 text-white/80 sm:text-base">
                                Sign in to keep your projects, previews, and credits in sync. 
                            </p>

                            <div className="mt-8 grid gap-3 sm:grid-cols-3">
                                <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4 backdrop-blur-md">
                                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/55">Secure</div>
                                    <div className="mt-2 text-sm font-medium text-white">Google or email auth</div>
                                </div>
                                <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4 backdrop-blur-md">
                                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/55">Fast</div>
                                    <div className="mt-2 text-sm font-medium text-white">Quick renderings</div>
                                </div>
                                <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4 backdrop-blur-md">
                                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/55">Ready</div>
                                    <div className="mt-2 text-sm font-medium text-white">Pick up in your dashboard</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
