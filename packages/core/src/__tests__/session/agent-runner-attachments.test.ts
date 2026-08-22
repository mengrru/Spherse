import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createSilentLogger } from "../../logger.js";

const { getChatStreamFnMock, resolveModelByIdMock } = vi.hoisted(() => ({
  getChatStreamFnMock: vi.fn(() => vi.fn()),
  resolveModelByIdMock: vi.fn((modelId: string) => {
    const slashIdx = modelId.indexOf("/");
    return slashIdx >= 0
      ? { id: modelId.slice(slashIdx + 1), provider: modelId.slice(0, slashIdx) }
      : { id: modelId, provider: modelId };
  }),
}));

const stubCatalog = {
  getChatStreamFn: getChatStreamFnMock,
  resolveModelById: resolveModelByIdMock,
} as never;

import { createProject } from "../../factory.js";
import { AgentRunner } from "../../session/agent-runner.js";
import { SessionEventLog } from "../../session/event-log.js";
import { deriveMessages } from "../../session/fold.js";
import { RunConfigHolder, type RuntimeDeps } from "../../session/runtime.js";
import { createModelResolver } from "../../session/model-resolver.js";
import { createImageAttachmentProcessor } from "../../attachments/image-processor.js";
import { builtinToolCapabilities } from "../../capabilities/builtin.js";
import { attachmentsCapability } from "../../capabilities/attachments/index.js";
import { createStoreRegistry } from "../../kernel/ports.js";

const TEST_AGENT_PROFILE = `---
name: Test Agent
tools:
  - read_file
---

Test agent for sessions.`;

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

interface RuntimeInternals {
  projectManager: { projectStore: { agents: Map<string, unknown> } };
  triggerManager: { stopAll: () => void };
  timerService: { stop: () => void };
}

function agentOf(runner: AgentRunner): any {
  return runner.agentRef;
}

describe("AgentRunner attachment handling", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let deps: RuntimeDeps;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-live-att-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore as any;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.timerService.stop();
    deps = {
      projectStore,
      projectRoot: projectStore.getRootPath(),
      fileWriteMutex: (runtime as any).sessionRuntime.deps.fileWriteMutex,
      logger: createSilentLogger(),
      runConfig: new RunConfigHolder({ defaultModel: "openai/gpt-4o" }),
      modelResolver: createModelResolver(stubCatalog),
      modelCatalog: stubCatalog,
      capabilities: [...builtinToolCapabilities(), attachmentsCapability()],
      stores: createStoreRegistry(),
      attachmentProcessors: [createImageAttachmentProcessor()],
    };

    const attachmentsDir = path.join(tmpDir, ".spherse", "attachments");
    fs.mkdirSync(attachmentsDir, { recursive: true });
    fs.writeFileSync(path.join(attachmentsDir, "photo.png"), PNG_BYTES);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createRunner(): Promise<{ runner: AgentRunner; sessionId: string }> {
    const agentStore = (deps.projectStore as any).getAgent(agentId) as any;
    const sessionId = agentStore.sessions.createSession();
    const eventLog = SessionEventLog.open(agentStore.sessions, sessionId);
    const runner = await AgentRunner.init(deps, agentId, sessionId, { eventLog });
    return { runner, sessionId };
  }

  async function driveSend(
    runner: AgentRunner,
    message: string,
    attachment: any,
  ): Promise<{
    promptArg: any;
    events: any[];
    agent: any;
    sessionId: string;
  }> {
    const agent = agentOf(runner);
    const events: any[] = [];

    let capturedListener: ((event: any) => void | Promise<void>) | undefined;
    const unsubscribe = vi.fn();
    vi.spyOn(agent, "subscribe").mockImplementation((listener: any) => {
      capturedListener = listener;
      return unsubscribe as any;
    });

    const promptArg = { current: undefined as any };
    const assistantMsg = {
      role: "assistant",
      content: [{ type: "text", text: "I see it." }],
      api: "responses",
      provider: "openai",
      model: "gpt-4o",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    vi.spyOn(agent, "prompt").mockImplementation(async (input: any) => {
      promptArg.current = input;
      agent.state.messages.push(input);
      await capturedListener?.({ type: "message_start", message: input });
      await capturedListener?.({ type: "message_end", message: input });
      agent.state.messages.push(assistantMsg);
      await capturedListener?.({ type: "message_start", message: assistantMsg });
      await capturedListener?.({ type: "message_end", message: assistantMsg });
      await capturedListener?.({
        type: "agent_end",
        messages: [...agent.state.messages],
      });
    });

    await runner.sendMessage(message, [attachment], (e) => events.push(e));

    return { promptArg: promptArg.current, events, agent, sessionId: (runner as any).sessionId };
  }

  it("sends a real ImageContent to the LLM for the current turn", async () => {
    const { runner } = await createRunner();

    const attachment = {
      type: "image",
      path: ".spherse/attachments/photo.png",
      mimeType: "image/png",
    };
    const { promptArg } = await driveSend(runner, "describe this", attachment);

    expect(promptArg.role).toBe("user");
    expect(Array.isArray(promptArg.content)).toBe(true);
    const imgBlock = promptArg.content.find((c: any) => c.type === "image");
    expect(imgBlock).toBeDefined();
    expect(imgBlock.data).toBe(PNG_BYTES.toString("base64"));
    expect(imgBlock.mimeType).toBe("image/png");
    const textBlock = promptArg.content.find((c: any) => c.type === "text");
    expect(textBlock.text).toBe("describe this");
  });

  it("persists the stripped user message (no base64, text-only content, with _attachments)", async () => {
    const { runner } = await createRunner();

    const attachment = {
      type: "image",
      path: ".spherse/attachments/photo.png",
      mimeType: "image/png",
    };
    const { agent, sessionId } = await driveSend(runner, "describe this", attachment);

    const agentStore = (deps.projectStore as any).getAgent(agentId) as any;
    const persisted = deriveMessages(agentStore.sessions.readEvents(sessionId));
    const persistedUser = persisted.find((m: any) => m.role === "user");
    expect(persistedUser).toBeDefined();
    expect(persistedUser._attachments).toEqual([attachment]);
    expect(persistedUser.content).toEqual([{ type: "text", text: "describe this" }]);
    expect(JSON.stringify(persistedUser)).not.toContain(PNG_BYTES.toString("base64"));
    void agent;
  });

  it("forwards the stripped user message_end onEvent", async () => {
    const { runner } = await createRunner();

    const attachment = {
      type: "image",
      path: ".spherse/attachments/photo.png",
      mimeType: "image/png",
    };
    const { events } = await driveSend(runner, "describe this", attachment);

    const userMsgEnd = events.find(
      (e: any) => e.type === "message_end" && e.message?.role === "user",
    );
    expect(userMsgEnd).toBeDefined();
    expect(userMsgEnd.message._attachments).toEqual([attachment]);
    expect(userMsgEnd.message.content.every((c: any) => c.type === "text")).toBe(true);
    expect(JSON.stringify(userMsgEnd.message)).not.toContain(PNG_BYTES.toString("base64"));
  });

  it("in-memory user message stays the stripped version after the run", async () => {
    const { runner } = await createRunner();

    const attachment = {
      type: "image",
      path: ".spherse/attachments/photo.png",
      mimeType: "image/png",
    };
    const { agent } = await driveSend(runner, "describe this", attachment);

    const lastUser = [...agent.state.messages]
      .reverse()
      .find((m: any) => m.role === "user");
    expect(lastUser).toBeDefined();
    expect(lastUser._attachments).toEqual([attachment]);
    expect(lastUser.content.every((c: any) => c.type === "text")).toBe(true);
    expect(JSON.stringify(agent.state.messages)).not.toContain(PNG_BYTES.toString("base64"));
  });

  it("convertToLlm strips _attachments, drops empty-data image blocks, keeps real image blocks", async () => {
    const { runner } = await createRunner();
    const agent = agentOf(runner);

    const attachment = {
      type: "image",
      path: ".spherse/attachments/photo.png",
      mimeType: "image/png",
    };

    const out = agent.convertToLlm([
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          { type: "image", data: "", mimeType: "image/png" },
        ],
        _attachments: [attachment],
        timestamp: 1,
      },
      {
        role: "user",
        content: [
          { type: "text", text: "real" },
          { type: "image", data: "abc", mimeType: "image/png" },
        ],
        timestamp: 2,
      },
    ]);

    expect(out).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "hi" }],
        timestamp: 1,
      },
      {
        role: "user",
        content: [
          { type: "text", text: "real" },
          { type: "image", data: "abc", mimeType: "image/png" },
        ],
        timestamp: 2,
      },
    ]);
  });

  it("throws on unsupported attachment type", async () => {
    const { runner } = await createRunner();

    await expect(
      runner.sendMessage("hi", [{ type: "pdf", path: "x", mimeType: "application/pdf" }], () => {}),
    ).rejects.toThrow(/Unsupported attachment type: pdf/);
  });

  it("never transmits base64 over onEvent or the event log", async () => {
    const { runner } = await createRunner();

    const attachment = {
      type: "image",
      path: ".spherse/attachments/photo.png",
      mimeType: "image/png",
    };
    const { events, sessionId } = await driveSend(runner, "describe this", attachment);

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(JSON.stringify(event)).not.toContain(PNG_BYTES.toString("base64"));
    }

    const agentStore = (deps.projectStore as any).getAgent(agentId) as any;
    const rawEvents = agentStore.sessions.readEvents(sessionId);
    expect(JSON.stringify(rawEvents)).not.toContain(PNG_BYTES.toString("base64"));

    const assistantEnd = events.find((e: any) => e.type === "agent_end");
    expect(assistantEnd).toBeDefined();
  });
});
