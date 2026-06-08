import { describe, expect, it } from "vitest";
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
  });

  it("rejects malformed chat websocket client messages", () => {
    expect(() => parseChatClientMessage({ type: "message" })).toThrow(/Invalid payload/);
    expect(() => parseChatClientMessage("not-json")).toThrow(/Invalid payload/);
  });

  it("accepts known chat server events", () => {
    expect(parseChatServerEvent({ type: "agent_end_done" })).toEqual({
      type: "agent_end_done",
    });
    expect(parseChatServerEvent({ type: "error", message: "boom" })).toEqual({
      type: "error",
      message: "boom",
    });
  });

  it("rejects malformed known chat server events", () => {
    expect(() => parseChatServerEvent({ type: "error" })).toThrow(/Invalid payload/);
  });

  it("validates named API responses", () => {
    expect(parseApiResponse(schemas.okResponse, { ok: true })).toEqual({ ok: true });
    expect(() => parseApiResponse(schemas.okResponse, { ok: "true" })).toThrow(/Invalid payload/);
  });
});
