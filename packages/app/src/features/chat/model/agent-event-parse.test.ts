import { describe, expect, it } from "vitest";
import { ErrorEventCode, type ChatServerEvent } from "@spherse/contracts";
import {
  isAgentMessage,
  isAssistantMessage,
  isImageCardDetails,
  isImageCardResultDetails,
  isRenderCardDetails,
  isRenderCardResultDetails,
  isTextContent,
  isToolCall,
  isToolResultMessage,
  isUserMessage,
  parseAgentEvent,
  parseAgentMessage,
} from "./agent-event-parse";

describe("agent-event-parse type guards", () => {
  describe("isTextContent", () => {
    it("accepts a valid TextContent", () => {
      expect(isTextContent({ type: "text", text: "hi" })).toBe(true);
    });
    it("rejects when text field is missing", () => {
      expect(isTextContent({ type: "text" })).toBe(false);
    });
    it("rejects non-text type discriminator", () => {
      expect(isTextContent({ type: "image", data: "x", mimeType: "png" })).toBe(false);
    });
    it("rejects primitives", () => {
      expect(isTextContent(null)).toBe(false);
      expect(isTextContent("text")).toBe(false);
      expect(isTextContent(undefined)).toBe(false);
    });
  });

  describe("isToolCall", () => {
    it("accepts a valid toolCall", () => {
      expect(isToolCall({ type: "toolCall", id: "tc1", name: "x", arguments: {} })).toBe(true);
    });
    it("rejects when id missing", () => {
      expect(isToolCall({ type: "toolCall", name: "x" })).toBe(false);
    });
    it("rejects thinking content", () => {
      expect(isToolCall({ type: "thinking", thinking: "x" })).toBe(false);
    });
  });

  describe("message role guards", () => {
    it("isUserMessage checks role only", () => {
      expect(isUserMessage({ role: "user", content: "hi" })).toBe(true);
      expect(isUserMessage({ role: "user", content: [{ type: "text", text: "hi" }] })).toBe(true);
      expect(isUserMessage({ role: "assistant", content: [] })).toBe(false);
      expect(isUserMessage(null)).toBe(false);
    });

    it("isAssistantMessage checks role only (lenient for runtime payloads)", () => {
      expect(isAssistantMessage({ role: "assistant", content: [] })).toBe(true);
      expect(isAssistantMessage({ role: "assistant", content: [], model: "x", provider: "y" })).toBe(true);
      expect(isAssistantMessage({ role: "user", content: "hi" })).toBe(false);
    });

    it("isToolResultMessage checks role only", () => {
      expect(isToolResultMessage({ role: "toolResult", toolCallId: "tc1", toolName: "x" })).toBe(true);
      expect(isToolResultMessage({ role: "assistant" })).toBe(false);
    });

    it("isAgentMessage accepts any of the three roles", () => {
      expect(isAgentMessage({ role: "user", content: "hi" })).toBe(true);
      expect(isAgentMessage({ role: "assistant", content: [] })).toBe(true);
      expect(isAgentMessage({ role: "toolResult", toolCallId: "x", toolName: "y" })).toBe(true);
      expect(isAgentMessage({ role: "custom" })).toBe(false);
      expect(isAgentMessage({ foo: "bar" })).toBe(false);
    });
  });

  describe("tool details guards", () => {
    it("isRenderCardDetails accepts type:html", () => {
      expect(isRenderCardDetails({ type: "html", html: "<p/>" })).toBe(true);
      expect(isRenderCardDetails({ type: "image" })).toBe(false);
    });
    it("isRenderCardResultDetails accepts cardType:html", () => {
      expect(isRenderCardResultDetails({ cardType: "html", file_path: "x" })).toBe(true);
      expect(isRenderCardResultDetails({ type: "html" })).toBe(false);
    });
    it("isImageCardDetails requires valid status and prompt", () => {
      expect(isImageCardDetails({ type: "image", status: "done", prompt: "cat" })).toBe(true);
      expect(isImageCardDetails({ type: "image", status: "weird", prompt: "cat" })).toBe(false);
      expect(isImageCardDetails({ type: "image", status: "done" })).toBe(false);
    });
    it("isImageCardResultDetails requires valid status", () => {
      expect(isImageCardResultDetails({ cardType: "image", status: "done" })).toBe(true);
      expect(isImageCardResultDetails({ cardType: "image", status: "weird" })).toBe(false);
      expect(isImageCardResultDetails({ type: "image", status: "done" })).toBe(false);
    });
  });
});

describe("parseAgentMessage", () => {
  it("passes through valid user message", () => {
    const msg = { role: "user", content: "hi", timestamp: 1 };
    expect(parseAgentMessage(msg)).toBe(msg);
  });
  it("passes through valid assistant message", () => {
    const msg = { role: "assistant", content: [] };
    expect(parseAgentMessage(msg)).toBe(msg);
  });
  it("returns fallback for unknown shape", () => {
    const fallback = parseAgentMessage({ role: "custom" });
    expect(fallback.role).toBe("user");
    expect(isUserMessage(fallback)).toBe(true);
    if (isUserMessage(fallback)) {
      expect(fallback.content).toBe("");
    }
  });
  it("returns fallback for non-object payload", () => {
    expect(parseAgentMessage(null).role).toBe("user");
    expect(parseAgentMessage("not-a-message").role).toBe("user");
    expect(parseAgentMessage(undefined).role).toBe("user");
  });
});

describe("parseAgentEvent", () => {
  function defined<T>(value: T | undefined): T {
    if (value === undefined) throw new Error("expected a parsed event");
    return value;
  }

  it("passes through agent_start unchanged", () => {
    expect(parseAgentEvent({ type: "agent_start" })).toEqual({ type: "agent_start" });
  });
  it("passes through turn_start, pong, error", () => {
    expect(parseAgentEvent({ type: "turn_start" })).toEqual({ type: "turn_start" });
    expect(parseAgentEvent({ type: "pong" })).toEqual({ type: "pong" });
    expect(parseAgentEvent({ type: "error", message: "boom" })).toEqual({
      type: "error",
      message: "boom",
    });
    expect(
      parseAgentEvent({ type: "error", message: "x", code: ErrorEventCode.ModelNotConfigured }),
    ).toEqual({ type: "error", message: "x", code: ErrorEventCode.ModelNotConfigured });
  });
  it("passes through turn_withdrawn unchanged", () => {
    expect(parseAgentEvent({ type: "turn_withdrawn", seq: 3 })).toEqual({
      type: "turn_withdrawn",
      seq: 3,
    });
  });
  it("drops protocol v2 events until the new runtime consumes them", () => {
    expect(parseAgentEvent({ type: "session_ready", lastSeq: 3, replay: true })).toBeUndefined();
    expect(parseAgentEvent({ type: "replay_done" })).toBeUndefined();
    expect(
      parseAgentEvent({
        type: "user_message",
        seq: 4,
        message: { role: "user", content: "hi", timestamp: 1 },
      }),
    ).toBeUndefined();
    expect(parseAgentEvent({ type: "turn_retried", seq: 5, abandonedSeqs: [3] })).toBeUndefined();
  });
  it("passes through tool_execution_* unchanged", () => {
    expect(
      parseAgentEvent({
        type: "tool_execution_start",
        toolCallId: "tc1",
        toolName: "x",
        args: { foo: 1 },
      }),
    ).toEqual({
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "x",
      args: { foo: 1 },
    });
    expect(
      parseAgentEvent({
        type: "tool_execution_end",
        toolCallId: "tc1",
        toolName: "x",
        result: "done",
        isError: false,
      }),
    ).toEqual({
      type: "tool_execution_end",
      toolCallId: "tc1",
      toolName: "x",
      result: "done",
      isError: false,
    });
  });
  it("passes through question control_request with fields intact", () => {
    expect(
      parseAgentEvent({
        type: "control_request",
        requestId: "q1",
        kind: "question",
        toolCallId: "tc1",
        toolName: "ask_user",
        args: { question: "Deploy?", options: ["yes", "no"] },
      }),
    ).toEqual({
      type: "control_request",
      requestId: "q1",
      kind: "question",
      toolCallId: "tc1",
      toolName: "ask_user",
      args: { question: "Deploy?", options: ["yes", "no"] },
    });
  });
  it("passes through question control_resolved without losing answer or timedOut", () => {
    expect(
      parseAgentEvent({
        type: "control_resolved",
        requestId: "q1",
        kind: "question",
        answer: "yes",
        timedOut: false,
      }),
    ).toEqual({
      type: "control_resolved",
      requestId: "q1",
      kind: "question",
      answer: "yes",
      timedOut: false,
    });
    expect(
      parseAgentEvent({
        type: "control_resolved",
        requestId: "q2",
        kind: "question",
        timedOut: true,
      }),
    ).toEqual({
      type: "control_resolved",
      requestId: "q2",
      kind: "question",
      timedOut: true,
    });
  });
  it("keeps approval control_resolved fields", () => {
    expect(
      parseAgentEvent({
        type: "control_resolved",
        requestId: "r1",
        kind: "approval",
        approved: true,
        reason: "ok",
      }),
    ).toEqual({
      type: "control_resolved",
      requestId: "r1",
      kind: "approval",
      approved: true,
      reason: "ok",
    });
  });
  it("narrows assistant message in message_start", () => {
    const result = defined(parseAgentEvent({
      type: "message_start",
      message: { role: "assistant", content: [] },
    } as unknown as ChatServerEvent));
    expect(result.type).toBe("message_start");
    expect(result).toHaveProperty("message");
  });
  it("narrows user message in message_end", () => {
    const result = defined(parseAgentEvent({
      type: "message_end",
      message: { role: "user", content: "hi", timestamp: 1 },
    }));
    expect(result.type).toBe("message_end");
    expect(result).toHaveProperty("message");
  });
  it("replaces invalid message payload with fallback", () => {
    const result = defined(parseAgentEvent({ type: "message_start", message: null } as unknown as ChatServerEvent));
    expect(result.type).toBe("message_start");
    expect(result).toHaveProperty("message.role", "user");
  });
  it("agent_end coerces messages array via parseAgentMessage", () => {
    const result = defined(parseAgentEvent({
      type: "agent_end",
      messages: [
        { role: "user", content: "hi", timestamp: 1 },
        { role: "totally-bogus" },
      ],
    } as unknown as ChatServerEvent));
    expect(result.type).toBe("agent_end");
    if (result.type === "agent_end") {
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[1].role).toBe("user"); // fallback
    }
  });
  it("agent_end tolerates missing messages array", () => {
    const result = defined(parseAgentEvent({
      type: "agent_end",
      messages: "not-an-array",
    } as unknown as ChatServerEvent));
    if (result.type === "agent_end") {
      expect(result.messages).toEqual([]);
    }
  });
  it("turn_end filters toolResults to valid ToolResultMessage", () => {
    const result = defined(parseAgentEvent({
      type: "turn_end",
      message: { role: "assistant", content: [] },
      toolResults: [
        { role: "toolResult", toolCallId: "tc1", toolName: "x" },
        { role: "user", content: "junk" },
      ],
    } as unknown as ChatServerEvent));
    if (result.type === "turn_end") {
      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0].toolCallId).toBe("tc1");
    }
  });
});
