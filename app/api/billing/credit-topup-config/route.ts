import { NextResponse } from "next/server";
import { getTopupCatalogConfig } from "@/src/lib/topupCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    return NextResponse.json(getTopupCatalogConfig());
}
