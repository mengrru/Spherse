import { describe, expect, it } from "vitest";
import { collectPendingApprovals } from "./approval-notice";
import { createInitialSessionData } from "./session-events";
import type { ChatSessionData, InteractionState } from "../types";

function makeSession(
  projectId: string,
  interactions: InteractionState[] = [],
  messages: ChatSessionData["history"]["messages"] = [],
): { data: ChatSessionData; projectId: string } {
  const data = createInitialSessionData();
  data.history.messages = messages;
  for (const interaction of interactions) {
    data.interactions[interaction.requestId] = interaction;
  }
  return { data, projectId };
}

describe("collectPendingApprovals", () => {
  it("collects a pending run_command approval (command card with requestId)", () => {
    const sessions = {
      s1: makeSession("p1", [
        {
          kind: "approval",
          requestId: "r1",
          toolCallId: "tc1",
          toolName: "run_command",
          status: { type: "pending" },
        },
      ]),
    };

    const result = collectPendingApprovals(sessions);

    expect(result).toEqual([
      {
        kind: "approval",
        requestId: "r1",
        sessionId: "s1",
        projectId: "p1",
        toolName: "run_command",
      },
    ]);
  });

  it("collects a pending generic-tool approval (approval card with requestId)", () => {
    const sessions = {
      s2: makeSession("p1", [
        {
          kind: "approval",
          requestId: "r2",
          toolCallId: "tc2",
          toolName: "manage_agent",
          status: { type: "pending" },
        },
      ]),
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
      s3: makeSession("p1", [
        {
          kind: "question",
          requestId: "r3",
          toolCallId: "tc3",
          toolName: "ask_user",
          status: { type: "pending" },
        },
      ]),
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
      s1: makeSession("p1", [
        {
          kind: "question",
          requestId: "r4",
          toolCallId: "tc4",
          toolName: "ask_user",
          status: { type: "answered", answer: "yes" },
        },
        {
          kind: "question",
          requestId: "r5",
          toolCallId: "tc5",
          toolName: "ask_user",
          status: { type: "timeout" },
        },
      ]),
    };

    expect(collectPendingApprovals(sessions)).toEqual([]);
  });

  it("excludes resolved approvals (requestId cleared to undefined)", () => {
    const sessions = {
      s1: makeSession("p1", [
        {
          kind: "approval",
          requestId: "r6",
          toolCallId: "tc6",
          toolName: "run_command",
          status: { type: "approved" },
        },
      ]),
    };

    expect(collectPendingApprovals(sessions)).toEqual([]);
  });

  it("ignores tool calls without an approval card", () => {
    const sessions = {
      s1: makeSession("p1", []),
    };

    expect(collectPendingApprovals(sessions)).toEqual([]);
  });

  it("aggregates pending approvals across multiple sessions and projects", () => {
    const sessions = {
      a: makeSession("pA", [
        {
          kind: "approval",
          requestId: "ra",
          toolCallId: "t",
          toolName: "run_command",
          status: { type: "pending" },
        },
      ]),
      b: makeSession("pB", [
        {
          kind: "approval",
          requestId: "rb",
          toolCallId: "t",
          toolName: "manage_trigger",
          status: { type: "pending" },
        },
      ]),
    };

    const result = collectPendingApprovals(sessions);
    expect(result.map((r) => r.requestId).sort()).toEqual(["ra", "rb"]);
  });

  it("skips user messages and messages without tool calls", () => {
    const sessions = {
      s1: makeSession("p1", [], [
        { role: "user", content: "hello" },
        { role: "assistant", content: "no tools" },
      ]),
    };

    expect(collectPendingApprovals(sessions)).toEqual([]);
  });
});
