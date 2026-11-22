import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, type ProjectRuntime } from "@spherse/core";
import { settingsMethods } from "../rpc/methods/settings.js";
import {
  callMethod,
  createFakeProjectCtx,
  createRpcHarness,
  type RpcHarness,
} from "@spherse/rpc/testing";
import { createSilentLoggerForTests } from "./test-logger.js";

describe("settings side panel rpc methods", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;
  let harness: RpcHarness;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rpc-settings-side-panel-"));
    runtime = await createProject(tmpDir, { logger: createSilentLoggerForTests() });
    harness = createRpcHarness({
      methods: settingsMethods,
      projectCtx: { projectManager: runtime.projectManager } as unknown as ReturnType<
        typeof createFakeProjectCtx
      >,
    });
  });

  afterEach(async () => {
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const readProjectYaml = () => fs.readFileSync(path.join(tmpDir, ".spherse", "project.yaml"), "utf-8");

  it("settings.getSidePanel returns null path by default", async () => {
    const frame = await callMethod(harness, "settings.getSidePanel", { projectId: "p1" });
    expect(frame).toMatchObject({ type: "result", ok: true, data: { ok: true, path: null } });
  });

  it("settings.updateSidePanel persists a valid path to project.yaml", async () => {
    const update = await callMethod(harness, "settings.updateSidePanel", {
      projectId: "p1",
      path: "panel/index.html",
    });
    expect(update).toMatchObject({
      type: "result",
      ok: true,
      data: { ok: true, path: "panel/index.html" },
    });
    expect(readProjectYaml()).toContain("sidePanel");
    expect(readProjectYaml()).toContain("panel/index.html");

    const get = await callMethod(harness, "settings.getSidePanel", { projectId: "p1" });
    expect(get).toMatchObject({ type: "result", ok: true, data: { ok: true, path: "panel/index.html" } });
  });

  it("settings.updateSidePanel rejects a non-html path without persisting it", async () => {
    const frame = await callMethod(harness, "settings.updateSidePanel", {
      projectId: "p1",
      path: "poster.png",
    });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: -32602, message: "Invalid side panel path: poster.png" },
    });

    const get = await callMethod(harness, "settings.getSidePanel", { projectId: "p1" });
    expect(get).toMatchObject({ type: "result", ok: true, data: { ok: true, path: null } });
    expect(readProjectYaml()).not.toContain("sidePanel");
  });

  it("settings.updateSidePanel rejects a non-string path with invalid params", async () => {
    const frame = await callMethod(harness, "settings.updateSidePanel", { projectId: "p1", path: 5 });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
    expect(readProjectYaml()).not.toContain("sidePanel");
  });

  it("settings.updateSidePanel clears the path with null", async () => {
    await callMethod(harness, "settings.updateSidePanel", { projectId: "p1", path: "panel.html" });
    const frame = await callMethod(harness, "settings.updateSidePanel", { projectId: "p1", path: null });
    expect(frame).toMatchObject({ type: "result", ok: true, data: { ok: true, path: null } });

    const get = await callMethod(harness, "settings.getSidePanel", { projectId: "p1" });
    expect(get).toMatchObject({ type: "result", ok: true, data: { ok: true, path: null } });
    expect(readProjectYaml()).not.toContain("panel.html");
  });
});
