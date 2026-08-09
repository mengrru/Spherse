import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types";
import { collectPendingApprovals } from "./approval-notice";

function assistantMessage(toolCalls: ChatMessage["_toolCalls"]): ChatMessage {
  return { role: "assistant", content: "", _toolCalls: toolCalls };
}

describe("collectPendingApprovals", () => {
  it("collects a pending run_command approval (command card with requestId)", () => {
    const sessions = {
      s1: {
        projectId: "p1",
        messages: [
          assistantMessage([
            {
              toolCallId: "tc1",
              toolName: "run_command",
              args: { command: "echo hi" },
              status: "running",
              _card: {
                type: "command",
                status: "pending_approval",
                command: "echo hi",
                stdout: "",
                stderr: "",
                requestId: "r1",
              },
            },
          ]),
        ],
      },
    };

    const result = collectPendingApprovals(sessions);

    expect(result).toEqual([
      {
        requestId: "r1",
        sessionId: "s1",
        projectId: "p1",
        toolName: "run_command",
        command: "echo hi",
      },
    ]);
  });

  it("collects a pending generic-tool approval (approval card with requestId)", () => {
    const sessions = {
      s2: {
        projectId: "p1",
        messages: [
          assistantMessage([
            {
              toolCallId: "tc2",
              toolName: "manage_agent",
              args: { name: "x" },
              status: "running",
              _card: {
                type: "approval",
                status: "pending",
                toolName: "manage_agent",
                args: { name: "x" },
                requestId: "r2",
              },
            },
          ]),
        ],
      },
    };

    const result = collectPendingApprovals(sessions);

    expect(result).toEqual([
      {
        requestId: "r2",
        sessionId: "s2",
        projectId: "p1",
        toolName: "manage_agent",
      },
    ]);
  });

  it("excludes resolved approvals (requestId cleared to undefined)", () => {
    const sessions = {
      s1: {
        projectId: "p1",
        messages: [
          assistantMessage([
            {
              toolCallId: "tc1",
              toolName: "run_command",
              args: { command: "echo hi" },
              status: "completed",
              _card: {
                type: "command",
                status: "completed",
                command: "echo hi",
                stdout: "hi",
                stderr: "",
                requestId: undefined,
              },
            },
          ]),
        ],
      },
    };

    expect(collectPendingApprovals(sessions)).toEqual([]);
  });

  it("ignores tool calls without an approval card", () => {
    const sessions = {
      s1: {
        projectId: "p1",
        messages: [
          assistantMessage([
            {
              toolCallId: "tc9",
              toolName: "write_file",
              args: {},
              status: "running",
              _card: undefined,
            },
          ]),
        ],
      },
    };

    expect(collectPendingApprovals(sessions)).toEqual([]);
  });

  it("aggregates pending approvals across multiple sessions and projects", () => {
    const sessions = {
      a: {
        projectId: "pA",
        messages: [
          assistantMessage([
            {
              toolCallId: "t",
              toolName: "run_command",
              args: {},
              status: "running",
              _card: {
                type: "command",
                status: "pending_approval",
                command: "ls",
                stdout: "",
                stderr: "",
                requestId: "ra",
              },
            },
          ]),
        ],
      },
      b: {
        projectId: "pB",
        messages: [
          assistantMessage([
            {
              toolCallId: "t",
              toolName: "manage_trigger",
              args: {},
              status: "running",
              _card: {
                type: "approval",
                status: "pending",
                toolName: "manage_trigger",
                args: {},
                requestId: "rb",
              },
            },
          ]),
        ],
      },
    };

    const result = collectPendingApprovals(sessions);
    expect(result.map((r) => r.requestId).sort()).toEqual(["ra", "rb"]);
  });

  it("skips user messages and messages without tool calls", () => {
    const sessions = {
      s1: {
        projectId: "p1",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "no tools" },
        ],
      },
    };

    expect(collectPendingApprovals(sessions)).toEqual([]);
  });
});
