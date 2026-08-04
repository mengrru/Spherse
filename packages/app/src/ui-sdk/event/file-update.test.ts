import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FILE_UPDATE_DEBOUNCE_MS,
  FileUpdateDebouncer,
  normalizeEventPath,
  parseFileUpdate,
} from "./file-update";

afterEach(() => {
  vi.useRealTimers();
});

describe("normalizeEventPath", () => {
  it("normalizes project-relative paths", () => {
    expect(normalizeEventPath("./world\\maps/../data.json")).toBe("world/data.json");
  });

  it("rejects absolute paths and traversal outside the project", () => {
    expect(normalizeEventPath("/tmp/data.json")).toBeNull();
    expect(normalizeEventPath("C:\\tmp\\data.json")).toBeNull();
    expect(normalizeEventPath("../data.json")).toBeNull();
  });
});

describe("parseFileUpdate", () => {
  it("validates and normalizes fs-watch payloads", () => {
    expect(parseFileUpdate({ path: "world\\data.json", eventType: "rename" })).toEqual({
      path: "world/data.json",
      eventType: "rename",
    });
    expect(parseFileUpdate({ path: "world/data.json", eventType: "invalid" })).toBeNull();
  });
});

describe("FileUpdateDebouncer", () => {
  it("coalesces updates for the same path and preserves the latest payload", () => {
    vi.useFakeTimers();
    const debouncer = new FileUpdateDebouncer();
    const deliver = vi.fn();
    debouncer.schedule({ path: "data.json", eventType: "change" }, deliver);
    debouncer.schedule({ path: "data.json", eventType: "rename" }, deliver);

    vi.advanceTimersByTime(FILE_UPDATE_DEBOUNCE_MS);

    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith({ path: "data.json", eventType: "rename" });
  });
});
