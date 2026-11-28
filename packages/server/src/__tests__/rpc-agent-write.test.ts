import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, type ProjectRuntime } from "@spherse/core";
import { callMethod, createRpcHarness, type RpcHarness } from "@spherse/rpc/testing";
import { contentMethods } from "@spherse/rpc/methods";
import { createSilentLoggerForTests } from "./test-logger.js";

describe("write facade contract: real ProjectManager through rpc content methods", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;
  let harness: RpcHarness;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-facade-contract-"));
    runtime = await createProject(tmpDir, {
      projectName: "Contract",
      logger: createSilentLoggerForTests(),
    });

    harness = createRpcHarness({
      methods: contentMethods,
      projectCtx: {
        projectManager: runtime.projectManager,
        runtime,
        sessionRuntime: runtime.sessionRuntime,
        triggerManager: runtime.triggerManager,
      },
    });
  });

  afterAll(async () => {
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("content.save writeFile: user files are writable through the real facade", async () => {
    const frame = await callMethod(harness, "content.save", {
      projectId: "p1",
      path: "chapters/one.md",
      content: "# One",
    });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(tmpDir, "chapters/one.md"), "utf-8")).toBe("# One");
  });

  it("content.mkdir and content.touch createEntry: mkdir and touch work through the real facade", async () => {
    const mkdir = await callMethod(harness, "content.mkdir", { projectId: "p1", path: "newdir" });
    expect(mkdir).toMatchObject({ type: "result", ok: true });
    expect(fs.statSync(path.join(tmpDir, "newdir")).isDirectory()).toBe(true);

    const touch = await callMethod(harness, "content.touch", { projectId: "p1", path: "newdir/f.md" });
    expect(touch).toMatchObject({ type: "result", ok: true });
    expect(fs.readFileSync(path.join(tmpDir, "newdir/f.md"), "utf-8")).toBe("");
  });

  it("content.touch createEntry conflict maps to app error 102", async () => {
    const frame = await callMethod(harness, "content.touch", { projectId: "p1", path: "newdir/f.md" });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: 102 } });
  });

  it("content.delete deletePath: removes entries through the real facade; missing is ok", async () => {
    const frame = await callMethod(harness, "content.delete", { projectId: "p1", path: "newdir/f.md" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(fs.existsSync(path.join(tmpDir, "newdir/f.md"))).toBe(false);

    const missing = await callMethod(harness, "content.delete", {
      projectId: "p1",
      path: "never-there.md",
    });
    expect(missing).toMatchObject({ type: "result", ok: true });
  });

  it("content.rename renamePath: renames through the real facade, case-only renames pass", async () => {
    await callMethod(harness, "content.save", {
      projectId: "p1",
      path: "newdir/renamed.md",
      content: "x",
    });
    const frame = await callMethod(harness, "content.rename", {
      projectId: "p1",
      path: "newdir/renamed.md",
      to: "newdir/final.md",
    });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(fs.existsSync(path.join(tmpDir, "newdir/final.md"))).toBe(true);

    fs.writeFileSync(path.join(tmpDir, "newdir/case.md"), "x");
    const caseOnly = await callMethod(harness, "content.rename", {
      projectId: "p1",
      path: "newdir/case.md",
      to: "newdir/CASE.md",
    });
    expect(caseOnly).toMatchObject({ type: "result", ok: true });
    const kept =
      fs.existsSync(path.join(tmpDir, "newdir/case.md")) ||
      fs.existsSync(path.join(tmpDir, "newdir/CASE.md"));
    expect(kept).toBe(true);
  });

  it("content.rename: cross-directory surfaces as invalid params, missing source 100, existing destination 102, denied path 101", async () => {
    const crossDir = await callMethod(harness, "content.rename", {
      projectId: "p1",
      path: "newdir/final.md",
      to: "elsewhere/final.md",
    });
    expect(crossDir).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });

    const missing = await callMethod(harness, "content.rename", {
      projectId: "p1",
      path: "nope.md",
      to: "nope2.md",
    });
    expect(missing).toMatchObject({ type: "result", ok: false, error: { code: 100 } });

    await callMethod(harness, "content.touch", { projectId: "p1", path: "newdir/taken.md" });
    const conflict = await callMethod(harness, "content.rename", {
      projectId: "p1",
      path: "newdir/final.md",
      to: "newdir/taken.md",
    });
    expect(conflict).toMatchObject({ type: "result", ok: false, error: { code: 102 } });

    fs.writeFileSync(path.join(tmpDir, "root-taken.md"), "x");
    const denied = await callMethod(harness, "content.rename", {
      projectId: "p1",
      path: "root-taken.md",
      to: ".spherse/project.yaml",
    });
    expect(denied).toMatchObject({ type: "result", ok: false, error: { code: 101 } });
  });

  it("content.touch creating an entry literally named 'rename' still works", async () => {
    const frame = await callMethod(harness, "content.touch", { projectId: "p1", path: "rename" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(fs.existsSync(path.join(tmpDir, "rename"))).toBe(true);
  });

  it("content.save still denies engine-internal paths via real policy (101)", async () => {
    const frame = await callMethod(harness, "content.save", {
      projectId: "p1",
      path: ".spherse/project.yaml",
      content: "id: hacked",
    });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: 101 } });
    expect(fs.readFileSync(path.join(tmpDir, ".spherse/project.yaml"), "utf-8")).not.toContain("hacked");
  });
});
