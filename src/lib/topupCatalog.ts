export type TopupPresetId = "popular" | "starter" | "boost";

export type TopupPresetConfig = {
    id: TopupPresetId;
    label: string;
    badge: string;
    credits: number;
    order: number;
    priceId: string | null;
    priceEnvKey: string;
    amountCents: number;
    available: boolean;
};

export type TopupCatalogConfig = {
    currency: string;
    unitPriceCents: number;
    minCredits: number;
    maxCredits: number;
    stepCredits: number;
    presets: TopupPresetConfig[];
};

const STRATEGIC_MIN_UNIT_PRICE_CENTS = 8;
const DEFAULT_UNIT_PRICE_CENTS = 10;

type PresetSeed = {
    id: TopupPresetId;
    label: string;
    badge: string;
    credits: number;
    order: number;
    testEnv: string;
    prodEnv: string;
};

const PRESET_SEEDS: PresetSeed[] = [
    {
        id: "popular",
        label: "400 credits",
        badge: "Most popular",
        credits: 400,
        order: 0,
        testEnv: "STRIPE_PRICE_TOPUP_400_TEST",
        prodEnv: "STRIPE_PRICE_TOPUP_400_PROD",
    },
    {
        id: "starter",
        label: "100 credits",
        badge: "Starter",
        credits: 100,
        order: 1,
        testEnv: "STRIPE_PRICE_TOPUP_100_TEST",
        prodEnv: "STRIPE_PRICE_TOPUP_100_PROD",
    },
    {
        id: "boost",
        label: "1000 credits",
        badge: "Best value",
        credits: 1000,
        order: 2,
        testEnv: "STRIPE_PRICE_TOPUP_1000_TEST",
        prodEnv: "STRIPE_PRICE_TOPUP_1000_PROD",
    },
];

export function readIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : fallback;
}

export function getTopupUnitPriceCents(): number {
    return Math.max(
        STRATEGIC_MIN_UNIT_PRICE_CENTS,
        readIntEnv("STRIPE_AI_EDIT_CREDIT_UNIT_PRICE_CENTS", DEFAULT_UNIT_PRICE_CENTS),
    );
}

export function getTopupCurrency(): string {
    return (process.env.STRIPE_AI_EDIT_TOPUP_CURRENCY || "usd").toLowerCase();
}

export function getTopupBounds() {
    return {
        minCredits: readIntEnv("STRIPE_AI_EDIT_TOPUP_MIN_CREDITS", 50),
        maxCredits: readIntEnv("STRIPE_AI_EDIT_TOPUP_MAX_CREDITS", 5000),
        stepCredits: readIntEnv("STRIPE_AI_EDIT_TOPUP_STEP_CREDITS", 50),
    };
}

export function getTopupPriceIdForPreset(presetId: TopupPresetId): string | null {
    const seed = PRESET_SEEDS.find((preset) => preset.id === presetId);
    if (!seed) return null;

    const isProd = process.env.NODE_ENV === "production";
    const envKey = isProd ? seed.prodEnv : seed.testEnv;
    const raw = process.env[envKey];
    const value = typeof raw === "string" ? raw.trim() : "";
    return value || null;
}

export function getTopupPresets(): TopupPresetConfig[] {
    const unitPriceCents = getTopupUnitPriceCents();

    return PRESET_SEEDS.slice()
        .sort((a, b) => a.order - b.order)
        .map((seed) => {
            const priceId = getTopupPriceIdForPreset(seed.id);
            return {
                id: seed.id,
                label: seed.label,
                badge: seed.badge,
                credits: seed.credits,
                order: seed.order,
                priceId,
                priceEnvKey: process.env.NODE_ENV === "production" ? seed.prodEnv : seed.testEnv,
                amountCents: seed.credits * unitPriceCents,
                available: Boolean(priceId),
            };
        });
}

export function getTopupCatalogConfig(): TopupCatalogConfig {
    const { minCredits, maxCredits, stepCredits } = getTopupBounds();

    return {
        currency: getTopupCurrency(),
        unitPriceCents: getTopupUnitPriceCents(),
        minCredits,
        maxCredits,
        stepCredits,
        presets: getTopupPresets(),
    };
}

export function resolveTopupPreset(input: string | null | undefined): TopupPresetConfig | null {
    const value = String(input || "").trim().toLowerCase();
    if (!value) return null;
    return getTopupPresets().find((preset) => preset.id === value) || null;
}
