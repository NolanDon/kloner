/** @jest-environment node */
import { unzipSync } from "fflate";
import { buildProjectDownload, canDownloadProject, isExportableProjectPath } from "./projectDownload";

jest.mock("firebase-admin", () => ({ __esModule: true, default: { storage: () => ({ bucket: () => ({ file: () => ({ download: async () => [Buffer.from([0, 255, 137, 80])] }) }) }) } }));
jest.mock("./htmlStorage", () => ({ hydrateAppBuilderFiles: jest.fn() }));

test.each(["trialing", "past_due", "canceled", "unpaid", "incomplete", ""])("denies downloads for %s even with a pro tier", status => {
    expect(canDownloadProject({ tier: "pro", stripeStatus: status, stripeSubscriptionId: "sub" })).toBe(false);
});
test("requires an active paid subscription", () => {
    expect(canDownloadProject({ tier: "pro", stripeStatus: "active", stripeSubscriptionId: "sub" })).toBe(true);
    expect(canDownloadProject({ tier: "free", stripeStatus: "active", stripeSubscriptionId: "sub" })).toBe(false);
    expect(canDownloadProject({ tier: "agency", stripeStatus: "active" })).toBe(false);
});
test.each(["../secret", "/etc/passwd", "src/../../secret", "a\\b", ".env", "nested/.env.production", "node_modules/x", ".git/config"])("excludes unsafe or private path %s", path => expect(isExportableProjectPath(path)).toBe(false));

test("ZIP contains current editor changes and original binary bytes, excluding secrets", async () => {
    const data = await buildProjectDownload({ db: {}, uid: "owner", appId: "app", app: { files: {
        "index.html": { content: "saved" }, "image.png": { content: Buffer.from([137, 80, 0, 255]).toString("base64"), encoding: "base64" },
        "font.woff": { storagePath: "private/font" }, ".env": { content: "SECRET" }, "empty.txt": { content: "" },
    } }, currentFile: { path: "index.html", content: "unsaved editor change" } });
    const archive = unzipSync(data);
    expect(Buffer.from(archive["index.html"]).toString()).toBe("unsaved editor change");
    expect([...archive["image.png"]]).toEqual([137, 80, 0, 255]);
    expect([...archive["font.woff"]]).toEqual([0, 255, 137, 80]);
    expect(archive[".env"]).toBeUndefined();
    expect(archive["empty.txt"].length).toBe(0);
});

test("sharded export excludes deleted stale index entries and uses current shard content", async () => {
    const db: any = { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ collection: () => ({ get: async () => ({ docs: [
        { data: () => ({ path: "index.html", content: "live shard" }) },
        { data: () => ({ path: "deleted.html", content: "stale shard" }) },
    ] }) }) }) }) }) }) };
    const archive = unzipSync(await buildProjectDownload({ db, uid: "owner", appId: "app", app: { fileStorageMode: "sharded", files: { "index.html": { content: "" }, "deleted.html": { content: "old" } }, fileManifest: { files: [{ path: "index.html" }] } } }));
    expect(Object.keys(archive)).toEqual(["index.html"]);
    expect(Buffer.from(archive["index.html"]).toString()).toBe("live shard");
});
