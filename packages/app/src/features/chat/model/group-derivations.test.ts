import { describe, expect, it } from "vitest";
import {
  collectPendingControls,
  computeSupersededToolCallIds,
  lastWithdrawableUserEntry,
  planRetry,
  shouldShowThinking,
} from "./group-derivations";
import type { MessageGroup } from "./message-group";
import type { ToolItem } from "./tool-item";
import type { AssistantEntry, UserEntry } from "./entry";

function user(overrides: Partial<UserEntry> = {}): UserEntry {
  return { kind: "user", id: "u1", text: "hi", ...overrides };
}

function assistant(overrides: Partial<AssistantEntry> = {}): AssistantEntry {
  return { kind: "assistant", id: "a1", text: "", toolCalls: [], ...overrides };
}

function tool(overrides: Partial<ToolItem> = {}): ToolItem {
  return { toolCallId: "tc1", toolName: "render_card", args: {}, status: "completed", ...overrides };
}

function groupWithTools(tools: ToolItem[], id = "g1"): MessageGroup {
  return {
    id,
    kind: "turn",
    hasError: false,
    bubbles: [{ kind: "assistant", id: `b:${id}`, entryId: id, text: "", tools }],
  };
}

describe("group derivations", () => {
  it("marks all but the latest html card per file path as superseded", () => {
    const groups = [
      groupWithTools([tool({ toolCallId: "tc1", card: { type: "html", file_path: "x.html" } })], "g1"),
      groupWithTools([tool({ toolCallId: "tc2", card: { type: "html", file_path: "x.html" } })], "g2"),
      groupWithTools([tool({ toolCallId: "tc3", card: { type: "html", html: "<p>inline</p>" } })], "g3"),
    ];
    const superseded = computeSupersededToolCallIds(groups);
    expect(superseded.has("tc1")).toBe(true);
    expect(superseded.has("tc2")).toBe(false);
    expect(superseded.has("tc3")).toBe(false);
  });

  it("finds the last withdrawable user entry", () => {
    expect(lastWithdrawableUserEntry([user({ id: "u1" }), assistant()])?.id).toBe("u1");
    expect(lastWithdrawableUserEntry([user({ id: "u1", sendFailed: true })])).toBeUndefined();
    expect(lastWithdrawableUserEntry([assistant()])).toBeUndefined();
  });

  it("plans retry-last for turn errors and resend for standalone errors", () => {
    expect(planRetry([
      user(),
      assistant({ error: { message: "boom" } }),
    ])).toEqual({ kind: "retry-last" });

    expect(planRetry([
      user(),
      assistant({ error: { message: "boom", retrySuppressed: true } }),
    ])).toEqual({ kind: "none" });

    expect(planRetry([
      user({ id: "u1", text: "hi" }),
      { kind: "error", id: "x1", message: "send failed" },
    ])).toMatchObject({ kind: "resend", content: "hi", dropCount: 2 });

    expect(planRetry([user({ id: "u1", text: "hi", sendFailed: true })])).toMatchObject({
      kind: "resend",
      content: "hi",
      dropCount: 1,
    });
  });

  it("collects pending control requests from tool cards", () => {
    const groups = [
      groupWithTools([
        tool({
          toolCallId: "tc1",
          toolName: "run_command",
          card: { type: "command", status: "pending_approval", command: "rm", stdout: "", stderr: "", requestId: "r1" },
        }),
        tool({
          toolCallId: "tc2",
          toolName: "manage_trigger",
          card: { type: "approval", status: "pending", toolName: "manage_trigger", args: {}, requestId: "r2" },
        }),
        tool({
          toolCallId: "tc3",
          toolName: "ask_user",
          card: { type: "question", status: "pending", question: "why", requestId: "r3" },
        }),
        tool({ toolCallId: "tc4", toolName: "render_card", card: { type: "html", html: "<p>x</p>" } }),
      ]),
    ];
    expect(collectPendingControls(groups)).toEqual([
      { kind: "approval", requestId: "r1", toolName: "run_command", command: "rm" },
      { kind: "approval", requestId: "r2", toolName: "manage_trigger" },
      { kind: "question", requestId: "r3", toolName: "ask_user" },
    ]);
  });

  it("shows the thinking indicator only while the last entry is a user message", () => {
    expect(shouldShowThinking([user()], true)).toBe(true);
    expect(shouldShowThinking([user()], false)).toBe(false);
    expect(shouldShowThinking([assistant()], true)).toBe(false);
  });
});
