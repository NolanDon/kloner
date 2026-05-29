"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/src/hooks/useAuth";
import { useModal } from "@/components/ui/ModalContext";
import SuccessConfetti from "@/components/tools/SuccessConfetti";

const TOPUP_RETURN_HANDLED_PREFIX = "kloner.topup.return.handled:";

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
    const { user, loading: authLoading } = useAuth();
    const { showAlert } = useModal();
    const handledRef = useRef(false);
    const [topupSuccessCredits, setTopupSuccessCredits] = useState<number | null>(null);

    useEffect(() => {
        if (handledRef.current) return;
        if (typeof window === "undefined") return;
        if (authLoading) return;

        const url = new URL(window.location.href);
        const topup = url.searchParams.get("topup");
        const sessionId = url.searchParams.get("session_id");

        if (!topup) return;
        if (topup !== "success" && topup !== "cancel") return;

        const processedKey = `${TOPUP_RETURN_HANDLED_PREFIX}${topup}:${sessionId || "missing"}`;

        const wasProcessed = (() => {
            try {
                return window.sessionStorage.getItem(processedKey) === "1";
            } catch {
                return false;
            }
        })();

        const markProcessed = () => {
            try {
                window.sessionStorage.setItem(processedKey, "1");
            } catch {
                // ignore
            }
        };

        if (wasProcessed) {
            url.searchParams.delete("topup");
            url.searchParams.delete("session_id");
            window.history.replaceState({}, "", url.toString());
            return;
        }

        handledRef.current = true;

        const notifyOpener = (payload: Record<string, unknown>): boolean => {
            try {
                if (!window.opener || window.opener.closed) return false;
                window.opener.postMessage(
                    {
                        type: "kloner:credit-topup",
                        ...payload,
                    },
                    window.location.origin,
                );
                return true;
            } catch {
                return false;
            }
        };

        const closePopupIfPossible = () => {
            if (!window.opener || window.opener.closed) return;
            try {
                window.close();
            } catch {
                // ignore
            }
        };

        const cleanup = () => {
            url.searchParams.delete("topup");
            url.searchParams.delete("session_id");
            window.history.replaceState({}, "", url.toString());
        };

        if (topup === "cancel") {
            markProcessed();
            if (notifyOpener({ status: "cancel" })) {
                cleanup();
                closePopupIfPossible();
                return;
            }

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
            markProcessed();
            notifyOpener({ status: "error", error: "Missing checkout session id." });
            cleanup();
            closePopupIfPossible();
            return;
        }

        markProcessed();

        void (async () => {
            try {
                const csrf = await fetchCsrf();
                const idToken = await user?.getIdToken?.().catch(() => null);
                const res = await fetch("/api/billing/confirm-credit-topup", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(csrf ? { "x-csrf": csrf } : {}),
                        ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
                    },
                    credentials: "include",
                    cache: "no-store",
                    body: JSON.stringify({ sessionId }),
                });

                const data = (await res.json().catch(() => ({}))) as any;

                if (res.ok) {
                    const credits = typeof data?.credits === "number" ? data.credits : null;
                    if (notifyOpener({ status: "success", credits })) {
                        return;
                    }
                    setTopupSuccessCredits(credits);
                } else {
                    const errorMessage =
                        typeof data?.error === "string" && data.error
                            ? data.error
                            : "Could not confirm your top-up yet. If you were charged, it may apply shortly.";

                    if (notifyOpener({ status: "error", error: errorMessage })) {
                        return;
                    }
                    await showAlert(
                        errorMessage,
                        "Top up",
                    );
                }
            } catch {
                if (
                    notifyOpener({
                        status: "error",
                        error: "Could not confirm your top-up yet. If you were charged, it may apply shortly.",
                    })
                ) {
                    return;
                }
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
                closePopupIfPossible();
            }
        })();
    }, [authLoading, showAlert, user]);

    return (
        <SuccessConfetti
            open={topupSuccessCredits !== null}
            title="Credits added"
            message={
                topupSuccessCredits !== null
                    ? `Added ${topupSuccessCredits.toLocaleString()} AI credits to your account.`
                    : "Top-up confirmed."
            }
            onDismiss={() => setTopupSuccessCredits(null)}
        />
    );
}
