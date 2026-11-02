export function isDashboardProjectAccessLocked({
    billingState,
    stripeStatus,
    cancelAtPeriodEnd,
    previewMode = false,
}: {
    billingState?: string | null;
    stripeStatus?: string | null;
    cancelAtPeriodEnd?: boolean;
    previewMode?: boolean;
}): boolean {
    const status = String(stripeStatus || "").trim().toLowerCase();

    return (
        previewMode ||
        billingState === "trial_cancelled" ||
        cancelAtPeriodEnd === true ||
        status === "canceled" ||
        status === "cancelled"
    );
}