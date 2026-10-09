jest.mock("@/app/api/_lib/auth", () => ({ getAdminDb: jest.fn() }));
jest.mock("@/app/api/_lib/route-guard", () => ({ requireSessionAndMaybeCsrf: jest.fn((req, fn) => fn({ uid: "owner", req })) }));
jest.mock("@/app/api/_lib/appBuilderScope", () => ({ assertAppBuilderScope: jest.fn() }));
jest.mock("@/src/lib/callBackend", () => ({ callBackend: jest.fn() }));

import { getAdminDb } from "./auth";
import { assertAppBuilderScope } from "./appBuilderScope";
import { callBackend } from "@/src/lib/callBackend";
import { GET } from "../app-builder/[appId]/restore-points/route";
import { POST as apply } from "../app-builder/[appId]/restore-points/[restoreId]/apply/route";
import { POST as keep } from "../app-builder/[appId]/restore-points/[restoreId]/keep/route";
import { NextRequest } from "next/server";

function setup(exists = true) {
    const writes = jest.fn();
    const legacyDoc: any = { id: "rp", exists: false, data: () => ({}) };
    const workspaceDoc: any = { id: "rp", exists, data: () => ({ touchedPaths: ["index.html"], requestId: "backend-req" }), set: writes };
    const workspace: any = { doc: () => workspaceDoc };
    const appRef: any = {
        get: async () => ({ exists: true }), update: writes,
        collection: (name: string) => {
            if (name === "restore_points") return legacy;
            expect(name).toBe("workspace_agent_v3_restore_points");
            return workspace;
        },
    };
    const legacy: any = { parent: appRef, doc: () => legacyDoc };
    legacyDoc.parent = legacy;
    legacyDoc.get = async () => legacyDoc;
    workspaceDoc.get = async () => workspaceDoc;
    workspaceDoc.ref = { collection: () => ({ get: async () => ({ docs: [{ data: () => ({ path: "index.html", exists: true, content: "saved" }) }] }) }) };
    (getAdminDb as jest.Mock).mockReturnValue({ collection: (name: string) => {
        expect(name).toBe("kloner_users");
        return { doc: (uid: string) => { expect(uid).toBe("owner"); return { collection: (child: string) => {
            expect(child).toBe("kloner_apps"); return { doc: (appId: string) => { expect(appId).toBe("owned-app"); return appRef; } };
        } }; } };
    } });
    return writes;
}
const params = Promise.resolve({ appId: "owned-app", restoreId: "rp" });
beforeEach(() => jest.clearAllMocks());

test("details find saved V3 snapshots within the authenticated app scope", async () => {
    setup();
    const req = new NextRequest("https://kloner.app/api/restore?restoreId=rp");
    const result = await GET(req, { params });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ id: "rp", before: { "index.html": "saved" }, source: "workspace_autonomy_v3" });
    expect(assertAppBuilderScope).toHaveBeenCalledWith(req, "owner", "owned-app");
});
test("V3 apply forwards guarded restore conflicts instead of writing the legacy files map", async () => {
    const writes = setup();
    (callBackend as jest.Mock).mockResolvedValue({ status: 409, json: { code: "RESTORE_CONFLICT", ok: false } });
    const req = new NextRequest("https://kloner.app/api/restore/apply", { method: "POST" });
    const result = await apply(req, { params });
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "RESTORE_CONFLICT" });
    expect(callBackend).toHaveBeenCalledWith(req, expect.objectContaining({ userCtx: { uid: "owner" }, body: { appId: "owned-app", restorePointId: "rp" }, path: "/app-embeddings/agent-v3/restore-points/rp/revert" }));
    expect(writes).not.toHaveBeenCalled();
});
test("keep updates the V3 record; actually missing restore points still return 404", async () => {
    const writes = setup();
    const req = new NextRequest("https://kloner.app/api/restore/keep", { method: "POST" });
    expect((await keep(req, { params })).status).toBe(200);
    expect(writes).toHaveBeenCalledWith({ kept: true }, { merge: true });
    setup(false);
    expect((await GET(new NextRequest("https://kloner.app/api/restore?restoreId=rp"), { params })).status).toBe(404);
    expect((await apply(req, { params })).status).toBe(404);
});
