import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { resolveTemplateVars } from "../template.js";

describe("resolveTemplateVars", () => {
  beforeEach(() => {
    vi.spyOn(Date.prototype, "getFullYear").mockReturnValue(2026);
    vi.spyOn(Date.prototype, "getMonth").mockReturnValue(5);
    vi.spyOn(Date.prototype, "getDate").mockReturnValue(8);
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(23);
    vi.spyOn(Date.prototype, "getMinutes").mockReturnValue(5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves {{date}} using the local timezone (not UTC)", () => {
    expect(resolveTemplateVars("{{date}}", { agentName: "", payload: "" })).toBe("2026-06-08");
  });

  it("resolves {{time}} using the local timezone", () => {
    expect(resolveTemplateVars("{{time}}", { agentName: "", payload: "" })).toBe("23:05");
  });

  it("resolves {{datetime}} with local date and local time", () => {
    expect(resolveTemplateVars("{{datetime}}", { agentName: "", payload: "" })).toBe("2026-06-08 23:05");
  });

  it("resolves {{weekday}} to a non-empty localized weekday name", () => {
    const out = resolveTemplateVars("{{weekday}}", { agentName: "", payload: "" });
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("resolves {{agent_name}} with the provided agent name", () => {
    expect(resolveTemplateVars("hi {{agent_name}}", { agentName: "Lia", payload: "" })).toBe("hi Lia");
  });

  it("resolves {{payload}} with the provided string payload", () => {
    expect(resolveTemplateVars("got: {{payload}}", { agentName: "", payload: "hello world" })).toBe("got: hello world");
  });

  it("payload replaces inline within larger text", () => {
    expect(
      resolveTemplateVars("User said {{payload}} on {{date}}", { agentName: "", payload: "test msg" }),
    ).toBe("User said test msg on 2026-06-08");
  });

  it("leaves unknown variables untouched", () => {
    expect(resolveTemplateVars("{{unknown}}", { agentName: "", payload: "" })).toBe("{{unknown}}");
  });
});
