import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { reducer, initialState } from "./use-update-checker";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "use-update-checker.ts"), "utf8");

describe("update checker reducer", () => {
  it("has initial state of idle", () => {
    expect(initialState).toEqual({ status: "idle" });
  });

  it("transitions to checking on CHECK", () => {
    expect(reducer(initialState, { type: "CHECK" })).toEqual({ status: "checking" });
  });

  it("sets available state with version, releaseNotes and downloadUrl on UPDATE_AVAILABLE", () => {
    expect(
      reducer(initialState, {
        type: "UPDATE_AVAILABLE",
        version: "1.2.0",
        releaseNotes: "fixes",
        downloadUrl: "https://example.com/release",
      }),
    ).toEqual({
      status: "available",
      version: "1.2.0",
      releaseNotes: "fixes",
      downloadUrl: "https://example.com/release",
    });
  });

  it("supports UPDATE_AVAILABLE without a downloadUrl", () => {
    expect(
      reducer(initialState, {
        type: "UPDATE_AVAILABLE",
        version: "1.2.0",
        releaseNotes: "fixes",
      }),
    ).toEqual({
      status: "available",
      version: "1.2.0",
      releaseNotes: "fixes",
    });
  });

  it("transitions to upToDate on UP_TO_DATE", () => {
    expect(reducer(initialState, { type: "UP_TO_DATE" })).toEqual({ status: "upToDate" });
  });

  it("transitions to downloading with percent on PROGRESS", () => {
    expect(
      reducer(initialState, { type: "PROGRESS", percent: 42 }),
    ).toEqual({ status: "downloading", percent: 42 });
  });

  it("transitions to downloaded on DOWNLOADED", () => {
    expect(reducer(initialState, { type: "DOWNLOADED" })).toEqual({ status: "downloaded" });
  });

  it("sets error status with message on ERROR (check phase from idle)", () => {
    expect(
      reducer(initialState, { type: "ERROR", message: "network down" }),
    ).toEqual({ status: "error", errorMessage: "network down", errorPhase: "check" });
  });

  it("sets errorPhase to download when error occurs during downloading", () => {
    const downloading = reducer(initialState, { type: "PROGRESS", percent: 50 });
    expect(
      reducer(downloading, { type: "ERROR", message: "download interrupted" }),
    ).toEqual({ status: "error", errorMessage: "download interrupted", errorPhase: "download" });
  });

  it("clears all fields back to idle on RESET", () => {
    const downloading = reducer(initialState, { type: "PROGRESS", percent: 50 });
    expect(reducer(downloading, { type: "RESET" })).toEqual({ status: "idle" });
  });

  it("replaces the entire state on SET_STATE", () => {
    const incoming = { status: "downloading" as const, percent: 80 };
    expect(reducer(initialState, { type: "SET_STATE", state: incoming })).toEqual(incoming);
  });
});

describe("useUpdateChecker host bridge wiring", () => {
  it("does not reference window.electronAPI directly", () => {
    expect(source).not.toContain("window.electronAPI");
  });

  it("reads the updater through useHostBridge", () => {
    expect(source).toContain("useHostBridge");
    expect(source).toContain("bridge.updater");
  });

  it("no-ops the subscribe effect when updater is unavailable", () => {
    expect(source).toContain("if (!updater) return");
  });
});
