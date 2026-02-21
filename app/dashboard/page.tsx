import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

export default function DashboardPage({
    searchParams,
}: {
    searchParams?: SearchParams;
}) {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(searchParams || {})) {
        if (value == null) continue;
        if (Array.isArray(value)) {
            for (const v of value) params.append(key, v);
        } else {
            params.set(key, value);
        }
    }

    const qs = params.toString();
    redirect(qs ? `/dashboard/view?${qs}` : "/dashboard/view");
}
