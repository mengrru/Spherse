import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("createApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps agent creation response shape separate from session schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, id: "agent-1" })));

    await expect(createApiClient("http://localhost:1234", "project-1").createAgent("agent", "content")).resolves.toEqual({
      ok: true,
      id: "agent-1",
    });
  });

  it("validates renamed session responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, id: "session-1" })));

    await expect(createApiClient("http://localhost:1234", "project-1").renameSession("agent-1", "session-1", "Title")).rejects.toThrow(
      /Invalid payload/,
    );
  });

  describe("getPreviewUrl", () => {
    it("returns a stable URL without query when no version is provided", () => {
      const url = createApiClient("http://localhost:1234", "project-1").getPreviewUrl("assets/icon.svg");
      expect(url).toBe("http://localhost:1234/api/projects/project-1/preview/assets/icon.svg");
    });

    it("appends a cache-bust version query when a version is provided", () => {
      const url = createApiClient("http://localhost:1234", "project-1").getPreviewUrl("assets/icon.svg", 3);
      expect(url).toBe("http://localhost:1234/api/projects/project-1/preview/assets/icon.svg?v=3");
    });

    it("appends the query even when version is 0", () => {
      const url = createApiClient("http://localhost:1234", "project-1").getPreviewUrl("a/b.png", 0);
      expect(url).toBe("http://localhost:1234/api/projects/project-1/preview/a/b.png?v=0");
    });

    it("encodes path segments while keeping the version query intact", () => {
      const url = createApiClient("http://localhost:1234", "project-1").getPreviewUrl("a b/c.svg", 7);
      expect(url).toBe("http://localhost:1234/api/projects/project-1/preview/a%20b/c.svg?v=7");
    });
  });
});
