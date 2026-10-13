import { requestEditorNavigation } from "./editorNavigation";

test("blocked access never refreshes or starts navigation", async () => {
    const refreshSession = jest.fn(), navigate = jest.fn();
    expect(await requestEditorNavigation({ accessRevoked: true, refreshSession, navigate })).toMatchObject({ ok: false, code: "EDITOR_ACCESS_REVOKED" });
    expect(refreshSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
});

test.each([false, "throw"])("session failure is explicit and never navigates: %s", async failure => {
    const navigate = jest.fn();
    const refreshSession = async () => { if (failure === "throw") throw new Error("network"); return false; };
    expect(await requestEditorNavigation({ accessRevoked: false, refreshSession, navigate })).toMatchObject({ ok: false, code: "EDITOR_SESSION_REFRESH_FAILED" });
    expect(navigate).not.toHaveBeenCalled();
});

test("navigation awaits session refresh and reports synchronous navigation failures", async () => {
    const calls: string[] = [];
    const refreshSession = async () => { calls.push("session"); return true; };
    expect(await requestEditorNavigation({ accessRevoked: false, refreshSession, navigate: () => { calls.push("navigate"); } })).toEqual({ ok: true });
    expect(calls).toEqual(["session", "navigate"]);
    expect(await requestEditorNavigation({ accessRevoked: false, refreshSession, navigate: () => { throw new Error("blocked navigation"); } })).toMatchObject({ ok: false, code: "EDITOR_NAVIGATION_FAILED" });
});

test("exiting while session refresh is pending cannot navigate later", async () => {
    const controller = new AbortController(), navigate = jest.fn();
    let finish!: (value: boolean) => void;
    const refreshSession = () => new Promise<boolean>(resolve => { finish = resolve; });
    const pending = requestEditorNavigation({ accessRevoked: false, refreshSession, navigate, signal: controller.signal });
    controller.abort();
    finish(true);
    expect(await pending).toMatchObject({ ok: false, code: "EDITOR_NAVIGATION_CANCELLED" });
    expect(navigate).not.toHaveBeenCalled();
});
