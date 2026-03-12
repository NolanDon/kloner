describe("mixpanel wrapper", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_MIXPANEL_DISABLED: "0",
      NEXT_PUBLIC_MIXPANEL_TOKEN: "test-token",
    };

    (global as any).window = {
      location: { hostname: "example.com" },
      mixpanel: {},
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    delete (global as any).window;
  });

  function loadModuleWithMock() {
    const namedTrack = jest.fn();
    const namedRegister = jest.fn();
    const namedGetDistinctId = jest.fn(() => "preview-user");

    const mockMixpanel: any = {
      init: jest.fn((token: string, _options: unknown, name?: string): any => {
        if (name) {
          (global as any).window.mixpanel[name] = {
            track: namedTrack,
            register: namedRegister,
            get_distinct_id: namedGetDistinctId,
            __loaded: true,
          };
          return (global as any).window.mixpanel[name];
        }
        return mockMixpanel;
      }),
      track: jest.fn(),
      identify: jest.fn(),
      register: jest.fn(),
      reset: jest.fn(),
      people: { set: jest.fn() },
      start_session_recording: jest.fn(),
      stop_session_recording: jest.fn(),
      get_session_recording_properties: jest.fn(() => ({})),
      get_session_replay_url: jest.fn(() => null),
      __loaded: true,
    };

    jest.doMock("mixpanel-browser", () => ({
      __esModule: true,
      default: mockMixpanel,
    }));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./mixpanel") as typeof import("./mixpanel");

    return {
      mod,
      mockMixpanel,
      namedTrack,
      namedRegister,
      namedGetDistinctId,
    };
  }

  it("initializes preview_loader named instance once", () => {
    const { mod, mockMixpanel } = loadModuleWithMock();

    const one = mod.getMixpanelInstance(mod.PREVIEW_LOADER_MIXPANEL_INSTANCE);
    const two = mod.getMixpanelInstance(mod.PREVIEW_LOADER_MIXPANEL_INSTANCE);

    expect(one).not.toBeNull();
    expect(two).not.toBeNull();
    expect(mockMixpanel.init).toHaveBeenCalledTimes(1);
    expect(mockMixpanel.init).toHaveBeenCalledWith(
      "test-token",
      expect.any(Object),
      mod.PREVIEW_LOADER_MIXPANEL_INSTANCE,
    );
  });

  it("no-ops cleanly when token is missing", () => {
    process.env.NEXT_PUBLIC_MIXPANEL_TOKEN = "";
    const { mod, mockMixpanel } = loadModuleWithMock();

    expect(() => mod.trackMixpanel("Preview Loaded")).not.toThrow();
    expect(mockMixpanel.init).not.toHaveBeenCalled();
    expect(mockMixpanel.track).not.toHaveBeenCalled();
  });

  it("tracks preview events through named instance when available", () => {
    const { mod, namedTrack } = loadModuleWithMock();

    mod.trackMixpanel("Preview Loaded", { source: "iframe" }, mod.PREVIEW_LOADER_MIXPANEL_INSTANCE);

    expect(namedTrack).toHaveBeenCalledWith("Preview Loaded", { source: "iframe" });
  });
});
