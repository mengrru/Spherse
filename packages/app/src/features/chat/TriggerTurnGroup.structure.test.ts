import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("TriggerTurnGroup structure", () => {
  it("exposes the data-chat-turn-collapse hook on the summary bar", () => {
    const source = readFileSync(join(currentDir, "TriggerTurnGroup.tsx"), "utf8");
    expect(source).toContain("data-chat-turn-collapse");
  });

  it("defaults to collapsed and renders messages only through CollapsibleContent", () => {
    const source = readFileSync(join(currentDir, "TriggerTurnGroup.tsx"), "utf8");
    expect(source).toContain("useState(false)");
    expect(source).toContain("<CollapsibleContent>");
    expect(source.indexOf("items.map((item) => renderItem(item))")).toBeGreaterThan(
      source.indexOf("<CollapsibleContent>"),
    );
  });

  it("shows the error badge only when the turn failed", () => {
    const source = readFileSync(join(currentDir, "TriggerTurnGroup.tsx"), "utf8");
    expect(source).toContain("{hasError && (");
    expect(source).toContain("chat.triggerTurnErrorBadge");
  });
});

describe("MessageList turn grouping wiring", () => {
  it("derives turn groups and reverses at the group level", () => {
    const source = readFileSync(join(currentDir, "MessageList.tsx"), "utf8");
    expect(source).toContain("groupTurns(messages)");
    expect(source).toContain("[...groups].reverse()");
    expect(source).toContain("<TriggerTurnGroup");
  });
});
