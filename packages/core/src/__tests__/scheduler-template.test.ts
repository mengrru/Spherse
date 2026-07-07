import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { resolveTemplateVars } from "../scheduler.js";

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
    expect(resolveTemplateVars("{{date}}", "")).toBe("2026-06-08");
  });

  it("resolves {{time}} using the local timezone", () => {
    expect(resolveTemplateVars("{{time}}", "")).toBe("23:05");
  });

  it("resolves {{datetime}} with local date and local time", () => {
    expect(resolveTemplateVars("{{datetime}}", "")).toBe("2026-06-08 23:05");
  });

  it("resolves {{weekday}} to a non-empty localized weekday name", () => {
    const out = resolveTemplateVars("{{weekday}}", "");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("resolves {{agent_name}} with the provided agent name", () => {
    expect(resolveTemplateVars("hi {{agent_name}}", "Lia")).toBe("hi Lia");
  });

  it("leaves unknown variables untouched", () => {
    expect(resolveTemplateVars("{{unknown}}", "")).toBe("{{unknown}}");
  });
});
