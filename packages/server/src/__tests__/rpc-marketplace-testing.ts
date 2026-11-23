import { vi } from "vitest";
import AdmZip from "adm-zip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, installMarketplaceProjectZip, type ProjectRuntime } from "@spherse/core";
import type {
  MarketplaceManifestResponse,
  MarketplaceProjectEntry,
  MarketplaceProjectManifestResponse,
  MarketplacePromptEntry,
  MarketplacePromptManifestResponse,
  MarketplaceSkillEntry,
  SkillDefinitionContract,
} from "@spherse/contracts";
import { skillMethods } from "../rpc/methods/skills.js";
import { marketplaceMethods } from "../rpc/methods/marketplace.js";
import {
  createMarketplaceService,
  createProjectMarketplaceService,
  marketplaceService,
  projectMarketplaceService,
} from "../marketplace.js";
import { createPromptMarketplaceService, promptMarketplaceService } from "../prompt-marketplace.js";
import {
  createFakeProjectCtx,
  createRpcHarness,
  flush,
  type FakeRpcProjectContext,
  type RpcHarness,
} from "@spherse/rpc/testing";
import { createSilentLoggerForTests } from "./test-logger.js";

export const SKILL: SkillDefinitionContract = {
  name: "demo-skill",
  description: "Demo skill",
  instructions: "You demo things.",
  filePath: "/projects/p1/.spherse/skills/demo-skill/SKILL.md",
  source: "project",
  files: ["SKILL.md"],
  version: "1.0.0",
};

export const SKILL_MANIFEST: MarketplaceManifestResponse = {
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

export const SKILL_ZIP_PATH = "/tmp/marketplace-skill-test.zip";

export const PROJECT_MANIFEST: MarketplaceProjectManifestResponse = {
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

export const PROJECT_ZIP_PATH = "/tmp/marketplace-project-test.zip";
export const PROJECT_ROOT = path.join(os.tmpdir(), "demo-world");

export const PROMPT_MANIFEST: MarketplacePromptManifestResponse = {
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

export const SKILL_MANIFEST_URL = "https://marketplace.test/spherse/skills/manifest.json";
export const PROJECT_MANIFEST_URL = "https://marketplace.test/spherse/projects/manifest.json";
const PROMPTS_BASE_URL = "https://prompts.test/spherse/prompts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetchCall {
  url: string;
  userAgent: string;
}

interface StubOptions {
  json?: Record<string, unknown>;
  zips?: Record<string, Buffer>;
  statuses?: Record<string, number>;
  bodies?: Record<string, string>;
}

export function stubFetch(options: StubOptions): FetchLike {
  return async (url) => {
    const status = options.statuses?.[url];
    if (status !== undefined) return new Response(options.bodies?.[url] ?? "error", { status });
    const json = options.json?.[url];
    if (json !== undefined) {
      return new Response(JSON.stringify(json), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const zip = options.zips?.[url];
    if (zip) return new Response(new Uint8Array(zip), { status: 200 });
    return new Response("not found", { status: 404 });
  };
}

export function recordingFetch(fetchFn: FetchLike, calls: FetchCall[]): FetchLike {
  return async (url, init) => {
    calls.push({
      url,
      userAgent: String((init?.headers as Record<string, string> | undefined)?.["User-Agent"] ?? ""),
    });
    return fetchFn(url, init);
  };
}

const skillZipUrl = (name: string, version: string): string =>
  `https://marketplace.test/spherse/skills/${name}/${version}/${name}-${version}.zip`;
const projectZipUrl = (name: string, version: string): string =>
  `https://marketplace.test/spherse/projects/${name}/${version}/${name}-${version}.zip`;
export const promptUrl = (language: string): string => `${PROMPTS_BASE_URL}/${language}.json`;

export function buildSkillZip(name: string, description: string, version?: string): Buffer {
  const frontmatter = version
    ? `---\nname: ${name}\ndescription: ${description}\nversion: ${version}\n---\n\nBody.\n`
    : `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`;
  const zip = new AdmZip();
  zip.addFile(`${name}/`, Buffer.alloc(0));
  zip.addFile(`${name}/SKILL.md`, Buffer.from(frontmatter, "utf-8"));
  return zip.toBuffer();
}

export function buildProjectZip(name: string, files: Record<string, string> = {}): Buffer {
  const zip = new AdmZip();
  zip.addFile(`${name}/`, Buffer.alloc(0));
  for (const [rel, content] of Object.entries(files)) {
    zip.addFile(`${name}/${rel}`, Buffer.from(content, "utf-8"));
  }
  return zip.toBuffer();
}

export function skillEntry(
  name: string,
  description: string,
  version: string,
  zipUrl: string = skillZipUrl(name, version),
): MarketplaceSkillEntry {
  return { name, description, version, zipUrl, size: 100, updatedAt: "2026-08-24T00:00:00Z" };
}

export function skillManifest(skills: MarketplaceSkillEntry[]): MarketplaceManifestResponse {
  return { schemaVersion: 1, generatedAt: "2026-08-24T00:00:00Z", skills };
}

export function projectEntry(
  name: string,
  description: string,
  zipUrl: string = projectZipUrl(name, "1.0.0"),
): MarketplaceProjectEntry {
  return {
    name,
    description,
    version: "1.0.0",
    category: "游戏",
    zipUrl,
    size: 100,
    updatedAt: "2026-09-19T00:00:00Z",
  };
}

export function projectManifest(projects: MarketplaceProjectEntry[]): MarketplaceProjectManifestResponse {
  return { schemaVersion: 1, generatedAt: "2026-09-19T00:00:00Z", projects };
}

export function promptEntry(id: string, title: string): MarketplacePromptEntry {
  return { id, title, description: `${title} description`, category: "创作", content: `${title} content` };
}

export function promptManifest(
  language: string,
  prompts: MarketplacePromptEntry[],
): MarketplacePromptManifestResponse {
  return { schemaVersion: 1, generatedAt: "2026-10-11T00:00:00Z", language, prompts };
}

export function skillService(fetchFn: FetchLike, cacheTtlMs = 60_000) {
  return createMarketplaceService({ manifestUrl: SKILL_MANIFEST_URL, cacheTtlMs, fetchFn });
}

export function projectService(fetchFn: FetchLike, cacheTtlMs = 60_000) {
  return createProjectMarketplaceService({ manifestUrl: PROJECT_MANIFEST_URL, cacheTtlMs, fetchFn });
}

export function promptService(fetchFn: FetchLike, cacheTtlMs = 60_000) {
  return createPromptMarketplaceService({ baseUrl: PROMPTS_BASE_URL, cacheTtlMs, fetchFn });
}

export function useSkillService(service: ReturnType<typeof skillService>) {
  vi.mocked(marketplaceService.getManifest).mockImplementation(() => service.getManifest());
  vi.mocked(marketplaceService.downloadZip).mockImplementation((entry) => service.downloadZip(entry));
}

export function useProjectService(service: ReturnType<typeof projectService>) {
  vi.mocked(projectMarketplaceService.getManifest).mockImplementation(() => service.getManifest());
  vi.mocked(projectMarketplaceService.downloadZip).mockImplementation((entry) => service.downloadZip(entry));
}

export function usePromptService(service: ReturnType<typeof promptService>) {
  vi.mocked(promptMarketplaceService.getPrompts).mockImplementation((language) =>
    service.getPrompts(language),
  );
}

export async function useRealProjectInstall() {
  const actual = await vi.importActual<typeof import("@spherse/core")>("@spherse/core");
  vi.mocked(installMarketplaceProjectZip).mockImplementation(actual.installMarketplaceProjectZip);
}

export const countTmpZips = (prefix: string): number =>
  fs.readdirSync(os.tmpdir()).filter((file) => file.startsWith(prefix)).length;

export let projectDir: string;
let runtime: ProjectRuntime;

export async function createRealProjectHarness(): Promise<RpcHarness> {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "rpc-marketplace-project-"));
  runtime = await createProject(projectDir, {
    projectName: "Marketplace",
    logger: createSilentLoggerForTests(),
  });
  return createRpcHarness({
    methods: { ...skillMethods, ...marketplaceMethods },
    projectCtx: { projectManager: runtime.projectManager } as unknown as ReturnType<
      typeof createFakeProjectCtx
    >,
  });
}

export async function disposeRealProject(): Promise<void> {
  runtime.timerService.stop();
  await runtime.shutdown();
  fs.rmSync(projectDir, { recursive: true, force: true });
}

export function createHarness(): RpcHarness {
  const base = createFakeProjectCtx();
  const projectCtx = createFakeProjectCtx({
    projectManager: {
      ...base.projectManager,
      listSkills: vi.fn().mockResolvedValue([SKILL]),
      createSkill: vi.fn().mockResolvedValue(SKILL),
      installSkill: vi.fn().mockResolvedValue(SKILL),
    },
  } as unknown as FakeRpcProjectContext);
  return createRpcHarness({
    methods: { ...skillMethods, ...marketplaceMethods },
    projectCtx,
  });
}

export async function waitForFrames(harness: RpcHarness, count = 1): Promise<unknown[]> {
  for (let i = 0; i < 100 && harness.sent().length < count; i += 1) {
    await flush();
  }
  for (let i = 0; i < 100 && harness.sent().length < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return harness.sent();
}
