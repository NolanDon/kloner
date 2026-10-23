jest.mock("firebase/auth", () => ({
    getIdToken: jest.fn(),
}));
jest.mock("@/lib/firebase", () => ({
    auth: {
        currentUser: null,
        authStateReady: jest.fn(),
    },
}));

import { getIdToken } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { bootstrapServerSession, ensureSessionAndCsrf, resetAuthClientCaches } from "./auth-client";

const mockedAuth = auth as any;
const mockedGetIdToken = getIdToken as jest.MockedFunction<typeof getIdToken>;

beforeEach(() => {
    resetAuthClientCaches();
    mockedAuth.currentUser = null;
    mockedAuth.authStateReady = jest.fn().mockResolvedValue(undefined);
    mockedGetIdToken.mockReset();
    jest.restoreAllMocks();
});

test("CSRF setup waits for Firebase's initial auth restore before creating a session", async () => {
    const user = { uid: "user-1" };
    mockedAuth.authStateReady = jest.fn(async () => {
        mockedAuth.currentUser = user;
    });
    mockedGetIdToken.mockResolvedValue("firebase-id-token" as any);
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (input) => {
        if (String(input) === "/api/auth/csrf") {
            const csrfCalls = fetchMock.mock.calls.filter(([url]) => String(url) === "/api/auth/csrf").length;
            return csrfCalls === 1
                ? ({ ok: false, status: 401 } as Response)
                : ({ ok: true, status: 200, json: async () => ({ csrf: "csrf-token" }) } as Response);
        }
        return { ok: true, status: 200 } as Response;
    });

    await expect(ensureSessionAndCsrf()).resolves.toBe("csrf-token");
    expect(mockedAuth.authStateReady).toHaveBeenCalledTimes(1);
    expect(mockedGetIdToken).toHaveBeenCalledWith(user, false);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        "/api/auth/csrf",
        "/api/auth/session",
        "/api/auth/csrf",
    ]);
});

test("session bootstrap reports no session when Firebase restores a signed-out state", async () => {
    await expect(bootstrapServerSession()).resolves.toBe(false);
    expect(mockedGetIdToken).not.toHaveBeenCalled();
});
