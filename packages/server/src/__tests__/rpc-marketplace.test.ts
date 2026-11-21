import { beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { installMarketplaceProjectZip } from "@spherse/core";
import type {
  MarketplaceManifestResponse,
  MarketplaceProjectManifestResponse,
  MarketplacePromptManifestResponse,
  SkillDefinition,
} from "@spherse/contracts";
import { skillMethods } from "../rpc/methods/skills.js";
import { marketplaceMethods } from "../rpc/methods/marketplace.js";
import { marketplaceService, projectMarketplaceService } from "../marketplace.js";
import { promptMarketplaceService } from "../prompt-marketplace.js";
import {
  createFakeProjectCtx,
  createRpcHarness,
  flush,
  type RpcHarness,
} from "./rpc-test-utils.js";

vi.mock("../marketplace.js", () => ({
  marketplaceService: { getManifest: vi.fn(), downloadZip: vi.fn() },
  projectMarketplaceService: { getManifest: vi.fn(), downloadZip: vi.fn() },
}));

vi.mock("../prompt-marketplace.js", () => ({
  promptMarketplaceService: { getPrompts: vi.fn() },
}));

vi.mock("@spherse/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spherse/core")>();
  return { ...actual, installMarketplaceProjectZip: vi.fn() };
});

const SKILL: SkillDefinition = {
  name: "demo-skill",
  description: "Demo skill",
  instructions: "You demo things.",
  filePath: "/projects/p1/.spherse/skills/demo-skill/SKILL.md",
  source: "project",
  files: ["SKILL.md"],
  version: "1.0.0",
};

const SKILL_MANIFEST: MarketplaceManifestResponse = {
  schemaVersion: 1,
  generatedAt: "2026-11-22T00:00:00Z",
  skills: [
    {
      name: "demo-skill",
      description: "Demo skill",
      version: "1.0.0",
      zipUrl: "https://marketplace.test/spherse/skills/demo-skill-1.0.0.zip",
      size: 1024,
      updatedAt: "2026-11-22T00:00:00Z",
    },
  ],
};

const SKILL_ZIP_PATH = "/tmp/marketplace-skill-test.zip";

const PROJECT_MANIFEST: MarketplaceProjectManifestResponse = {
  schemaVersion: 1,
  generatedAt: "2026-11-22T00:00:00Z",
  projects: [
    {
      name: "demo-world",
      description: "Demo project",
      version: "1.0.0",
      category: "游戏",
      zipUrl: "https://marketplace.test/spherse/projects/demo-world-1.0.0.zip",
      size: 2048,
      updatedAt: "2026-11-22T00:00:00Z",
    },
  ],
};

const PROJECT_ZIP_PATH = "/tmp/marketplace-project-test.zip";
const PROJECT_ROOT = path.join(os.tmpdir(), "demo-world");

const PROMPT_MANIFEST: MarketplacePromptManifestResponse = {
  schemaVersion: 1,
  generatedAt: "2026-11-22T00:00:00Z",
  language: "en-us",
  prompts: [
    {
      id: "brainstorm",
      title: "Brainstorm",
      description: "Brainstorm ideas",
      category: "creative",
      content: "Brainstorm about {{topic}}",
    },
  ],
};

function createHarness(): RpcHarness {
  const base = createFakeProjectCtx();
  const projectCtx = createFakeProjectCtx({
    projectManager: {
      ...base.projectManager,
      listSkills: vi.fn().mockResolvedValue([SKILL]),
      createSkill: vi.fn().mockResolvedValue(SKILL),
      installSkill: vi.fn().mockResolvedValue(SKILL),
    },
  });
  return createRpcHarness({
    methods: { ...skillMethods, ...marketplaceMethods },
    projectCtx,
  });
}

async function waitForFrames(harness: RpcHarness, count = 1): Promise<unknown[]> {
  for (let i = 0; i < 100 && harness.sent().length < count; i += 1) {
    await flush();
  }
  return harness.sent();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(marketplaceService.getManifest).mockResolvedValue(SKILL_MANIFEST);
  vi.mocked(marketplaceService.downloadZip).mockResolvedValue(SKILL_ZIP_PATH);
  vi.mocked(projectMarketplaceService.getManifest).mockResolvedValue(PROJECT_MANIFEST);
  vi.mocked(projectMarketplaceService.downloadZip).mockResolvedValue(PROJECT_ZIP_PATH);
  vi.mocked(promptMarketplaceService.getPrompts).mockResolvedValue(PROMPT_MANIFEST);
  vi.mocked(installMarketplaceProjectZip).mockResolvedValue({
    projectRoot: PROJECT_ROOT,
    folderName: "demo-world",
  });
});

describe("skills rpc methods", () => {
  it("skills.create creates a skill through the project facade", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 1,
      method: "skills.create",
      params: {
        projectId: "p1",
        name: "demo-skill",
        description: "Demo skill",
        instructions: "You demo things.",
      },
    });
    const frames = await waitForFrames(harness);
    expect(harness.known.projectManager.createSkill).toHaveBeenCalledWith(
      "demo-skill",
      "Demo skill",
      "You demo things.",
    );
    expect(frames[0]).toMatchObject({ type: "result", id: 1, ok: true, data: SKILL });
  });

  it("skills.install installs a local zip through the project facade", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 2,
      method: "skills.install",
      params: { projectId: "p1", zipPath: "/local/my-skill.zip" },
    });
    const frames = await waitForFrames(harness);
    expect(harness.known.projectManager.installSkill).toHaveBeenCalledWith("/local/my-skill.zip");
    expect(frames[0]).toMatchObject({ type: "result", id: 2, ok: true, data: SKILL });
  });

  it("skills.list returns summaries without instructions", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 3,
      method: "skills.list",
      params: { projectId: "p1" },
    });
    const frames = await waitForFrames(harness);
    expect(harness.known.projectManager.listSkills).toHaveBeenCalledTimes(1);
    const data = (frames[0] as { data: Array<Record<string, unknown>> }).data;
    expect(data).toHaveLength(1);
    expect(data[0]).not.toHaveProperty("instructions");
    expect(data[0]).toMatchObject({
      name: "demo-skill",
      description: "Demo skill",
      source: "project",
      version: "1.0.0",
    });
  });

  it("skills.installMarketplace downloads and installs with overwrite", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 4,
      method: "skills.installMarketplace",
      params: { projectId: "p1", name: "demo-skill", version: "1.0.0" },
    });
    const frames = await waitForFrames(harness);
    expect(marketplaceService.getManifest).toHaveBeenCalledTimes(1);
    expect(marketplaceService.downloadZip).toHaveBeenCalledWith(SKILL_MANIFEST.skills[0]);
    expect(harness.known.projectManager.installSkill).toHaveBeenCalledWith(SKILL_ZIP_PATH, {
      overwrite: true,
    });
    expect(frames[0]).toMatchObject({ type: "result", id: 4, ok: true, data: SKILL });
  });

  it("skills.installMarketplace rejects a version that no longer matches the manifest", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 5,
      method: "skills.installMarketplace",
      params: { projectId: "p1", name: "demo-skill", version: "0.9.0" },
    });
    const frames = await waitForFrames(harness);
    expect(frames[0]).toMatchObject({
      type: "result",
      id: 5,
      ok: false,
      error: { code: 102, message: "Marketplace manifest has been updated, please refresh and retry" },
    });
    expect(marketplaceService.downloadZip).not.toHaveBeenCalled();
  });
});

describe("marketplace rpc methods", () => {
  it("marketplace.projects returns the project manifest", async () => {
    const harness = createHarness();
    harness.receive({ type: "call", id: 10, method: "marketplace.projects", params: {} });
    const frames = await waitForFrames(harness);
    expect(projectMarketplaceService.getManifest).toHaveBeenCalledTimes(1);
    expect(frames[0]).toMatchObject({
      type: "result",
      id: 10,
      ok: true,
      data: PROJECT_MANIFEST,
    });
  });

  it("marketplace.prompts defaults to en-us and forwards the requested language", async () => {
    const harness = createHarness();
    harness.receive({ type: "call", id: 11, method: "marketplace.prompts", params: {} });
    harness.receive({
      type: "call",
      id: 12,
      method: "marketplace.prompts",
      params: { language: "zh-cn" },
    });
    const frames = await waitForFrames(harness, 2);
    expect(promptMarketplaceService.getPrompts).toHaveBeenCalledTimes(2);
    expect(promptMarketplaceService.getPrompts).toHaveBeenNthCalledWith(1, "en-us");
    expect(promptMarketplaceService.getPrompts).toHaveBeenNthCalledWith(2, "zh-cn");
    expect(frames[0]).toMatchObject({ type: "result", id: 11, ok: true, data: PROMPT_MANIFEST });
    expect(frames[1]).toMatchObject({ type: "result", id: 12, ok: true, data: PROMPT_MANIFEST });
  });

  it("marketplace.prompts rejects an invalid language with invalid params", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 13,
      method: "marketplace.prompts",
      params: { language: "not a language" },
    });
    const frames = await waitForFrames(harness);
    expect(frames[0]).toMatchObject({
      type: "result",
      id: 13,
      ok: false,
      error: { code: -32602 },
    });
    expect(promptMarketplaceService.getPrompts).not.toHaveBeenCalled();
  });

  it("marketplace.installProject installs the downloaded zip into destDir", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 14,
      method: "marketplace.installProject",
      params: { name: "demo-world", version: "1.0.0", destDir: os.tmpdir() },
    });
    const frames = await waitForFrames(harness);
    expect(projectMarketplaceService.downloadZip).toHaveBeenCalledWith(PROJECT_MANIFEST.projects[0]);
    expect(installMarketplaceProjectZip).toHaveBeenCalledWith(PROJECT_ZIP_PATH, os.tmpdir());
    expect(frames[0]).toMatchObject({
      type: "result",
      id: 14,
      ok: true,
      data: { projectRoot: PROJECT_ROOT },
    });
  });

  it("marketplace.installProject maps an unknown project to app error 100", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 15,
      method: "marketplace.installProject",
      params: { name: "missing", version: "1.0.0", destDir: os.tmpdir() },
    });
    const frames = await waitForFrames(harness);
    expect(frames[0]).toMatchObject({
      type: "result",
      id: 15,
      ok: false,
      error: {
        code: 100,
        message: 'Project "missing" is not available in the marketplace',
      },
    });
    expect(projectMarketplaceService.downloadZip).not.toHaveBeenCalled();
    expect(installMarketplaceProjectZip).not.toHaveBeenCalled();
  });

  it("marketplace.installProject maps a version mismatch to app error 102", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 16,
      method: "marketplace.installProject",
      params: { name: "demo-world", version: "0.9.0", destDir: os.tmpdir() },
    });
    const frames = await waitForFrames(harness);
    expect(frames[0]).toMatchObject({
      type: "result",
      id: 16,
      ok: false,
      error: { code: 102 },
    });
    expect(installMarketplaceProjectZip).not.toHaveBeenCalled();
  });

  it("marketplace.installProject rejects a relative destDir with invalid params", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 17,
      method: "marketplace.installProject",
      params: { name: "demo-world", version: "1.0.0", destDir: "relative/path" },
    });
    const frames = await waitForFrames(harness);
    expect(frames[0]).toMatchObject({
      type: "result",
      id: 17,
      ok: false,
      error: { code: -32602, message: "destDir must be an absolute path" },
    });
    expect(projectMarketplaceService.downloadZip).not.toHaveBeenCalled();
  });
});

describe("skills and marketplace param validation", () => {
  it("rejects skills.create with missing required fields", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 20,
      method: "skills.create",
      params: { projectId: "p1", name: "demo-skill" },
    });
    const frames = await waitForFrames(harness);
    expect(frames[0]).toMatchObject({
      type: "result",
      id: 20,
      ok: false,
      error: { code: -32602, message: "Invalid params for skills.create" },
    });
    expect(harness.known.projectManager.createSkill).not.toHaveBeenCalled();
  });

  it("rejects skills.installMarketplace with unknown extra params", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 21,
      method: "skills.installMarketplace",
      params: { projectId: "p1", name: "demo-skill", version: "1.0.0", extra: true },
    });
    const frames = await waitForFrames(harness);
    expect(frames[0]).toMatchObject({
      type: "result",
      id: 21,
      ok: false,
      error: { code: -32602 },
    });
    expect(marketplaceService.getManifest).not.toHaveBeenCalled();
  });

  it("maps an unknown project to app error 100", async () => {
    const harness = createHarness();
    harness.receive({
      type: "call",
      id: 22,
      method: "skills.list",
      params: { projectId: "missing" },
    });
    const frames = await waitForFrames(harness);
    expect(frames[0]).toMatchObject({
      type: "result",
      id: 22,
      ok: false,
      error: { code: 100, message: "Unknown project" },
    });
  });
});
