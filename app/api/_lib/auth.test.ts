const verifyCookie = jest.fn();
jest.mock("firebase-admin/app", () => ({ getApps: () => [{}] }));
jest.mock("firebase-admin/auth", () => ({ getAuth: () => ({ verifySessionCookie: verifyCookie }) }));
jest.mock("firebase-admin/firestore", () => ({}));
jest.mock("firebase-admin", () => ({}));
jest.mock("next/server", () => ({}));
import { verifySession } from "./auth";
const request = (token?: string) => ({ cookies: { get: () => token ? { value: token } : undefined } } as any);

test("missing sessions are rejected without invoking Firebase verification", async () => {
    await expect(verifySession(request())).rejects.toMatchObject({ status: 401 });
    expect(verifyCookie).not.toHaveBeenCalled();
});

test("known session rejection codes are retained without logging the token", async () => {
    verifyCookie.mockRejectedValueOnce({ code: "auth/session-cookie-expired" });
    await expect(verifySession(request("private-session"))).rejects.toMatchObject({ status: 401, authCode: "auth/session-cookie-expired", authVerificationUnavailable: false });
});

test("network and unexpected verifier failures are marked as unavailable", async () => {
    verifyCookie.mockRejectedValueOnce({ code: "app/network-error" });
    await expect(verifySession(request("private-session"))).rejects.toMatchObject({ authCode: "unknown", authVerificationUnavailable: true });
});
