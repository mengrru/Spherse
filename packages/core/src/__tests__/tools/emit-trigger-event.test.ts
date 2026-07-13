import { describe, it, expect, vi } from "vitest";
import { createEmitTriggerEventTool } from "../../tools/emit-trigger-event.js";
import type { TriggerManager } from "../../trigger/trigger-manager.js";

describe("createEmitTriggerEventTool", () => {
  function makeTool(firedCount = 1) {
    const onUserEvent = vi.fn().mockReturnValue(firedCount);
    const triggerManager = { onUserEvent } as unknown as TriggerManager;
    const tool = createEmitTriggerEventTool(triggerManager);
    return { tool, onUserEvent };
  }

  it("emits an event and reports fired count", async () => {
    const { tool, onUserEvent } = makeTool(2);
    const result = await tool.execute(
      "tc1",
      { event_name: "chapter-done", payload: "ch1" },
      undefined as any,
    );
    expect(onUserEvent).toHaveBeenCalledWith("chapter-done", "ch1");
    expect(result.content[0].text).toContain("2 trigger(s) fired");
    expect(result.details).toMatchObject({ eventName: "chapter-done", payload: "ch1", firedCount: 2 });
  });

  it("defaults payload to empty string", async () => {
    const { tool, onUserEvent } = makeTool(1);
    await tool.execute("tc1", { event_name: "ping" }, undefined as any);
    expect(onUserEvent).toHaveBeenCalledWith("ping", "");
  });

  it("trims whitespace in event_name", async () => {
    const { tool, onUserEvent } = makeTool(1);
    await tool.execute("tc1", { event_name: "  ping  " }, undefined as any);
    expect(onUserEvent).toHaveBeenCalledWith("ping", "");
  });

  it("rejects empty event_name without emitting", async () => {
    const { tool, onUserEvent } = makeTool();
    const result = await tool.execute("tc1", { event_name: "   " }, undefined as any);
    expect(onUserEvent).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ error: true });
  });

  it("rejects reserved sp: prefix without emitting", async () => {
    const { tool, onUserEvent } = makeTool();
    const result = await tool.execute(
      "tc1",
      { event_name: "sp:time-tick" },
      undefined as any,
    );
    expect(onUserEvent).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ error: true, reserved: true });
    expect(result.content[0].text).toContain("reserved");
  });

  it("warns when no trigger matched", async () => {
    const { tool, onUserEvent } = makeTool(0);
    const result = await tool.execute(
      "tc1",
      { event_name: "unknown-event" },
      undefined as any,
    );
    expect(onUserEvent).toHaveBeenCalledWith("unknown-event", "");
    expect(result.content[0].text).toContain("no enabled event trigger matched");
    expect(result.details).toMatchObject({ eventName: "unknown-event", firedCount: 0 });
  });
});
