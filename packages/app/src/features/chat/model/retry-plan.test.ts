import { describe, expect, it } from "vitest";
import { ErrorEventCode } from "@spherse/contracts";
import { planRetry } from "./retry-plan";
import { createInitialSessionData } from "./session-events";
import type { ChatMessage, RenderItem } from "../types";

const item = (message: ChatMessage, i: number): RenderItem => ({ key: `t-${i}`, message });

describe("planRetry", () => {
  it("plans none for a withdraw-originated error bubble", () => {
    const items = [
      item({ role: "user", content: "hi" }, 0),
      item({ role: "assistant", content: "", _error: "no user message to withdraw" }, 1),
    ];
    const session = { ...createInitialSessionData(), withdrawError: true };
    expect(planRetry(items, session)).toEqual({ kind: "none" });
  });

  it("plans retry-last for a failed assistant turn committed by the server (message_end error)", () => {
    const items = [
      item({ role: "user", content: "hi" }, 0),
      item(
        { role: "assistant", content: "", _error: "timeout", _errorCode: ErrorEventCode.Transient, _turnError: true },
        1,
      ),
    ];
    expect(planRetry(items, createInitialSessionData())).toEqual({ kind: "retry-last" });
  });

  it("plans resend for an error-event bubble with no committed turn (Source 1)", () => {
    const items = [
      item({ role: "user", content: "hi" }, 0),
      item({ role: "assistant", content: "", _error: "boom" }, 1),
    ];
    const plan = planRetry(items, createInitialSessionData());
    expect(plan.kind).toBe("resend");
    if (plan.kind !== "resend") return;
    expect(plan.content).toBe("hi");
  });

  it("plans resend for a send-failed user message", () => {
    const items: RenderItem[] = [
      { key: "t-0", message: { role: "user", content: "hello" }, sendFailed: true },
    ];
    const plan = planRetry(items, createInitialSessionData());
    expect(plan).toMatchObject({ kind: "resend", content: "hello" });
  });

  it("returns none when there is nothing to retry", () => {
    expect(planRetry([item({ role: "user", content: "hi" }, 0)], createInitialSessionData())).toEqual({ kind: "none" });
    expect(
      planRetry(
        [item({ role: "user", content: "hi" }, 0), item({ role: "assistant", content: "ok" }, 1)],
        createInitialSessionData(),
      ),
    ).toEqual({ kind: "none" });
  });

  it("retries permanent errors when triggered manually", () => {
    const items = [
      item({ role: "user", content: "hi" }, 0),
      item(
        { role: "assistant", content: "", _error: "prompt is too long", _errorCode: ErrorEventCode.Permanent, _turnError: true },
        1,
      ),
    ];
    expect(planRetry(items, createInitialSessionData())).toEqual({ kind: "retry-last" });
  });

  it("maps attachment into a sendable image", () => {
    const items = [
      item(
        {
          role: "user",
          content: "hi",
          _attachments: [{ type: "image", path: "/p.png", mimeType: "image/png", width: 10, height: 20 }],
        },
        0,
      ),
      item({ role: "assistant", content: "", _error: "boom" }, 1),
    ];
    const plan = planRetry(items, createInitialSessionData());
    expect(plan).toMatchObject({
      kind: "resend",
      attachment: { path: "/p.png", mimeType: "image/png", width: 10, height: 20 },
    });
  });
});
