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
});
