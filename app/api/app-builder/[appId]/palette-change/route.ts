import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAdminDb } from "../../../_lib/auth";
import { requireSessionAndMaybeCsrf } from "../../../_lib/route-guard";
import { assertAppBuilderScope } from "../../../_lib/appBuilderScope";
import { EDITOR_COLOR_PRESETS, paletteTokens } from "@/src/lib/editorColorPresets";
export const runtime = "nodejs";
export async function POST(req: NextRequest, { params }: any) {
 return requireSessionAndMaybeCsrf(req, async ({uid, req: authed}) => {
  const {appId} = await params; assertAppBuilderScope(authed, uid, appId);
  const body = await authed.json(); const preset = EDITOR_COLOR_PRESETS.find(item => item.id === body.presetId);
  if (!preset) return NextResponse.json({error:'Choose a color scheme.'},{status:400});
  const app = getAdminDb().collection('kloner_users').doc(uid).collection('kloner_apps').doc(appId);
  if (!(await app.get()).exists) return NextResponse.json({error:'Project not found.'},{status:404});
  const allowed = new Set(['color','background-color','border-color','background-image','fill','stroke']);
  const changes = (Array.isArray(body.changes) ? body.changes : []).slice(0,1500).filter((change: any) => typeof change?.selector === 'string' && change.selector.length <= 500 && !/[{}<>]/.test(change.selector) && allowed.has(change.property) && (/^#[0-9a-f]{6}$/i.test(change.value) || /^linear-gradient\(135deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/i.test(change.value)));
  if (!changes.length) return NextResponse.json({error:'Preview the color scheme before saving.'},{status:400});
  const id=randomUUID(); await app.collection('palette_requests').doc(id).set({name:preset.name,tokens:paletteTokens(preset),changes,status:'pending',createdAt:new Date()});
  return NextResponse.json({id,summary:`Apply the ${preset.name} color scheme.`});
 });
}
