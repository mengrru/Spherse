import { describe, expect, it } from "vitest";
import { ErrorEventCode } from "@spherse/server/contracts";
import { planRetry } from "./retry-plan";
import type { ChatMessage } from "../types";

describe("planRetry", () => {
  it("plans none for a withdraw-originated error bubble", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", _error: "no user message to withdraw", _withdrawError: true },
    ];
    expect(planRetry(messages)).toEqual({ kind: "none" });
  });

  it("plans retry-last for a failed assistant turn committed by the server (message_end error)", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", _error: "timeout", _errorCode: ErrorEventCode.Transient, _turnError: true },
    ];
    expect(planRetry(messages)).toEqual({ kind: "retry-last" });
  });

  it("plans resend for an error-event bubble with no committed turn (Source 1)", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi", _optimistic: true },
      { role: "assistant", content: "", _error: "boom" },
    ];
    const plan = planRetry(messages);
    expect(plan.kind).toBe("resend");
    if (plan.kind !== "resend") return;
    expect(plan.content).toBe("hi");
    expect(plan.dropCount).toBe(2);
  });

  it("plans resend for a send-failed user message", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hello", _optimistic: true, _sendFailed: true },
    ];
    const plan = planRetry(messages);
    expect(plan).toMatchObject({ kind: "resend", content: "hello", dropCount: 1 });
  });

  it("returns none when there is nothing to retry", () => {
    expect(planRetry([{ role: "user", content: "hi" }])).toEqual({ kind: "none" });
    expect(planRetry([
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok" },
    ])).toEqual({ kind: "none" });
  });

  it("retries permanent errors when triggered manually", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", _error: "prompt is too long", _errorCode: ErrorEventCode.Permanent, _turnError: true },
    ];
    expect(planRetry(messages)).toEqual({ kind: "retry-last" });
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
    const plan = planRetry(messages);
    expect(plan).toMatchObject({ kind: "resend", attachment: { path: "/p.png", mimeType: "image/png", width: 10, height: 20 } });
  });
});
