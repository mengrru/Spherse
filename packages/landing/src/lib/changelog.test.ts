import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OSS_BASE = "https://mirror.example.com";
const CHANGELOG_URL = `${OSS_BASE}/spherse/changelog.json`;

const changelog = {
  generatedAt: "2026-08-28T10:00:00Z",
  releases: [
    {
      version: "0.3.1",
      tag: "v0.3.1",
      date: "2026-08-28",
      notes: [
        { type: "feat", text: "支持载入 .agents/skills" },
        { type: null, text: "无类型前缀条目" },
      ],
    },
  ],
};

async function loadChangelogModule() {
  vi.stubEnv("VITE_OSS_PUBLIC_BASE_URL", OSS_BASE);
  return import("./changelog");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchChangelog", () => {
  it("fetches the structured changelog from the OSS base url", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => changelog,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchChangelog } = await loadChangelogModule();
    await expect(fetchChangelog()).resolves.toEqual(changelog);
    expect(fetchMock).toHaveBeenCalledWith(CHANGELOG_URL);
  });

  it("throws when VITE_OSS_PUBLIC_BASE_URL is not configured", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("VITE_OSS_PUBLIC_BASE_URL", "");
    const { fetchChangelog } = await import("./changelog");
    await expect(fetchChangelog()).rejects.toThrow("VITE_OSS_PUBLIC_BASE_URL");
  });

  it("throws on http error responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
    const { fetchChangelog } = await loadChangelogModule();
    await expect(fetchChangelog()).rejects.toThrow("404");
  });

  it("throws when the fetch rejects (network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const { fetchChangelog } = await loadChangelogModule();
    await expect(fetchChangelog()).rejects.toThrow();
  });

  it("throws when the response body is not valid json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      })),
    );
    const { fetchChangelog } = await loadChangelogModule();
    await expect(fetchChangelog()).rejects.toThrow();
  });
});
