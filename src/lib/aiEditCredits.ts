/** The server-owned cost for one chargeable AI edit. */
export const AI_EDIT_CREDIT_COST = 3;

/**
 * Browser input is intentionally ignored. It is not an authorization to set
 * the amount charged to the user's account.
 */
export function getAuthoritativeAiEditCreditCost(_requestedCost?: unknown): number {
    void _requestedCost;
    return AI_EDIT_CREDIT_COST;
}
