import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFire = vi.fn();
const mockCall = vi.fn();

vi.mock("../runtime/messaging.js", () => ({
  fire: mockFire,
  call: mockCall,
}));

const { actions } = await import("../runtime/actions.js");

describe("actions surface", () => {
  beforeEach(() => {
    mockFire.mockReset();
    mockCall.mockReset();
  });

  it("createSession fires createSession with params", () => {
    actions.createSession({ agentId: "a" });
    expect(mockFire).toHaveBeenCalledWith("createSession", { agentId: "a" });
  });

  it("sendMessage calls (request-response) sendMessage", () => {
    actions.sendMessage({ sessionId: "s", message: "m" });
    expect(mockCall).toHaveBeenCalledWith("sendMessage", { sessionId: "s", message: "m" });
  });

  it("openFile accepts a plain string path", () => {
    actions.openFile("world/x.md");
    expect(mockFire).toHaveBeenCalledWith("openFile", { path: "world/x.md" });
  });

  it("openFile passes through an object including float", () => {
    actions.openFile({ path: "world/x.md", float: true });
    expect(mockFire).toHaveBeenCalledWith("openFile", { path: "world/x.md", float: true });
  });

  it("openExternalLink accepts a plain string url", () => {
    actions.openExternalLink("https://example.com");
    expect(mockFire).toHaveBeenCalledWith("openExternalLink", { url: "https://example.com" });
  });

  it("openSession fires openSession, coercing a string to { sessionId }", () => {
    actions.openSession("s1");
    expect(mockFire).toHaveBeenCalledWith("openSession", { sessionId: "s1" });
  });

  it("openSession passes through an object including float", () => {
    actions.openSession({ sessionId: "s1", float: true });
    expect(mockFire).toHaveBeenCalledWith("openSession", { sessionId: "s1", float: true });
  });

  it("floatSession coerces a string to { sessionId }", () => {
    actions.floatSession("s1");
    expect(mockFire).toHaveBeenCalledWith("floatSession", { sessionId: "s1" });
  });

  it("toast fires showToast with params", () => {
    actions.toast({ variant: "success", message: "hi" });
    expect(mockFire).toHaveBeenCalledWith("showToast", { variant: "success", message: "hi" });
  });

  it("emitAgentTriggerEvent fires its action with params", () => {
    actions.emitAgentTriggerEvent({ eventName: "e" });
    expect(mockFire).toHaveBeenCalledWith("emitAgentTriggerEvent", { eventName: "e" });
  });
});
