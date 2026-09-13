import { describe, expect, it } from "vitest";
import { projectToolCard } from "./tool-card";
import type { ToolResultEntry } from "./entry";

function resultEntry(overrides: Partial<ToolResultEntry> = {}): ToolResultEntry {
  return { kind: "tool-result", id: "tr1", toolCallId: "tc1", ...overrides };
}

describe("tool card projection", () => {
  it("prefers a pending control card", () => {
    const card = projectToolCard("run_command", { command: "rm -rf /" }, resultEntry({
      control: { requestId: "r1", kind: "approval", status: "pending" },
    }));
    expect(card).toMatchObject({
      type: "command",
      status: "pending_approval",
      command: "rm -rf /",
      requestId: "r1",
    });
  });

  it("shows an approved command as running and a rejected one as rejected", () => {
    const approved = projectToolCard("run_command", { command: "ls" }, resultEntry({
      control: { requestId: "r1", kind: "approval", status: "approved", approved: true },
    }));
    expect(approved).toMatchObject({ type: "command", status: "running" });
    expect(approved).not.toHaveProperty("requestId");

    const rejected = projectToolCard("run_command", { command: "ls" }, resultEntry({
      control: { requestId: "r2", kind: "approval", status: "rejected", approved: false },
    }));
    expect(rejected).toMatchObject({ type: "command", status: "error", rejected: true });
  });

  it("renders generic approval cards", () => {
    const pending = projectToolCard("manage_trigger", { action: "create" }, resultEntry({
      control: { requestId: "r1", kind: "approval", status: "pending" },
    }));
    expect(pending).toMatchObject({ type: "approval", status: "pending", requestId: "r1" });

    const approved = projectToolCard("manage_trigger", { action: "create" }, resultEntry({
      control: { requestId: "r1", kind: "approval", status: "approved", approved: true },
    }));
    expect(approved).toMatchObject({ type: "approval", status: "approved" });
  });

  it("renders question cards with options only when at least two exist", () => {
    const args = { question: "pick", options: ["a", "b"] };
    const pending = projectToolCard("ask_user", args, resultEntry({
      control: { requestId: "q1", kind: "question", status: "pending" },
    }));
    expect(pending).toMatchObject({ type: "question", status: "pending", options: ["a", "b"], requestId: "q1" });

    const single = projectToolCard("ask_user", { question: "pick", options: ["a"] }, resultEntry({
      control: { requestId: "q1", kind: "question", status: "pending" },
    }));
    expect(single).toMatchObject({ type: "question", options: undefined });

    const answered = projectToolCard("ask_user", args, resultEntry({
      control: { requestId: "q1", kind: "question", status: "answered", answer: "a" },
    }));
    expect(answered).toMatchObject({ type: "question", status: "answered", answer: "a" });

    const timedOut = projectToolCard("ask_user", args, resultEntry({
      control: { requestId: "q1", kind: "question", status: "timeout", timedOut: true },
    }));
    expect(timedOut).toMatchObject({ type: "question", status: "timeout" });
  });

  it("builds a completed command card from result details", () => {
    const card = projectToolCard("run_command", { command: "ls" }, resultEntry({
      result: { details: { cardType: "command", command: "ls", stdout: "ok", status: "completed" } },
      isError: false,
    }));
    expect(card).toMatchObject({ type: "command", status: "completed", stdout: "ok" });
  });

  it("builds a rejected command card from rejected result details", () => {
    const card = projectToolCard("run_command", { command: "ls" }, resultEntry({
      result: { details: { rejected: true } },
      isError: true,
    }));
    expect(card).toMatchObject({ type: "command", status: "error", rejected: true });
  });

  it("builds an html card from result details and from partial results", () => {
    const final = projectToolCard("render_card", {}, resultEntry({
      details: { cardType: "html", file_path: "x.html", html: "<p>x</p>" },
      result: "ok",
    }));
    expect(final).toMatchObject({ type: "html", file_path: "x.html", html: "<p>x</p>" });

    const partial = projectToolCard("render_card", {}, resultEntry({
      partialResult: { details: { type: "html", html: "<p>partial</p>" } },
    }));
    expect(partial).toMatchObject({ type: "html", html: "<p>partial</p>" });
  });

  it("keeps pending control ahead of result details", () => {
    const card = projectToolCard("run_command", { command: "ls" }, resultEntry({
      control: { requestId: "r1", kind: "approval", status: "pending" },
      result: { details: { cardType: "command", command: "ls", stdout: "ok", status: "completed" } },
    }));
    expect(card).toMatchObject({ type: "command", status: "pending_approval" });
  });

  it("prefers result details over partial results", () => {
    const card = projectToolCard("run_command", { command: "ls" }, resultEntry({
      partialResult: { details: { cardType: "command", command: "ls", stdout: "", status: "running" } },
      result: { details: { cardType: "command", command: "ls", stdout: "done", status: "completed" } },
    }));
    expect(card).toMatchObject({ type: "command", status: "completed", stdout: "done" });
  });

  it("returns undefined when no card source exists", () => {
    expect(projectToolCard("read_file", { path: "a" }, resultEntry({ result: "data" }))).toBeUndefined();
  });
});
