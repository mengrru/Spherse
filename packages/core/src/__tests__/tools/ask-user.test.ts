import { describe, it, expect, vi } from "vitest";
import { createAskUserTool, type AskGate, type AskOutcome } from "../../tools/ask-user.js";

function fakeGate(outcome: AskOutcome | Error): AskGate & { ask: ReturnType<typeof vi.fn> } {
  return {
    ask: vi.fn(async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }),
  };
}

describe("createAskUserTool", () => {
  it("returns the user's answer with question details when answered", async () => {
    const gate = fakeGate({ answer: "use option B", timedOut: false });
    const tool = createAskUserTool(gate);
    const result = await tool.execute("tc1", { question: "Which option?", options: ["a", "b"] });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toBe("User's answer:\nuse option B");
    expect(result.details).toEqual({
      cardType: "question",
      question: "Which option?",
      options: ["a", "b"],
      answer: "use option B",
    });
  });

  it("reports timeout guidance when the gate times out", async () => {
    const gate = fakeGate({ timedOut: true });
    const tool = createAskUserTool(gate);
    const result = await tool.execute("tc1", { question: "Are you there?" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("did not answer");
    expect(text).toContain("10 minutes");
    expect(text).toContain("do not call ask_user again");
    expect(result.details).toEqual({ cardType: "question", question: "Are you there?", timedOut: true });
  });

  it("does not call the gate when the signal is already aborted", async () => {
    const gate = fakeGate({ answer: "late", timedOut: false });
    const tool = createAskUserTool(gate);
    const controller = new AbortController();
    controller.abort();
    const result = await tool.execute("tc1", { question: "Q?" }, controller.signal);
    expect(gate.ask).not.toHaveBeenCalled();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("aborted");
    expect(result.details.cardType).toBe("question");
  });

  it("returns an aborted result when the gate rejects", async () => {
    const gate = fakeGate(new Error("session aborted"));
    const tool = createAskUserTool(gate);
    const result = await tool.execute("tc1", { question: "Q?" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("aborted");
    expect(result.details.cardType).toBe("question");
  });

  it("returns an unavailable result when no gate is provided", async () => {
    const tool = createAskUserTool();
    const result = await tool.execute("tc1", { question: "Q?" });
    const text = (result.content[0] as { text: string }).text;
    expect(text.toLowerCase()).toContain("unavailable");
    expect(result.details.cardType).toBe("question");
  });

  it("clamps timeout_s into [60, 3600] with default 600", async () => {
    const gate = fakeGate({ timedOut: true });
    const tool = createAskUserTool(gate);
    await tool.execute("tc1", { question: "Q?", timeout_s: 59 });
    expect(gate.ask.mock.calls[0][1]).toBe(60_000);
    await tool.execute("tc2", { question: "Q?", timeout_s: 3601 });
    expect(gate.ask.mock.calls[1][1]).toBe(3_600_000);
    await tool.execute("tc3", { question: "Q?" });
    expect(gate.ask.mock.calls[2][1]).toBe(600_000);
  });

  it("computes timeout minutes from the clamped timeout", async () => {
    const gate = fakeGate({ timedOut: true });
    const tool = createAskUserTool(gate);
    const result = await tool.execute("tc1", { question: "Q?", timeout_s: 120 });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("2 minutes");
  });

  it("drops non-string option items and treats fewer than 2 remaining as no options", async () => {
    const gate = fakeGate({ answer: "a", timedOut: false });
    const tool = createAskUserTool(gate);
    const result = await tool.execute("tc1", {
      question: "Q?",
      options: ["a", 123, null] as unknown as string[],
    });
    expect(result.details.options).toBeUndefined();
  });

  it("keeps exactly 2 valid options after sanitization", async () => {
    const gate = fakeGate({ answer: "a", timedOut: false });
    const tool = createAskUserTool(gate);
    const result = await tool.execute("tc1", {
      question: "Q?",
      options: ["a", "b", 42] as unknown as string[],
    });
    expect(result.details.options).toEqual(["a", "b"]);
  });

  it("passes request metadata and original args to the gate", async () => {
    const gate = fakeGate({ answer: "ok", timedOut: false });
    const tool = createAskUserTool(gate);
    const params = { question: "Q?", options: ["a", "b"] };
    await tool.execute("tc-meta", params);
    const req = gate.ask.mock.calls[0][0];
    expect(req.toolCallId).toBe("tc-meta");
    expect(req.toolName).toBe("ask_user");
    expect(req.args).toEqual(params);
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
