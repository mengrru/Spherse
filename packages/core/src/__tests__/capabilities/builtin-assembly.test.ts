import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectStore } from "../../store/project.js";
import { builtinToolCapabilities } from "../../capabilities/builtin.js";
import { RunConfigHolder, createRuntimeDeps } from "../../session/runtime.js";
import { createStoreRegistry } from "../../kernel/ports.js";
import { buildPromptAndTools } from "../../session/agent-assembly.js";
import { createSilentLogger } from "../../logger.js";
import { FileWriteMutex } from "../../utils/file-write-mutex.js";
import type { AgentProfile } from "../../types.js";

const PROFILE: AgentProfile = {
  id: "a1",
  name: "A",
  slug: "a",
  systemPrompt: "sp",
  tools: [],
  context: [],
  createdAt: 0,
};

describe("builtin tool capabilities via real assembly path", () => {
  let tmpDir: string;
  let store: ProjectStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-asmtools-"));
    store = new ProjectStore(tmpDir, createSilentLogger());
    await store.create("Test");
  });
  afterEach(async () => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function assembleWith(tools: string[]) {
    const deps = createRuntimeDeps({
      projectStore: store,
      logger: createSilentLogger(),
      fileWriteMutex: new FileWriteMutex(),
      capabilities: [...builtinToolCapabilities()],
      stores: createStoreRegistry(),
      runConfig: new RunConfigHolder(),
    });
    const { tools: resolved } = await buildPromptAndTools(
      deps,
      { ...PROFILE, tools },
      "s1",
      undefined,
      undefined,
      undefined,
    );
    return resolved;
  }

  it("registers the full builtin tool set through capabilities", async () => {
    const wanted = [
      "read_file",
      "write_file",
      "edit_file",
      "list_files",
      "search_content",
      "append_changelog",
      "render_card",
      "generate_image",
      "move_file",
      "copy_file",
      "load_skill",
      "run_command",
      "ask_user",
      "manage_agent",
    ];
    const tools = await assembleWith(wanted);
    expect(tools.map((t) => t.name).sort()).toEqual([...wanted].sort());
  });

  it("ask_user is part of the builtin set", async () => {
    const tools = await assembleWith(["ask_user"]);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("ask_user");
  });

  it("unknown tool names resolve to nothing (profile filter drops them)", async () => {
    const tools = await assembleWith(["no_such_tool"]);
    expect(tools).toEqual([]);
  });
});
