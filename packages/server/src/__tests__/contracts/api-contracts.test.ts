import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  parseApiResponse,
  parseChatClientMessage,
  parseChatServerEvent,
  schemas,
} from "../../contracts/index.js";

describe("api contracts", () => {
  it("accepts valid chat websocket client messages", () => {
    expect(parseChatClientMessage({ type: "message", content: "hello" })).toEqual({
      type: "message",
      content: "hello",
    });
    expect(parseChatClientMessage({ type: "abort" })).toEqual({ type: "abort" });
    expect(parseChatClientMessage({ type: "ping" })).toEqual({ type: "ping" });
  });

  it("rejects malformed chat websocket client messages", () => {
    expect(() => parseChatClientMessage({ type: "message" })).toThrow(/Invalid payload/);
    expect(() => parseChatClientMessage("not-json")).toThrow(/Invalid payload/);
  });

  it("accepts known chat server events", () => {
    expect(parseChatServerEvent({ type: "agent_start" })).toEqual({
      type: "agent_start",
    });
    expect(parseChatServerEvent({ type: "turn_start" })).toEqual({
      type: "turn_start",
    });
    expect(parseChatServerEvent({ type: "message_start", message: { role: "user" } })).toEqual({
      type: "message_start",
      message: { role: "user" },
    });
    expect(parseChatServerEvent({ type: "turn_end", message: {}, toolResults: [] })).toEqual({
      type: "turn_end",
      message: {},
      toolResults: [],
    });
    expect(parseChatServerEvent({ type: "agent_end", messages: [] })).toEqual({
      type: "agent_end",
      messages: [],
    });
    expect(parseChatServerEvent({ type: "error", message: "boom" })).toEqual({
      type: "error",
      message: "boom",
    });
    expect(
      parseChatServerEvent({ type: "error", message: "x", code: "MODEL_NOT_CONFIGURED" }),
    ).toEqual({ type: "error", message: "x", code: "MODEL_NOT_CONFIGURED" });
    expect(
      parseChatServerEvent({ type: "error", message: "y", code: "UNKNOWN" }),
    ).toEqual({ type: "error", message: "y", code: "UNKNOWN" });
    expect(parseChatServerEvent({ type: "pong" })).toEqual({ type: "pong" });
  });

  it("rejects malformed known chat server events", () => {
    expect(() => parseChatServerEvent({ type: "error" })).toThrow(/Invalid payload/);
    expect(() =>
      parseChatServerEvent({ type: "error", message: "x", code: "UNKNOWN_CODE" }),
    ).toThrow(/Invalid payload/);
    expect(() => parseChatServerEvent({ type: "message_start" })).toThrow(/Invalid payload/);
    expect(() => parseChatServerEvent({ type: "turn_end", message: {} })).toThrow(/Invalid payload/);
    expect(() => parseChatServerEvent({ type: "agent_end" })).toThrow(/Invalid payload/);
    expect(() => parseChatServerEvent({ type: "unknown_event" })).toThrow(/Invalid payload/);
  });

  it("validates named API responses", () => {
    expect(parseApiResponse(schemas.okResponse, { ok: true })).toEqual({ ok: true });
    expect(() => parseApiResponse(schemas.okResponse, { ok: "true" })).toThrow(/Invalid payload/);
  });

  it("validates agent profile, create, and update payloads", () => {
    const profile = {
      id: "a1",
      name: "Agent",
      slug: "agent",
      createdAt: 1,
      systemPrompt: "p",
      filePath: "agent.md",
    };
    expect(parseApiResponse(schemas.agentProfile, profile)).toEqual(profile);
    expect(parseApiResponse(schemas.agentProfile, { ...profile, output: { path: "out", naming: "tpl" } })).toMatchObject({
      output: { path: "out", naming: "tpl" },
    });
    expect(() => parseApiResponse(schemas.agentProfile, { id: "a1" })).toThrow(/Invalid payload/);

    expect(parseApiResponse(schemas.agentCreateRequest, { slug: "s", content: "c" })).toEqual({ slug: "s", content: "c" });
    expect(() => parseApiResponse(schemas.agentCreateRequest, { content: "c" })).toThrow(/Invalid payload/);
    expect(parseApiResponse(schemas.agentCreateResponse, { ok: true, id: "a1" })).toEqual({ ok: true, id: "a1" });
  });

  it("validates session list and messages responses", () => {
    expect(parseApiResponse(schemas.sessionListResponse, [])).toEqual([]);
    expect(() => parseApiResponse(schemas.sessionListResponse, "nope")).toThrow(/Invalid payload/);
    expect(parseApiResponse(schemas.sessionMessagesResponse, [{ role: "user" }])).toEqual([{ role: "user" }]);
  });

  it("validates session list page response envelope", () => {
    const item = {
      id: "s1",
      agentId: "a1",
      createdAt: 1,
      updatedAt: 2,
      status: "active",
    };
    expect(parseApiResponse(schemas.sessionListPageResponse, { items: [item], hasMore: true })).toEqual({
      items: [item],
      hasMore: true,
    });
    expect(() => parseApiResponse(schemas.sessionListPageResponse, { items: [] })).toThrow(/Invalid payload/);
    expect(() =>
      parseApiResponse(schemas.sessionListPageResponse, { items: [], hasMore: "no" }),
    ).toThrow(/Invalid payload/);
  });

  it("validates session status response", () => {
    expect(parseApiResponse(schemas.sessionStatus, { currentTokens: 512, contextWindowLimit: 32768 })).toEqual({
      currentTokens: 512,
      contextWindowLimit: 32768,
    });
    expect(parseApiResponse(schemas.sessionStatus, { currentTokens: 0, contextWindowLimit: null })).toEqual({
      currentTokens: 0,
      contextWindowLimit: null,
    });
    expect(() => parseApiResponse(schemas.sessionStatus, { currentTokens: "x" })).toThrow(/Invalid payload/);
    expect(() =>
      parseApiResponse(schemas.sessionStatus, { currentTokens: 1, contextWindowLimit: "no" }),
    ).toThrow(/Invalid payload/);
  });

  it("validates schedule list response with nextTriggerAt", () => {
    const entry = {
      id: "s1",
      enabled: true,
      cron: "* * * * *",
      mode: "new_session",
      message: "hi",
      notify: false,
      createdAt: 1,
      updatedAt: 1,
      nextTriggerAt: null,
    };
    expect(parseApiResponse(schemas.scheduleListResponse, [entry])).toEqual([entry]);
    expect(() =>
      parseApiResponse(schemas.scheduleListResponse, [{ ...entry, nextTriggerAt: undefined }]),
    ).toThrow(/Invalid payload/);
  });

  it("validates skill list response", () => {
    const skill = { name: "n", description: "d", instructions: "i", filePath: "n.md", source: "builtin", files: [] };
    expect(parseApiResponse(schemas.skillListResponse, [skill])).toEqual([skill]);
    expect(() => parseApiResponse(schemas.skillDefinition, { name: "n" })).toThrow(/Invalid payload/);
    expect(() =>
      parseApiResponse(schemas.skillDefinition, { name: "n", description: "d", instructions: "i", filePath: "n.md" }),
    ).toThrow(/Invalid payload/);
    expect(() =>
      parseApiResponse(schemas.skillDefinition, {
        name: "n",
        description: "d",
        instructions: "i",
        filePath: "n.md",
        source: "builtin",
      }),
    ).toThrow(/Invalid payload/);
    expect(() =>
      parseApiResponse(schemas.skillDefinition, {
        name: "n",
        description: "d",
        instructions: "i",
        filePath: "n.md",
        source: "unknown",
        files: [],
      }),
    ).toThrow(/Invalid payload/);
  });

  it("validates skill create and install requests", () => {
    expect(
      parseApiResponse(schemas.skillCreateRequest, { name: "x", description: "d", instructions: "i" }),
    ).toEqual({ name: "x", description: "d", instructions: "i" });
    expect(() => parseApiResponse(schemas.skillCreateRequest, { name: "x" })).toThrow(/Invalid payload/);
    expect(parseApiResponse(schemas.skillInstallRequest, { zipPath: "/a/b.zip" })).toEqual({ zipPath: "/a/b.zip" });
    expect(() => parseApiResponse(schemas.skillInstallRequest, {})).toThrow(/Invalid payload/);
  });

  it("validates provider catalog and settings responses", () => {
    const catalog = {
      openai: {
        id: "openai",
        name: "OpenAI",
        auth: { type: "apiKey", envKeys: ["OPENAI_API_KEY"] },
        models: [{ id: "gpt-4", name: "GPT-4", provider: "openai", api: "openai", reasoning: false, input: ["text"] }],
      },
    };
    expect(parseApiResponse(schemas.providerCatalog, catalog)).toEqual(catalog);
    expect(parseApiResponse(schemas.aiAccessSettingsResponse, { ok: true, deniedPaths: [] })).toEqual({
      ok: true,
      deniedPaths: [],
    });
    expect(parseApiResponse(schemas.welcomePageSettingsResponse, { ok: true, path: null })).toEqual({
      ok: true,
      path: null,
    });
    expect(parseApiResponse(schemas.themeSettingsResponse, { ok: true, content: ":root { --test: #fff; }" })).toEqual({
      ok: true,
      content: ":root { --test: #fff; }",
    });
    expect(() => parseApiResponse(schemas.themeSettingsResponse, { ok: true })).toThrow(/Invalid payload/);
  });

  it("preserves null welcome-page path through Fastify body coercion", async () => {
    const app = Fastify();
    app.put<{ Body: { path: string | null } }>(
      "/welcome-page",
      {
        schema: {
          body: schemas.welcomePageSettingsRequest,
          response: { 200: schemas.welcomePageSettingsResponse },
        },
      },
      async (req) => ({ ok: true, path: req.body.path }),
    );

    try {
      const cleared = await app.inject({
        method: "PUT",
        url: "/welcome-page",
        payload: { path: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json()).toEqual({ ok: true, path: null });

      const set = await app.inject({
        method: "PUT",
        url: "/welcome-page",
        payload: { path: "welcome.html" },
      });
      expect(set.statusCode).toBe(200);
      expect(set.json()).toEqual({ ok: true, path: "welcome.html" });
    } finally {
      await app.close();
    }
  });

  it("validates turn context snapshot", () => {
    const snapshot = {
      sessionId: "s1",
      capturedAt: "2024-01-01T00:00:00.000Z",
      systemPrompt: "p",
      messages: [],
      tools: [{ name: "t", description: "d", parameters: {} }],
    };
    expect(parseApiResponse(schemas.turnContextSnapshot, snapshot)).toEqual(snapshot);
    expect(() => parseApiResponse(schemas.turnContextSnapshot, { sessionId: "s1" })).toThrow(/Invalid payload/);
  });
});
