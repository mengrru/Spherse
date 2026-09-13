import { describe, expect, it } from "vitest";import type { ChatClientMessage } from "@spherse/contracts";
import { createOutboundActions, type OutboundHost } from "./outbound-actions";
import { createSessionState, type ChatSessionState } from "./session-state";
import type { AssistantEntry, ErrorEntry, UserEntry } from "../model/entry";
import type { SessionLink } from "./session-link";

function sessionState(entries: ChatSessionState["entries"] = []): ChatSessionState {
  return { ...createSessionState("s1", "p1", "a1", 1), entries };
}

function harness(options: { open?: boolean; initialMessage?: string } = {}) {
  const sessions: Record<string, ChatSessionState> = { s1: sessionState() };
  const sent: ChatClientMessage[] = [];
  const link = {
    isOpen: () => options.open ?? true,
    send: (message: ChatClientMessage) => {
      sent.push(message);
      return options.open ?? true;
    },
  } as unknown as SessionLink;
  const host: OutboundHost = {
    getSession: (sessionId) => sessions[sessionId],
    updateSession: (sessionId, updater) => {
      const current = sessions[sessionId];
      if (!current) return;
      sessions[sessionId] = updater(current);
    },
    getLink: () => link,
    getInitialMessage: () => options.initialMessage,
  };
  return { actions: createOutboundActions(host), sessions, sent };
}

describe("outbound actions", () => {
  it("inserts an optimistic entry and sends the clientId", () => {
    const { actions, sessions, sent } = harness();
    expect(actions.sendMessage("s1", "  hi  ")).toBe(true);

    const entry = sessions.s1.entries[0] as UserEntry;
    expect(entry).toMatchObject({ kind: "user", text: "hi", optimistic: true });
    expect(sessions.s1.streaming).toBe(true);
    expect(sent[0]).toMatchObject({ type: "message", content: "hi", clientId: entry.clientId });
  });

  it("marks the entry as failed when the link is closed", () => {
    const { actions, sessions, sent } = harness({ open: false });
    expect(actions.sendMessage("s1", "hi")).toBe(true);
    expect((sessions.s1.entries[0] as UserEntry).sendFailed).toBe(true);
    expect(sessions.s1.streaming).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("sends the initial message exactly once", () => {
    const { actions, sessions, sent } = harness({ initialMessage: "first" });
    actions.sendInitialMessage("s1");
    actions.sendInitialMessage("s1");
    expect(sessions.s1.entries).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "message", content: "first" });
  });

  it("retries a turn error in place", () => {
    const error: AssistantEntry = { kind: "assistant", id: "a1", text: "", toolCalls: [], error: { message: "boom" } };
    const { actions, sessions, sent } = harness();
    sessions.s1 = { ...sessions.s1, entries: [error] };

    actions.retry("s1");
    expect(sent[0]).toEqual({ type: "retry" });
    expect(sessions.s1.entries[0]).toMatchObject({ streaming: true });
    expect((sessions.s1.entries[0] as AssistantEntry).error).toBeUndefined();
  });

  it("resends after a standalone error by dropping the failed turn", () => {
    const user: UserEntry = { kind: "user", id: "u1", text: "hi" };
    const error: ErrorEntry = { kind: "error", id: "x1", message: "failed" };
    const { actions, sessions, sent } = harness();
    sessions.s1 = { ...sessions.s1, entries: [user, error] };

    actions.retry("s1");
    expect(sessions.s1.entries).toHaveLength(1);
    expect(sessions.s1.entries[0]).toMatchObject({ kind: "user", text: "hi", optimistic: true });
    expect(sent[0]).toMatchObject({ type: "message", content: "hi" });
  });

  it("marks a pending withdraw and clears it on turn_withdrawn", () => {
    const { actions, sessions, sent } = harness();
    sessions.s1 = { ...sessions.s1, entries: [{ kind: "user", id: "u1", text: "hi" }] };

    actions.withdrawLastTurn("s1");
    expect(sessions.s1.pendingWithdraw).toBe(true);
    expect(sent[0]).toEqual({ type: "withdraw" });
  });

  it("skips withdraw while streaming or without a user entry", () => {
    const { actions, sessions, sent } = harness();
    sessions.s1 = { ...sessions.s1, entries: [{ kind: "user", id: "u1", text: "hi" }], streaming: true };
    actions.withdrawLastTurn("s1");
    expect(sent).toHaveLength(0);

    sessions.s1 = { ...sessions.s1, streaming: false, entries: [] };
    actions.withdrawLastTurn("s1");
    expect(sent).toHaveLength(0);
  });

  it("responds false to control requests when the link is closed", () => {
    const { actions } = harness({ open: false });
    expect(actions.respondApproval("s1", "r1", true)).toBe(false);
    expect(actions.respondQuestion("s1", "r1", "yes")).toBe(false);
  });
});
