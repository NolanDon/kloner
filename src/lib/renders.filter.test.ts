import { filterRendersForBuilder } from "./renders";

type R = {
  id: string;
  url?: string | null;
  urlHash?: string | null;
  key?: string | null;
  source?: string | null;
  archived?: boolean;
};

describe("filterRendersForBuilder", () => {
  it("shows the only render even if it doesn't match targetUrl", () => {
    const all: R[] = [
      {
        id: "r1",
        url: null,
        urlHash: null,
        key: null,
        source: "webapp",
        archived: false,
      },
    ];

    const out = filterRendersForBuilder({
      all,
      targetUrl: "https://example.com",
      targetHash: "abc123",
    });

    expect(out.map((r) => r.id)).toEqual(["r1"]);
  });

  it("matches by normalized url (trailing slash)", () => {
    const all: R[] = [
      { id: "r1", url: "https://example.com/", archived: false },
      { id: "r2", url: "https://other.com/", archived: false },
    ];

    const out = filterRendersForBuilder({
      all,
      targetUrl: "https://example.com",
    });

    expect(out.map((r) => r.id)).toEqual(["r1"]);
  });

  it("always includes community remixes", () => {
    const all: R[] = [
      {
        id: "r1",
        url: null,
        urlHash: null,
        key: null,
        source: "community_remix",
        archived: false,
      },
    ];

    const out = filterRendersForBuilder({
      all,
      targetUrl: "https://example.com",
      targetHash: "zzz",
    });

    expect(out.map((r) => r.id)).toEqual(["r1"]);
  });

  it("excludes archived renders", () => {
    const all: R[] = [
      { id: "r1", url: "https://example.com", archived: true },
      { id: "r2", url: "https://example.com", archived: false },
    ];

    const out = filterRendersForBuilder({
      all,
      targetUrl: "https://example.com",
    });

    expect(out.map((r) => r.id)).toEqual(["r2"]);
  });
});
