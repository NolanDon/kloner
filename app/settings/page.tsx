import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

export default function SettingsAliasPage({
    searchParams,
}: {
    searchParams?: SearchParams;
}) {
    const sp = new URLSearchParams();

    for (const [key, value] of Object.entries(searchParams || {})) {
        if (Array.isArray(value)) {
            for (const v of value) sp.append(key, v);
        } else if (typeof value === "string") {
            sp.set(key, value);
        }
    }

    const qs = sp.toString();
    redirect(qs ? `/dashboard/settings?${qs}` : "/dashboard/settings");
}
