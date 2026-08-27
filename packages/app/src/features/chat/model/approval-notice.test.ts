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
        kind: "approval",
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
        kind: "approval",
        requestId: "r2",
        sessionId: "s2",
        projectId: "p1",
        toolName: "manage_agent",
      },
    ]);
  });

  it("collects a pending ask_user question (question card with requestId)", () => {
    const sessions = {
      s3: {
        projectId: "p1",
        messages: [
          assistantMessage([
            {
              toolCallId: "tc3",
              toolName: "ask_user",
              args: { question: "Deploy?" },
              status: "running",
              _card: {
                type: "question",
                status: "pending",
                question: "Deploy?",
                options: ["yes", "no"],
                requestId: "r3",
              },
            },
          ]),
        ],
      },
    };

    const result = collectPendingApprovals(sessions);

    expect(result).toEqual([
      {
        kind: "question",
        requestId: "r3",
        sessionId: "s3",
        projectId: "p1",
        toolName: "ask_user",
      },
    ]);
  });

  it("excludes answered and timed-out question cards (requestId cleared)", () => {
    const sessions = {
      s1: {
        projectId: "p1",
        messages: [
          assistantMessage([
            {
              toolCallId: "tc4",
              toolName: "ask_user",
              args: {},
              status: "completed",
              _card: {
                type: "question",
                status: "answered",
                question: "Deploy?",
                answer: "yes",
                requestId: undefined,
              },
            },
          ]),
          assistantMessage([
            {
              toolCallId: "tc5",
              toolName: "ask_user",
              args: {},
              status: "completed",
              _card: {
                type: "question",
                status: "timeout",
                question: "Rollback?",
                requestId: undefined,
              },
            },
          ]),
        ],
      },
    };

    expect(collectPendingApprovals(sessions)).toEqual([]);
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
        ] satisfies ChatMessage[],
      },
    };

    expect(collectPendingApprovals(sessions)).toEqual([]);
  });
});
