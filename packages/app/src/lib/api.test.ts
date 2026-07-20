import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, buildWsUrl } from "./api";

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

  describe("access token", () => {
    it("injects Authorization Bearer header on requests when token provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
      vi.stubGlobal("fetch", fetchMock);
      await createApiClient("http://localhost:1234", "project-1", "tok-abc").listAgents();
      expect(fetchMock).toHaveBeenCalled();
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-abc");
    });

    it("does not set Authorization header when no token is provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
      vi.stubGlobal("fetch", fetchMock);
      await createApiClient("http://localhost:1234", "project-1").listAgents();
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it("embeds token in preview path when token provided", () => {
      const url = createApiClient("http://localhost:1234", "project-1", "tok-abc").getPreviewUrl("a/b.png");
      expect(url).toBe("http://localhost:1234/api/projects/project-1/preview/__auth/tok-abc/a/b.png");
    });

    it("URL-encodes special characters in the path token", () => {
      const url = createApiClient("http://localhost:1234", "project-1", "tok+abc/x").getPreviewUrl("a/b.png");
      expect(url).toBe("http://localhost:1234/api/projects/project-1/preview/__auth/tok%2Babc%2Fx/a/b.png");
    });

    it("supports version cache-bust on top of path token", () => {
      const url = createApiClient("http://localhost:1234", "project-1", "tok-abc").getPreviewUrl("a/b.png", 3);
      expect(url).toBe("http://localhost:1234/api/projects/project-1/preview/__auth/tok-abc/a/b.png?v=3");
    });
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

  describe("buildWsUrl", () => {
    it("converts http to ws and appends path", () => {
      expect(buildWsUrl("http://localhost:1234", "/ws/bus")).toBe("ws://localhost:1234/ws/bus");
    });

    it("appends token query when token provided", () => {
      expect(buildWsUrl("http://localhost:1234", "/ws/bus", "tok-abc")).toBe("ws://localhost:1234/ws/bus?token=tok-abc");
    });

    it("encodes special characters in the token", () => {
      expect(buildWsUrl("http://localhost:1234", "/ws/bus", "tok+&=x")).toBe("ws://localhost:1234/ws/bus?token=tok%2B%26%3Dx");
    });

    it("preserves existing query parameters when appending token", () => {
      expect(buildWsUrl("http://localhost:1234", "/ws/bus?foo=bar", "tok-abc")).toBe("ws://localhost:1234/ws/bus?foo=bar&token=tok-abc");
    });

    it("handles https urls", () => {
      expect(buildWsUrl("https://tunnel.example.com", "/ws/bus", "tok")).toBe("wss://tunnel.example.com/ws/bus?token=tok");
    });
  });
});
