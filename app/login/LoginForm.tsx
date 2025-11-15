// app/login/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import NavBar from "@/components/NavBar";
import { auth, db } from "@/lib/firebase";
import {
    GoogleAuthProvider,
    signInWithPopup,
    setPersistence,
    browserLocalPersistence,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    getIdToken,
    getAdditionalUserInfo,
    type User,
} from "firebase/auth";
import type { FirebaseError } from "firebase/app";
import {
    collection,
    getDocs,
    query,
    where,
    addDoc,
    serverTimestamp,
} from "firebase/firestore";
import Image from "next/image";

const ACCENT = "#f55f2a";

type Mode = "signin" | "signup";

function isFirebaseError(e: unknown): e is FirebaseError {
    return typeof e === "object" && e !== null && "code" in e;
}

function normalizeError(e: unknown): string {
    if (isFirebaseError(e)) {
        const code = e.code || "";
        if (code.includes("auth/popup-closed-by-user")) return "Sign-in popup closed.";
        if (code.includes("auth/cancelled-popup-request")) return "Popup already open.";
        if (code.includes("auth/popup-blocked")) return "Popup was blocked by the browser.";
        if (code.includes("auth/invalid-email")) return "Invalid email.";
        if (code.includes("auth/missing-password")) return "Password required.";
        if (code.includes("auth/wrong-password")) return "Incorrect email or password.";
        if (code.includes("auth/user-not-found")) return "Account not found.";
        if (code.includes("auth/email-already-in-use")) return "Email already registered.";
        if (code.includes("auth/too-many-requests")) return "Too many attempts. Try again later.";
        return e.message ?? "Request failed.";
    }
    if (e instanceof Error) return e.message;
    return "Request failed.";
}

/* ───────── URL helpers ───────── */

function normUrl(s: string): string {
    try {
        const u = new URL(s);
        u.hash = "";
        return u.toString();
    } catch {
        return s.trim();
    }
}
function isHttpUrl(s: string): s is string {
    try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}
function hash64(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h << 5) - h + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h).toString(36);
}

/* ───────── CSRF helper ───────── */

async function ensureSessionAndCsrf(): Promise<string | null> {
    try {
        const res = await fetch("/api/auth/csrf", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        return (data && data.csrf) || null;
    } catch {
        return null;
    }
}

/* ───────── Session cookie with CSRF ───────── */

async function setSessionCookie(): Promise<void> {
    const u: User | null = auth.currentUser;
    if (!u) return;

    const idToken = await getIdToken(u, true);
    const csrf = await ensureSessionAndCsrf();

    await fetch("/api/auth/session", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(csrf ? { "x-csrf": csrf } : {}),
        },
        body: JSON.stringify({ idToken }),
        credentials: "include",
    });
}

/* ───────── Add URL + start capture with CSRF ───────── */

async function addAndStart(uid: string, url: string) {
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

    const csrf = await ensureSessionAndCsrf();

    const r = await fetch("/api/private/generate", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(csrf ? { "x-csrf": csrf } : {}),
        },
        body: JSON.stringify({ url: cleaned }),
        credentials: "same-origin",
    });

    if (!r.ok) {
        const j = await r.json().catch(() => ({} as any));
        throw new Error(j?.error || "Failed to queue capture.");
    }
    return cleaned;
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
            fetch("/api/private/send-signup-alert", {
                method: "POST",
                headers,
                credentials: "same-origin",
                cache: "no-store",
                body: JSON.stringify(payload),
            }),
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

    const [email, setEmail] = useState<string>("");
    const [pw, setPw] = useState<string>("");
    const [showPw, setShowPw] = useState<boolean>(false);

    const [acceptedTerms, setAcceptedTerms] = useState<boolean>(false);

    const pendingUrl = useMemo(() => {
        const q = search.get("u");
        if (q) return q;
        try {
            return localStorage.getItem("kloner.pendingUrl") || "";
        } catch {
            return "";
        }
    }, [search]);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            if (!u) return;
            try {
                await setSessionCookie();

                const pending = pendingUrl?.trim();
                if (pending) {
                    try {
                        const cleaned = await addAndStart(u.uid, pending);
                        try {
                            localStorage.removeItem("kloner.pendingUrl");
                        } catch { }
                        router.replace(`/dashboard/view?u=${encodeURIComponent(cleaned)}`);
                        return;
                    } catch {
                        // fall through
                    }
                }

                const next = search.get("next") || "/dashboard";
                router.replace(next);
            } catch {
                router.replace("/dashboard");
            }
        });
        return () => unsub();
    }, [router, search, pendingUrl]);

    const signInWithGoogle = async (): Promise<void> => {
        setErr("");

        if (mode === "signup" && !acceptedTerms) {
            setErr("You must accept the Terms and Conditions to create an account.");
            return;
        }

        setLoading(true);
        try {
            await setPersistence(auth, browserLocalPersistence);
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: "select_account" });

            const cred = await signInWithPopup(auth, provider);
            const isNew = !!getAdditionalUserInfo(cred)?.isNewUser;

            await setSessionCookie();

            if (isNew) {
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

        if (mode === "signup" && !acceptedTerms) {
            setErr("You must accept the Terms and Conditions to create an account.");
            return;
        }

        setLoading(true);
        try {
            await setPersistence(auth, browserLocalPersistence);
            if (!email || !pw) throw new Error("Enter email and password.");

            if (mode === "signin") {
                await signInWithEmailAndPassword(auth, email.trim(), pw);
                await setSessionCookie();
            } else {
                const cred = await createUserWithEmailAndPassword(auth, email.trim(), pw);
                await setSessionCookie();
                await notifyKlonerSignup(cred.user, "email");
            }
        } catch (e2) {
            setErr(normalizeError(e2));
            setLoading(false);
        }
    };

    const doReset = async (): Promise<void> => {
        setErr("");
        if (!email) {
            setErr("Enter your email, then tap Reset.");
            return;
        }
        try {
            await sendPasswordResetEmail(auth, email.trim());
            setErr("Password reset email sent.");
        } catch (e) {
            setErr(normalizeError(e));
        }
    };

    return (
        <main className="min-h-screen bg-white text-black grid place-items-center px-6">
            <NavBar />
            <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-md">
                <div className="mb-6 text-center">
                    <div
                        className="mx-auto mb-3 h-12 w-12 rounded-2xl grid place-items-center font-black text-xl"
                        style={{ backgroundColor: ACCENT, color: "white" }}
                    >
                        K
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                        {mode === "signin" ? "Sign in" : "Create account"}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-600">
                        {mode === "signin"
                            ? "Use Google or email to access your Kloner dashboard."
                            : "Clone websites in minutes. Quick signup with email or Google, then one-click deploy."}
                    </p>
                </div>

                {pendingUrl ? (
                    <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
                        We will add this URL after you{" "}
                        {mode === "signin" ? "sign in" : "sign up"}:{" "}
                        <span className="font-medium break-all">{pendingUrl}</span>
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
                                autoComplete={mode === "signin" ? "current-password" : "new-password"}
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
                                    . I am responsible for any URLs I submit and for how I use any
                                    cloned or generated sites.
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
                    className="w-full inline-flex items-center justify-center gap-3 rounded-xl border border-neutral-200 bg-white text-black px-4 py-3 font-medium hover:bg-neutral-50 transition disabled:opacity-50 focus:outline-none"
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
                ) : null}

                <div className="mt-4 flex items-center justify-between text-xs">
                    <button
                        type="button"
                        onClick={() => {
                            setMode((m) => (m === "signin" ? "signup" : "signin"));
                            setErr("");
                        }}
                        className="font-medium"
                        style={{ color: ACCENT }}
                    >
                        {mode === "signin" ? "Create an account" : "Have an account? Sign in"}
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
