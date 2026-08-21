import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, type ProjectRuntime } from "@spherse/core";
import { createSilentLoggerForTests } from "./test-logger.js";

describe("data store assembly contract (real ProjectRuntime, no mocks)", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-data-asm-"));
    runtime = await createProject(tmpDir, { logger: createSilentLoggerForTests() });
  });

  afterAll(async () => {
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runtime exposes a working DataStore wired into default capabilities", async () => {
    expect(runtime.dataStore).toBeDefined();
    const w = await runtime.dataStore!.rawSet("board.data.json", "score", 7);
    expect(w.version).toMatch(/^[0-9a-f]{64}$/);
    const r = await runtime.dataStore!.read("board.data.json", { key: "score" });
    expect(r.value).toBe(7);
    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "board.data.json"), "utf8"));
    expect(onDisk).toEqual({ score: 7 });
  });

  it("data capability tools are registered in the default tool set", () => {
    const caps = (runtime as unknown as { capabilities: ReadonlyArray<{ id: string }> }).capabilities;
    expect(caps.some((c) => c.id === "data")).toBe(true);
  });
});
