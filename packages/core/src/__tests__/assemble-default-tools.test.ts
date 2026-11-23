import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleProject } from "../factory.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("assembleProject default tool catalog", () => {
  it("mounts run_command via the default Node capability set", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assemble-tools-"));
    dirs.push(dir);
    const runtime = await assembleProject(dir, { projectName: "tools" });
    try {
      const interaction = runtime.capabilities.find((c) => c.id === "interaction");
      expect(interaction).toBeDefined();
      const tools = interaction!.tools!({ projectRoot: dir } as never) as Array<{ name: string }>;
      expect(tools.map((t) => t.name)).toContain("run_command");
      expect(tools.map((t) => t.name)).toContain("ask_user");
    } finally {
      await runtime.shutdown();
    }
  });
});
