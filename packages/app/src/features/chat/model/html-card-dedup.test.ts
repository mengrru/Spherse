import { describe, expect, it } from "vitest";
import type { ChatMessage, RenderItem } from "../types";
import { computeSupersededToolCallIds } from "./html-card-dedup";

const item = (message: ChatMessage, i: number): RenderItem => ({ key: `t-${i}`, message });

function assistantItem(toolCalls: Array<{ toolCallId: string; _card?: any }>, i: number): RenderItem {
  return item(
    {
      role: "assistant",
      content: "",
      _toolCalls: toolCalls.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolName: "render_card",
        args: {},
        status: "completed" as const,
        ...(tc._card !== undefined ? { _card: tc._card } : {}),
      })),
    },
    i,
  );
}

function htmlCard(file_path?: string) {
  return { type: "html" as const, file_path, html: "<p>x</p>" };
}

describe("computeSupersededToolCallIds", () => {
  it("returns empty set when there are no html+path cards", () => {
    const items = [assistantItem([{ toolCallId: "t1", _card: { type: "html", html: "<b/>" } }], 0)];
    expect(computeSupersededToolCallIds(items).size).toBe(0);
  });

  it("returns empty set when each path appears only once", () => {
    const items = [
      assistantItem(
        [
          { toolCallId: "t1", _card: htmlCard("a.html") },
          { toolCallId: "t2", _card: htmlCard("b.html") },
        ],
        0,
      ),
    ];
    expect(computeSupersededToolCallIds(items).size).toBe(0);
  });

  it("marks earlier same-path cards as superseded, keeping the latest expanded", () => {
    const items = [
      assistantItem([{ toolCallId: "t1", _card: htmlCard("dash.html") }], 0),
      assistantItem([{ toolCallId: "t2", _card: htmlCard("dash.html") }], 1),
      assistantItem([{ toolCallId: "t3", _card: htmlCard("dash.html") }], 2),
    ];
    expect(computeSupersededToolCallIds(items)).toEqual(new Set(["t1", "t2"]));
  });

  it("handles duplicates within a single message", () => {
    const items = [
      assistantItem(
        [
          { toolCallId: "t1", _card: htmlCard("x.html") },
          { toolCallId: "t2", _card: htmlCard("x.html") },
        ],
        0,
      ),
    ];
    expect(computeSupersededToolCallIds(items)).toEqual(new Set(["t1"]));
  });

  it("dedupes per path independently", () => {
    const items = [
      assistantItem(
        [
          { toolCallId: "a1", _card: htmlCard("a.html") },
          { toolCallId: "b1", _card: htmlCard("b.html") },
        ],
        0,
      ),
      assistantItem(
        [
          { toolCallId: "a2", _card: htmlCard("a.html") },
          { toolCallId: "b2", _card: htmlCard("b.html") },
        ],
        1,
      ),
    ];
    expect(computeSupersededToolCallIds(items)).toEqual(new Set(["a1", "b1"]));
  });

  it("ignores inline html cards (no file_path)", () => {
    const items = [
      assistantItem([{ toolCallId: "t1", _card: htmlCard() }], 0),
      assistantItem([{ toolCallId: "t2", _card: htmlCard() }], 1),
    ];
    expect(computeSupersededToolCallIds(items).size).toBe(0);
  });

  it("ignores non-html cards", () => {
    const items = [
      assistantItem(
        [
          { toolCallId: "t1", _card: { type: "image", mime: "image/png", file_path: "p.png" } as any },
          { toolCallId: "t2", _card: { type: "image", mime: "image/png", file_path: "p.png" } as any },
        ],
        0,
      ),
    ];
    expect(computeSupersededToolCallIds(items).size).toBe(0);
  });

  it("skips tool calls without a card", () => {
    const items = [assistantItem([{ toolCallId: "t1" }, { toolCallId: "t2" }], 0)];
    expect(computeSupersededToolCallIds(items).size).toBe(0);
  });
});
