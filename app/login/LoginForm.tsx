// app/login/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import NavBar from "@/components/NavBar";
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
    type User,
} from "firebase/auth";
import { bootstrapServerSession, ensureSessionAndCsrf as ensureSessionAndCsrfImpl } from "@/lib/auth-client";
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

const ACCENT = "#f55f2a";

// Backwards-compatible export: many parts of the app import this helper.
// Keep it here, but the implementation lives in a shared client module.
export const ensureSessionAndCsrf = ensureSessionAndCsrfImpl;

type Mode = "signin" | "signup";

function isFirebaseError(e: unknown): e is FirebaseError {
    return typeof e === "object" && e !== null && "code" in e;
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

async function checkSignupBlocklist(email?: string | null): Promise<{ blocked: boolean; reason: string | null }> {
    try {
        const res = await fetch("/api/private/signup-blocklist", {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({ email: email || null }),
            credentials: "include",
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            return { blocked: false, reason: null };
        }

        return {
            blocked: !!data?.blocked,
            reason: typeof data?.reason === "string" && data.reason.trim() ? data.reason.trim() : null,
        };
    } catch {
        return { blocked: false, reason: null };
    }
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

        await setDoc(userRef, updates, { merge: true });
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

        await setDoc(userRef, updates, { merge: true });
    } catch (e) {
        console.error("Failed to attach affiliate attribution", e);
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
        throw new Error(j?.error || "Failed to queue capture.");
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

    useEffect(() => {
        const reason = (search.get("reason") || "").trim().toLowerCase();
        if (reason !== "session_expired") return;
        setMode("signin");
        setLoading(false);
        setErr("Your session expired. Please sign in again.");
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
                await setSessionCookie();

                // Ensure createdAt exists (and keep updatedAt fresh) for any signed-in user.
                // This fixes the "createdAt didn't seem to work" issue when other flows created the doc first.
                await ensureUserCreatedAt(u);

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

                        // Send the user to the consolidated dashboard view and let it
                        // own the url-doc creation + capture queueing (start=1).
                        const cleaned = validateAndNormalizePublicHttpUrl(pending);
                        if (cleaned) {
                            router.replace(
                                `/dashboard/view?u=${encodeURIComponent(cleaned)}&start=1`,
                            );
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
            setErr("You must accept the Terms and Conditions to create an account.");
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
                await ensureUserCreatedAt(cred.user);
                await attachAffiliateToUserDoc(cred.user);
                await notifyKlonerSignup(cred.user, "google");
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
            setErr("You must accept the Terms and Conditions to create an account.");
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
                await ensureUserCreatedAt(cred.user);
                await attachAffiliateToUserDoc(cred.user);
                await notifyKlonerSignup(cred.user, "email");
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
        <main className="min-h-[100dvh] bg-white text-black px-4 sm:px-6 pt-24 pb-12 sm:pt-28 sm:pb-16 flex items-start md:items-center justify-center">
            <NavBar />
            <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-4 sm:p-6 md:p-8 shadow-md">
                {/* TOP MODE TOGGLE */}
                <div className="mb-4 flex justify-center">
                    <div className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 p-1 text-xs">
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

                <div className="text-center">
                    <h1 className="text-2xl mb-4 font-semibold tracking-tight">
                        {mode === "signin" ? "Sign in" : "Create account"}
                    </h1>
                    <p className="mt-1 mb-4 text-sm text-neutral-600">
                        {mode === "signin"
                            ? "Use Google or email to access your Kloner dashboard."
                            : "Clone websites in minutes. Quick signup with email or Google, then one-click deploy."}
                    </p>
                </div>

                {pendingPrompt ? (
                    <div className="mb-3 flex items-start justify-between gap-2 rounded-lg bg-indigo-50 px-3 py-2.5 text-xs text-indigo-900 ring-1 ring-indigo-200">
                        <div>
                            We will start from this prompt after you{" "}
                            {mode === "signin" ? "sign in" : "sign up"}:{" "}
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
                    <div className="mb-4 flex items-start justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 ring-1 ring-emerald-200">
                        <div>
                            We will add this URL after you {" "}
                            {mode === "signin" ? "sign in\n" : "sign up\n"}:{" "}
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
                            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2"
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
                                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2"
                                placeholder={
                                    mode === "signin"
                                        ? "Your password"
                                        : "Create a strong password"
                                }
                            />
                            <button
                                type="button"
                                onClick={() => setShowPw((v) => !v)}
                                className="shrink-0 rounded-xl border border-neutral-200 bg-white px-3 text-sm hover:bg-neutral-50"
                                aria-label="Toggle password visibility"
                            >
                                {showPw ? "Hide" : "Show"}
                            </button>
                        </div>
                    </div>

                    {mode === "signup" && (
                        <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                            <label className="flex items-start gap-2 text-xs text-neutral-700">
                                <input
                                    type="checkbox"
                                    checked={acceptedTerms}
                                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                                    className="mt-0.5 h-3.5 w-3.5 rounded border-neutral-300"
                                />
                                <span>
                                    I have read and agree to the{" "}
                                    <a
                                        href="/terms"
                                        className="font-medium underline underline-offset-2"
                                        style={{ color: ACCENT }}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Terms and Conditions
                                    </a>{" "}
                                    and{" "}
                                    <a
                                        href="/privacy"
                                        className="font-medium underline underline-offset-2"
                                        style={{ color: ACCENT }}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Privacy Policy
                                    </a>
                                    .
                                </span>
                            </label>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
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
                    className="w-full inline-flex items-center justify-center gap-3 rounded-xl border border-neutral-200 bg-white text-black px-4 py-3 font-medium hover:bg-neutral-50 transition disabled:opacity-50 focus:outline-none text-sm"
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

                {err ? (
                    <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {err}
                    </p>
                ) : resetSuccess ? (
                    <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        {resetSuccess}
                    </p>
                ) : null}

                <div className="mt-4 flex items-center justify-between text-sm">
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

                <div className="mt-8">
                    <hr className="h-px w-full bg-neutral-200" />
                    <div className="mt-3 text-center text-xs text-neutral-500">
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
        </main>
    );
}
