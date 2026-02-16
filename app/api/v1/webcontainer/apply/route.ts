import { POST } from "@/app/api/previews/apply/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Alias route.
// The canonical handler lives at /api/previews/apply and proxies to the hub's /webcontainer/apply.
export { POST };
