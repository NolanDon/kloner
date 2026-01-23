import { POST } from "@/app/api/previews/apply/route";

export { runtime, dynamic } from "@/app/api/previews/apply/route";

// Alias route.
// The canonical handler lives at /api/previews/apply and proxies to the hub's /webcontainer/apply.
export { POST };
