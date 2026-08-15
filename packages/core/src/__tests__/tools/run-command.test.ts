import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  createRunCommandTool,
  buildSpawnTarget,
  expandHome,
  resolveCommandCwd,
  type CommandCardDetails,
} from "../../tools/run-command.js";
import { AccessDeniedError } from "../../errors.js";
import { createTempProject, cleanupDir } from "../helpers.js";

describe("createRunCommandTool", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });
  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("captures stdout and exit code on success", async () => {
    const tool = createRunCommandTool(projectRoot);
    const result = await tool.execute("tc1", { command: "printf hello" }, undefined, undefined);
    const details = result.details as CommandCardDetails;
    expect(details.status).toBe("completed");
    expect(details.exitCode).toBe(0);
    expect(details.stdout).toBe("hello");
  });

  it("reports error status on non-zero exit with stderr", async () => {
    const tool = createRunCommandTool(projectRoot);
    const result = await tool.execute("tc1", { command: "echo oops 1>&2; exit 3" }, undefined, undefined);
    const details = result.details as CommandCardDetails;
    expect(details.status).toBe("error");
    expect(details.exitCode).toBe(3);
    expect(details.stderr).toContain("oops");
  });

  it("streams partial output via onUpdate", async () => {
    const tool = createRunCommandTool(projectRoot);
    const onUpdate = vi.fn();
    await tool.execute("tc1", { command: "echo line1; echo line2" }, undefined, onUpdate);
    expect(onUpdate.mock.calls.length).toBeGreaterThan(0);
    const lastPartial = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0].details as CommandCardDetails;
    expect(lastPartial.status).toBe("running");
  });

  it("kills the process on timeout and marks timedOut", async () => {
    const tool = createRunCommandTool(projectRoot);
    const result = await tool.execute("tc1", { command: "sleep 5", timeout_ms: 150 }, undefined, undefined);
    const details = result.details as CommandCardDetails;
    expect(details.status).toBe("error");
    expect(details.timedOut).toBe(true);
  }, 5000);

  it("kills the process when abort signal fires mid-run", async () => {
    const tool = createRunCommandTool(projectRoot);
    const controller = new AbortController();
    const promise = tool.execute("tc1", { command: "sleep 5", timeout_ms: 10000 }, controller.signal, undefined);
    setTimeout(() => controller.abort(), 150);
    const result = await promise;
    const details = result.details as CommandCardDetails;
    expect(details.status).toBe("error");
  }, 5000);

  it("rejects cwd outside the allowed roots", async () => {
    const tool = createRunCommandTool(projectRoot);
    await expect(
      tool.execute("tc1", { command: "echo hi", cwd: "/" }, undefined, undefined),
    ).rejects.toThrow();
  });

  it("uses project-relative cwd", async () => {
    const tool = createRunCommandTool(projectRoot);
    const result = await tool.execute("tc1", { command: "pwd" }, undefined, undefined);
    const details = result.details as CommandCardDetails;
    expect(details.cwd).toBe(".");
    expect((result.content[0] as { text: string }).text).toContain(projectRoot);
  });

  it("runs in user home with cwd ~", async () => {
    const tool = createRunCommandTool(projectRoot);
    const result = await tool.execute("tc1", { command: "pwd", cwd: "~" }, undefined, undefined);
    const details = result.details as CommandCardDetails;
    expect(details.cwd).toBe("~");
    expect(details.status).toBe("completed");
    expect(details.stdout).toContain(os.homedir());
  });
});

describe("expandHome", () => {
  const home = path.join(os.tmpdir(), "wb-fake-home");

  it("expands ~ to home", () => {
    expect(expandHome("~", home)).toBe(home);
  });

  it("expands ~/x to a path inside home", () => {
    expect(expandHome("~/x", home)).toBe(path.join(home, "x"));
  });

  it("expands tilde-backslash form to home", () => {
    expect(expandHome("~\\", home)).toBe(path.join(home, ""));
  });

  it("leaves ~other and plain strings unchanged", () => {
    expect(expandHome("~other/x", home)).toBe("~other/x");
    expect(expandHome("src", home)).toBe("src");
    expect(expandHome("some/file", home)).toBe("some/file");
  });
});

describe("resolveCommandCwd", () => {
  const home = path.join(os.tmpdir(), "wb-fake-home");
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });
  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("resolves . and relative paths against projectRoot", () => {
    expect(resolveCommandCwd(projectRoot, ".", home)).toBe(path.resolve(projectRoot));
    expect(resolveCommandCwd(projectRoot, "src", home)).toBe(path.resolve(projectRoot, "src"));
  });

  it("expands ~ and ~/... to home", () => {
    expect(resolveCommandCwd(projectRoot, "~", home)).toBe(home);
    expect(resolveCommandCwd(projectRoot, "~/Documents", home)).toBe(path.join(home, "Documents"));
  });

  it("resolves ~/ exactly to home", () => {
    expect(resolveCommandCwd(projectRoot, "~/", home)).toBe(home);
  });

  it("resolves empty string to projectRoot", () => {
    expect(resolveCommandCwd(projectRoot, "", home)).toBe(path.resolve(projectRoot));
  });

  it("treats ~other literally, resolving against projectRoot", () => {
    const resolved = resolveCommandCwd(projectRoot, "~other/x", home);
    expect(resolved).toBe(path.resolve(projectRoot, "~other/x"));
  });

  it("allows absolute paths inside home", () => {
    const docs = path.join(home, "Documents");
    expect(resolveCommandCwd(projectRoot, docs, home)).toBe(docs);
  });

  it("allows absolute paths inside projectRoot", () => {
    const nested = path.join(projectRoot, "src");
    expect(resolveCommandCwd(projectRoot, nested, home)).toBe(path.resolve(nested));
  });

  it("rejects absolute paths outside both roots", () => {
    expect(() => resolveCommandCwd(projectRoot, path.resolve("/"), home)).toThrow(AccessDeniedError);
    const outside = path.join(os.tmpdir(), "wb-outside-root");
    expect(() => resolveCommandCwd(projectRoot, outside, home)).toThrow(AccessDeniedError);
  });

  it("allows relative paths escaping projectRoot into home", () => {
    const rel = path.relative(projectRoot, path.join(home, "docs"));
    expect(resolveCommandCwd(projectRoot, rel, home)).toBe(path.join(home, "docs"));
  });

  it("rejects relative paths escaping both roots", () => {
    expect(() => resolveCommandCwd(projectRoot, "../outside", home)).toThrow(AccessDeniedError);
  });
});

describe("buildSpawnTarget", () => {
  const command = "echo hi";
  it("uses sh -c on unix with detached process group", () => {
    const t = buildSpawnTarget(command, "/tmp", "darwin", "");
    expect(t.file).toBe("/bin/sh");
    expect(t.args).toEqual(["-c", command]);
    expect(t.detached).toBe(true);
  });
  it("uses PowerShell with -NoProfile -NonInteractive -Command on win32", () => {
    const t = buildSpawnTarget(command, "C:\\proj", "win32", "pwsh");
    expect(t.file).toBe("pwsh");
    expect(t.args).toEqual(["-NoProfile", "-NonInteractive", "-Command", command]);
    expect(t.detached).toBe(false);
  });
  it("falls back to detected windows shell name", () => {
    const t = buildSpawnTarget(command, "C:\\proj", "win32", "powershell");
    expect(t.file).toBe("powershell");
  });
});
