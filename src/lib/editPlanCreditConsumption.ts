export type EditPlanCreditChargeInput = {
    requestId: string | null | undefined;
    creditCost?: unknown;
    ops?: unknown;
    dbMigrations?: unknown;
    needsMoreContext?: boolean;
    isFreeCompileFixMode: boolean;
};

export type EditPlanCreditChargeDecision = {
    requestId: string | null;
    creditCost: number;
    hasChargeableWork: boolean;
    shouldConsume: boolean;
};

function normalizeRequestId(value: unknown): string | null {
    const text = typeof value === "string" ? value.trim() : "";
    return text || null;
}

function normalizeCreditCost(value: unknown): number {
    const numberValue = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 1;
    return Math.max(1, numberValue);
}

function hasChargeableOps(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    return value.some((op) => Boolean(op && typeof op === "object" && typeof (op as any).path === "string" && String((op as any).path).trim()));
}

function hasChargeableDbMigrations(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0;
}

export function resolveEditPlanCreditCharge(input: EditPlanCreditChargeInput): EditPlanCreditChargeDecision {
    const requestId = normalizeRequestId(input.requestId);
    const creditCost = normalizeCreditCost(input.creditCost);
    const hasChargeableWork = hasChargeableOps(input.ops) || hasChargeableDbMigrations(input.dbMigrations);

    return {
        requestId,
        creditCost,
        hasChargeableWork,
        shouldConsume: !input.isFreeCompileFixMode && Boolean(requestId) && !input.needsMoreContext,
    };
}
