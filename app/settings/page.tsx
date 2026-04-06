import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SettingsAliasPage({
    searchParams,
}: {
    searchParams?: Promise<SearchParams>;
}) {
    const resolvedSearchParams = await searchParams;
    const sp = new URLSearchParams();

    for (const [key, value] of Object.entries(resolvedSearchParams || {})) {
        if (Array.isArray(value)) {
            for (const v of value) sp.append(key, v);
        } else if (typeof value === "string") {
            sp.set(key, value);
        }
    }

    const qs = sp.toString();
    redirect(qs ? `/dashboard/settings?${qs}` : "/dashboard/settings");
}
