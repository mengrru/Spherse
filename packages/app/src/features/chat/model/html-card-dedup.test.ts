import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types";
import { computeSupersededToolCallIds } from "./html-card-dedup";

function assistantMsg(toolCalls: Array<{ toolCallId: string; _card?: any }>): ChatMessage {
  return { role: "assistant", content: "", _toolCalls: toolCalls } as ChatMessage;
}

function htmlCard(file_path?: string) {
  return { type: "html" as const, file_path, html: "<p>x</p>" };
}

describe("computeSupersededToolCallIds", () => {
  it("returns empty set when there are no html+path cards", () => {
    const messages = [
      assistantMsg([{ toolCallId: "t1", _card: { type: "html", html: "<b/>" } }]),
    ];
    expect(computeSupersededToolCallIds(messages).size).toBe(0);
  });

  it("returns empty set when each path appears only once", () => {
    const messages = [
      assistantMsg([
        { toolCallId: "t1", _card: htmlCard("a.html") },
        { toolCallId: "t2", _card: htmlCard("b.html") },
      ]),
    ];
    expect(computeSupersededToolCallIds(messages).size).toBe(0);
  });

  it("marks earlier same-path cards as superseded, keeping the latest expanded", () => {
    const messages = [
      assistantMsg([{ toolCallId: "t1", _card: htmlCard("dash.html") }]),
      assistantMsg([{ toolCallId: "t2", _card: htmlCard("dash.html") }]),
      assistantMsg([{ toolCallId: "t3", _card: htmlCard("dash.html") }]),
    ];
    expect(computeSupersededToolCallIds(messages)).toEqual(new Set(["t1", "t2"]));
  });

  it("handles duplicates within a single message", () => {
    const messages = [
      assistantMsg([
        { toolCallId: "t1", _card: htmlCard("x.html") },
        { toolCallId: "t2", _card: htmlCard("x.html") },
      ]),
    ];
    expect(computeSupersededToolCallIds(messages)).toEqual(new Set(["t1"]));
  });

  it("dedupes per path independently", () => {
    const messages = [
      assistantMsg([
        { toolCallId: "a1", _card: htmlCard("a.html") },
        { toolCallId: "b1", _card: htmlCard("b.html") },
      ]),
      assistantMsg([
        { toolCallId: "a2", _card: htmlCard("a.html") },
        { toolCallId: "b2", _card: htmlCard("b.html") },
      ]),
    ];
    expect(computeSupersededToolCallIds(messages)).toEqual(new Set(["a1", "b1"]));
  });

  it("ignores inline html cards (no file_path)", () => {
    const messages = [
      assistantMsg([{ toolCallId: "t1", _card: htmlCard() }]),
      assistantMsg([{ toolCallId: "t2", _card: htmlCard() }]),
    ];
    expect(computeSupersededToolCallIds(messages).size).toBe(0);
  });

  it("ignores non-html cards", () => {
    const messages = [
      assistantMsg([
        { toolCallId: "t1", _card: { type: "image", mime: "image/png", file_path: "p.png" } as any },
        { toolCallId: "t2", _card: { type: "image", mime: "image/png", file_path: "p.png" } as any },
      ]),
    ];
    expect(computeSupersededToolCallIds(messages).size).toBe(0);
  });

  it("skips tool calls without a card", () => {
    const messages = [assistantMsg([{ toolCallId: "t1" }, { toolCallId: "t2" }])];
    expect(computeSupersededToolCallIds(messages).size).toBe(0);
  });
});
