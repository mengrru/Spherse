import { describe, expect, it } from "vitest";
import { ErrorEventCode } from "@spherse/server/contracts";
import { planRetry, shouldAutoRetry, MAX_AUTO_RETRY } from "./retry-plan";
import type { ChatMessage } from "../types";

describe("planRetry", () => {
  it("plans retry-last for a failed assistant turn committed by the server (message_end error)", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", _error: "timeout", _errorCode: ErrorEventCode.Transient, _turnError: true },
    ];
    expect(planRetry(messages, 0, false)).toEqual({ kind: "retry-last" });
  });

  it("plans resend for an error-event bubble with no committed turn (Source 1)", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi", _optimistic: true },
      { role: "assistant", content: "", _error: "boom" },
    ];
    const plan = planRetry(messages, 0, false);
    expect(plan.kind).toBe("resend");
    if (plan.kind !== "resend") return;
    expect(plan.content).toBe("hi");
    expect(plan.dropCount).toBe(2);
  });

  it("plans resend for a send-failed user message", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hello", _optimistic: true, _sendFailed: true },
    ];
    const plan = planRetry(messages, 0, false);
    expect(plan).toMatchObject({ kind: "resend", content: "hello", dropCount: 1 });
  });

  it("returns none when there is nothing to retry", () => {
    expect(planRetry([{ role: "user", content: "hi" }], 0, false)).toEqual({ kind: "none" });
    expect(planRetry([
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok" },
    ], 0, false)).toEqual({ kind: "none" });
  });

  it("auto-retry skips non-transient errors", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", _error: "prompt is too long", _errorCode: ErrorEventCode.Permanent, _turnError: true },
    ];
    expect(planRetry(messages, 0, true)).toEqual({ kind: "none" });
  });

  it("auto-retry skips once retry budget is exhausted", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", _error: "timeout", _errorCode: ErrorEventCode.Transient, _turnError: true },
    ];
    expect(planRetry(messages, MAX_AUTO_RETRY, true)).toEqual({ kind: "none" });
  });

  it("manual retry ignores transient/budget gating", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", _error: "prompt is too long", _errorCode: ErrorEventCode.Permanent, _turnError: true },
    ];
    expect(planRetry(messages, 99, false)).toEqual({ kind: "retry-last" });
  });

  it("maps attachment into a sendable image", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: "hi",
        _optimistic: true,
        _attachments: [{ type: "image", path: "/p.png", mimeType: "image/png", width: 10, height: 20 }],
      },
      { role: "assistant", content: "", _error: "boom" },
    ];
    const plan = planRetry(messages, 0, false);
    expect(plan).toMatchObject({ kind: "resend", attachment: { path: "/p.png", mimeType: "image/png", width: 10, height: 20 } });
  });
});

describe("shouldAutoRetry", () => {
  it("is true for a transient failed assistant message within budget", () => {
    expect(shouldAutoRetry(
      [{ role: "assistant", content: "", _error: "rate limit", _errorCode: ErrorEventCode.Transient }],
      0,
    )).toBe(true);
  });

  it("is false for permanent errors, non-errors, or exhausted budget", () => {
    expect(shouldAutoRetry(
      [{ role: "assistant", content: "", _error: "overflow", _errorCode: ErrorEventCode.Permanent }],
      0,
    )).toBe(false);
    expect(shouldAutoRetry([{ role: "assistant", content: "ok" }], 0)).toBe(false);
    expect(shouldAutoRetry(
      [{ role: "assistant", content: "", _error: "x", _errorCode: ErrorEventCode.Transient }],
      MAX_AUTO_RETRY,
    )).toBe(false);
  });
});
