import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installMarketplaceProjectZip } from "@spherse/core";
import { callMethod, type RpcHarness } from "@spherse/rpc/testing";
import {
  PROJECT_MANIFEST_URL,
  buildProjectZip,
  countTmpZips,
  createHarness,
  projectEntry,
  projectManifest,
  projectService,
  recordingFetch,
  stubFetch,
  useProjectService,
  useRealProjectInstall,
  type FetchCall,
} from "./rpc-marketplace-testing.js";

vi.mock("../marketplace.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../marketplace.js")>();
  return {
    ...actual,
    marketplaceService: { getManifest: vi.fn(), downloadZip: vi.fn() },
    projectMarketplaceService: { getManifest: vi.fn(), downloadZip: vi.fn() },
  };
});

vi.mock("@spherse/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spherse/core")>();
  return { ...actual, installMarketplaceProjectZip: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("project marketplace service through rpc", () => {
  let harness: RpcHarness;
  let destDir: string;
  const DEMO_WORLD = projectEntry("demo-world", "Demo project");
  const EVIL_WORLD = projectEntry("evil-world", "Evil project", "https://evil.test/evil-world-1.0.0.zip");

  beforeEach(() => {
    harness = createHarness();
    destDir = fs.mkdtempSync(path.join(os.tmpdir(), "rpc-marketplace-dest-"));
  });

  afterEach(() => {
    fs.rmSync(destDir, { recursive: true, force: true });
  });

  it("marketplace.projects returns the manifest and caches it within the ttl", async () => {
    const calls: FetchCall[] = [];
    useProjectService(
      projectService(
        recordingFetch(
          stubFetch({
            json: { [PROJECT_MANIFEST_URL]: projectManifest([DEMO_WORLD, EVIL_WORLD]) },
          }),
          calls,
        ),
      ),
    );
    const first = await callMethod(harness, "marketplace.projects", {});
    const second = await callMethod(harness, "marketplace.projects", {});
    expect(first).toMatchObject({
      type: "result",
      ok: true,
      data: {
        schemaVersion: 1,
        projects: [{ name: "demo-world", category: "游戏" }, { name: "evil-world" }],
      },
    });
    expect(second).toMatchObject({ type: "result", ok: true });
    expect(calls.map((call) => call.url)).toEqual([PROJECT_MANIFEST_URL]);
  });

  it("marketplace.projects maps a manifest that violates the contract to internal error", async () => {
    useProjectService(
      projectService(
        stubFetch({
          json: { [PROJECT_MANIFEST_URL]: { schemaVersion: 1, generatedAt: "x", projects: [{}] } },
        }),
        0,
      ),
    );
    const frame = await callMethod(harness, "marketplace.projects", {});
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: -32603, message: expect.stringMatching(/^Marketplace manifest is invalid: /) },
    });
  });

  it("marketplace.projects maps an unreachable manifest host to internal error", async () => {
    useProjectService(
      projectService(async () => {
        throw new Error("network down");
      }, 0),
    );
    const frame = await callMethod(harness, "marketplace.projects", {});
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: -32603, message: "Marketplace manifest fetch failed: network down" },
    });
  });

  it("marketplace.installProject maps a cross-origin zip url to internal error", async () => {
    useProjectService(
      projectService(
        stubFetch({
          json: { [PROJECT_MANIFEST_URL]: projectManifest([DEMO_WORLD, EVIL_WORLD]) },
        }),
      ),
    );
    const frame = await callMethod(harness, "marketplace.installProject", {
      name: "evil-world",
      version: "1.0.0",
      destDir,
    });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: -32603, message: "Marketplace zip URL origin mismatch: https://evil.test" },
    });
    expect(installMarketplaceProjectZip).not.toHaveBeenCalled();
  });

  it("marketplace.installProject installs a marketplace project onto disk through the real core facade", async () => {
    await useRealProjectInstall();
    useProjectService(
      projectService(
        stubFetch({
          json: { [PROJECT_MANIFEST_URL]: projectManifest([DEMO_WORLD]) },
          zips: {
            [DEMO_WORLD.zipUrl]: buildProjectZip("demo-world", {
              "readme.md": "hello",
              "data/scene.json": "{}",
            }),
          },
        }),
      ),
    );
    const frame = await callMethod(harness, "marketplace.installProject", {
      name: "demo-world",
      version: "1.0.0",
      destDir,
    });
    expect(frame).toMatchObject({
      type: "result",
      ok: true,
      data: { projectRoot: path.join(destDir, "demo-world") },
    });
    expect(fs.readFileSync(path.join(destDir, "demo-world/readme.md"), "utf-8")).toBe("hello");
    expect(fs.existsSync(path.join(destDir, "demo-world/data/scene.json"))).toBe(true);
    expect(fs.existsSync(path.join(destDir, "demo-world/meta.json"))).toBe(false);
  });

  it("marketplace.installProject leaves no tmp zip behind when the install succeeds or the download fails", async () => {
    await useRealProjectInstall();
    const before = countTmpZips("marketplace-project-");
    useProjectService(
      projectService(
        stubFetch({
          json: { [PROJECT_MANIFEST_URL]: projectManifest([DEMO_WORLD]) },
          zips: { [DEMO_WORLD.zipUrl]: buildProjectZip("demo-world", { "readme.md": "hello" }) },
        }),
      ),
    );
    const installed = await callMethod(harness, "marketplace.installProject", {
      name: "demo-world",
      version: "1.0.0",
      destDir,
    });
    expect(installed).toMatchObject({ type: "result", ok: true });

    useProjectService(
      projectService(async (url) =>
        url === PROJECT_MANIFEST_URL
          ? new Response(JSON.stringify(projectManifest([DEMO_WORLD])), { status: 200 })
          : new Response("boom", { status: 500 }),
      ),
    );
    const failed = await callMethod(harness, "marketplace.installProject", {
      name: "demo-world",
      version: "1.0.0",
      destDir,
    });
    expect(failed).toMatchObject({
      type: "result",
      ok: false,
      error: { code: -32603, message: "Marketplace zip download failed: HTTP 500" },
    });
    expect(countTmpZips("marketplace-project-")).toBe(before);
  });
});
