"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/src/hooks/useAuth";
import { useModal } from "@/components/ui/ModalContext";

async function fetchCsrf(): Promise<string | null> {
    try {
        const res = await fetch("/api/auth/csrf", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            cache: "no-store",
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        const csrf = (data as any)?.csrf;
        return typeof csrf === "string" && csrf ? csrf : null;
    } catch {
        return null;
    }
}

export default function CreditTopupReturnHandler(): JSX.Element | null {
    const { loading: authLoading } = useAuth();
    const { showAlert } = useModal();
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;
        if (typeof window === "undefined") return;
        if (authLoading) return;

        const url = new URL(window.location.href);
        const topup = url.searchParams.get("topup");
        const sessionId = url.searchParams.get("session_id");

        if (!topup) return;
        if (topup !== "success" && topup !== "cancel") return;

        handledRef.current = true;

        const cleanup = () => {
            url.searchParams.delete("topup");
            url.searchParams.delete("session_id");
            window.history.replaceState({}, "", url.toString());
        };

        if (topup === "cancel") {
            void (async () => {
                try {
                    await showAlert("Checkout canceled.", "Top up");
                } catch {
                    // ignore
                } finally {
                    cleanup();
                }
            })();
            return;
        }

        if (!sessionId) {
            cleanup();
            return;
        }

        void (async () => {
            try {
                const csrf = await fetchCsrf();
                const res = await fetch("/api/billing/confirm-credit-topup", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                    },
                    credentials: "include",
                    cache: "no-store",
                    body: JSON.stringify({ sessionId }),
                });

                const data = (await res.json().catch(() => ({}))) as any;

                if (res.ok) {
                    const credits = typeof data?.credits === "number" ? data.credits : null;
                    await showAlert(
                        credits ? `Added ${credits.toLocaleString()} AI credits to your account.` : "Top-up confirmed.",
                        "Credits added",
                    );
                } else {
                    await showAlert(
                        typeof data?.error === "string" && data.error ? data.error : "Could not confirm your top-up yet. If you were charged, it may apply shortly.",
                        "Top up",
                    );
                }
            } catch {
                try {
                    await showAlert(
                        "Could not confirm your top-up yet. If you were charged, it may apply shortly.",
                        "Top up",
                    );
                } catch {
                    // ignore
                }
            } finally {
                cleanup();
            }
        })();
    }, [authLoading, showAlert]);

    return null;
}
