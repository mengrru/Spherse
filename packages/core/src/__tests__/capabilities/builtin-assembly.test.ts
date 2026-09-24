import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectStore } from "../../store/project.js";
import { builtinToolCapabilities } from "../../capabilities/builtin.js";
import { RunConfigHolder, createRuntimeDeps } from "../../session/runtime.js";
import { createStoreRegistry } from "../../kernel/ports.js";
import { buildPromptAndTools, composeStreamFn, streamDecoratorsFor } from "../../session/agent-assembly.js";
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
      "web_search",
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

  describe("web_search visibility follows the DeepSeek key", () => {
    afterEach(() => {
      delete process.env.DEEPSEEK_API_KEY;
    });

    async function llmToolNames(): Promise<{ sent: string[]; state: string[] }> {
      const profile = { ...PROFILE, tools: ["read_file", "web_search"] };
      const tools = await assembleWith(profile.tools);
      const base = vi.fn(async () => ({}) as never);
      const streamFn = composeStreamFn(
        { getChatStreamFn: () => base } as never,
        undefined,
        streamDecoratorsFor(builtinToolCapabilities(), {
          agentId: profile.id,
          profile,
          projectStore: store,
          stores: createStoreRegistry(),
        }),
      );
      await streamFn({} as never, { systemPrompt: "", messages: [], tools } as never, undefined);
      const sent = (base.mock.calls[0] as unknown as [unknown, { tools: Array<{ name: string }> }])[1].tools;
      return { sent: sent.map((t) => t.name), state: tools.map((t) => t.name) };
    }

    it("hides web_search from the request without a key but keeps it executable", async () => {
      delete process.env.DEEPSEEK_API_KEY;
      const { sent, state } = await llmToolNames();
      expect(sent).toEqual(["read_file"]);
      expect(state).toEqual(["read_file", "web_search"]);
    });

    it("sends web_search when the key is configured", async () => {
      process.env.DEEPSEEK_API_KEY = "sk-test-key";
      const { sent } = await llmToolNames();
      expect(sent).toEqual(["read_file", "web_search"]);
    });
  });
});
