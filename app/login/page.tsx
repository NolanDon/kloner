// app/login/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import NavBar from "@/components/NavBar";
import { auth } from "@/lib/firebase";

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
    type User,
} from "firebase/auth";
import type { FirebaseError } from "firebase/app";

const ACCENT = "#f55f2a";

type Mode = "signin" | "signup";

function isFirebaseError(e: unknown): e is FirebaseError {
    return typeof e === "object" && e !== null && "code" in e;
}

async function setSessionCookie(): Promise<void> {
    const u: User | null = auth.currentUser;
    if (!u) return;
    const idToken = await getIdToken(u, true);
    await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
        credentials: "include",
    });
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

export default function LoginPage(): JSX.Element {
    const router = useRouter();
    const search = useSearchParams();

    const [mode, setMode] = useState<Mode>("signin");
    const [loading, setLoading] = useState<boolean>(false);
    const [err, setErr] = useState<string>("");

    const [email, setEmail] = useState<string>("");
    const [pw, setPw] = useState<string>("");
    const [showPw, setShowPw] = useState<boolean>(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            if (u) {
                await setSessionCookie();
                const next = search.get("next") || "/dashboard";
                router.replace(next);
            }
        });
        return () => unsub();
    }, [router, search]);

    const signInWithGoogle = async (): Promise<void> => {
        setErr("");
        setLoading(true);
        try {
            await setPersistence(auth, browserLocalPersistence);
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: "select_account" });
            await signInWithPopup(auth, provider);
            await setSessionCookie();
        } catch (e) {
            setErr(normalizeError(e));
            setLoading(false);
        }
    };

    const submitEmail: React.FormEventHandler<HTMLFormElement> = async (e) => {
        e.preventDefault();
        setErr("");
        setLoading(true);
        try {
            await setPersistence(auth, browserLocalPersistence);
            if (!email || !pw) throw new Error("Enter email and password.");
            if (mode === "signin") {
                await signInWithEmailAndPassword(auth, email.trim(), pw);
            } else {
                await createUserWithEmailAndPassword(auth, email.trim(), pw);
            }
            await setSessionCookie();
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
                            : "Quick signup with email or Google."}
                    </p>
                </div>

                <form onSubmit={submitEmail} className="space-y-3">
                    <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-neutral-600">Email</label>
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
                        <label className="block text-xs font-medium text-neutral-600">Password</label>
                        <div className="flex items-stretch gap-2">
                            <input
                                type={showPw ? "text" : "password"}
                                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                                value={pw}
                                onChange={(e) => setPw(e.target.value)}
                                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none focus:ring-2"
                                placeholder={mode === "signin" ? "Your password" : "Create a strong password"}
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

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
                        style={{ backgroundColor: ACCENT }}
                    >
                        {loading ? (mode === "signin" ? "Signing in…" : "Creating…") : mode === "signin" ? "Sign in" : "Create account"}
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
                    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
                        <path
                            fill="#4285F4"
                            d="M21.35 11.1h-9.18v2.98h5.26c-.23 1.5-1.76 4.4-5.26 4.4-3.17 0-5.76-2.62-5.76-5.84s2.59-5.84 5.76-5.84c1.8 0 3.01.76 3.7 1.42l2.52-2.43C17.06 4.4 15 3.5 12.17 3.5 6.97 3.5 2.75 7.72 2.75 12.94S6.97 22.38 12.17 22.38c7.3 0 9.07-6.39 8.77-11.28z"
                        />
                    </svg>
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
                        onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
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
                        <span className="font-medium" style={{ color: ACCENT }}>Terms</span> and{" "}
                        <span className="font-medium" style={{ color: ACCENT }}>Privacy Policy</span>.
                    </div>
                </div>
            </div>
        </main>
    );
}
