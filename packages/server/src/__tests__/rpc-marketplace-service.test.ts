import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { setAppVersion } from "../server-info.js";
import { callMethod, type RpcHarness } from "@spherse/rpc/testing";
import {
  SKILL_MANIFEST_URL,
  buildSkillZip,
  countTmpZips,
  createHarness,
  createRealProjectHarness,
  disposeRealProject,
  projectDir,
  recordingFetch,
  skillEntry,
  skillManifest,
  skillService,
  stubFetch,
  useSkillService,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("skills marketplace service through rpc", () => {
  let harness: RpcHarness;
  const DEMO = skillEntry("demo", "Demo skill", "1.0.0");
  const urls = (calls: FetchCall[]): string[] => calls.map((call) => call.url);

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(() => {
    setAppVersion(undefined);
  });

  it("skills.listMarketplace returns the manifest and caches it within the ttl", async () => {
    const calls: FetchCall[] = [];
    useSkillService(
      skillService(
        recordingFetch(stubFetch({ json: { [SKILL_MANIFEST_URL]: skillManifest([DEMO]) } }), calls),
      ),
    );
    const first = await callMethod(harness, "skills.listMarketplace", { projectId: "p1" });
    const second = await callMethod(harness, "skills.listMarketplace", { projectId: "p1" });
    expect(first).toMatchObject({ type: "result", ok: true, data: skillManifest([DEMO]) });
    expect(second).toMatchObject({ type: "result", ok: true, data: skillManifest([DEMO]) });
    expect(urls(calls)).toEqual([SKILL_MANIFEST_URL]);
  });

  it("sends the marketplace user agent on manifest and zip requests", async () => {
    setAppVersion("1.2.3");
    const calls: FetchCall[] = [];
    useSkillService(
      skillService(
        recordingFetch(
          stubFetch({
            json: { [SKILL_MANIFEST_URL]: skillManifest([DEMO]) },
            zips: { [DEMO.zipUrl]: buildSkillZip("demo", "Demo skill", "1.0.0") },
          }),
          calls,
        ),
      ),
    );
    const list = await callMethod(harness, "skills.listMarketplace", { projectId: "p1" });
    const install = await callMethod(harness, "skills.installMarketplace", {
      projectId: "p1",
      name: "demo",
      version: "1.0.0",
    });
    expect(list).toMatchObject({ type: "result", ok: true });
    expect(install).toMatchObject({ type: "result", ok: true });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.userAgent).toMatch(
        /^spherse-marketplace\/1\.2\.3 \((darwin|linux|win32|freebsd|openbsd|sunos|aix) [^)]+\)$/,
      );
    }
  });

  it("skills.listMarketplace maps a manifest that violates the contract to internal error", async () => {
    useSkillService(
      skillService(
        stubFetch({
          json: { [SKILL_MANIFEST_URL]: { schemaVersion: 1, generatedAt: "x", skills: [{}] } },
        }),
        0,
      ),
    );
    const frame = await callMethod(harness, "skills.listMarketplace", { projectId: "p1" });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: -32603, message: expect.stringMatching(/^Marketplace manifest is invalid: /) },
    });
  });

  it("skills.listMarketplace maps an unreachable manifest host to internal error", async () => {
    useSkillService(
      skillService(async () => {
        throw new Error("network down");
      }, 0),
    );
    const frame = await callMethod(harness, "skills.listMarketplace", { projectId: "p1" });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: -32603, message: "Marketplace manifest fetch failed: network down" },
    });
  });

  it("skills.listMarketplace refetches the manifest after the cache ttl expires", async () => {
    let fetchCount = 0;
    useSkillService(
      skillService(async () => {
        fetchCount += 1;
        return new Response(JSON.stringify(skillManifest([DEMO])), { status: 200 });
      }, 0),
    );
    await callMethod(harness, "skills.listMarketplace", { projectId: "p1" });
    await callMethod(harness, "skills.listMarketplace", { projectId: "p1" });
    expect(fetchCount).toBe(2);
  });

  it("skills.listMarketplace shares a single in-flight manifest fetch across concurrent callers", async () => {
    let fetchCount = 0;
    let release: () => void = () => {};
    useSkillService(
      skillService(async () => {
        fetchCount += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new Response(JSON.stringify(skillManifest([DEMO])), { status: 200 });
      }),
    );
    const first = callMethod(harness, "skills.listMarketplace", { projectId: "p1" });
    const second = callMethod(harness, "skills.listMarketplace", { projectId: "p1" });
    release();
    const frames = await Promise.all([first, second]);
    expect(fetchCount).toBe(1);
    for (const frame of frames) {
      expect(frame).toMatchObject({ ok: true, data: { skills: [{ name: "demo" }] } });
    }
  });

  it("skills.installMarketplace maps a cross-origin zip url to internal error", async () => {
    useSkillService(
      skillService(
        stubFetch({
          json: {
            [SKILL_MANIFEST_URL]: skillManifest([
              skillEntry("evil", "Evil skill", "1.0.0", "https://evil.test/evil-1.0.0.zip"),
            ]),
          },
        }),
      ),
    );
    const frame = await callMethod(harness, "skills.installMarketplace", {
      projectId: "p1",
      name: "evil",
      version: "1.0.0",
    });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: -32603, message: "Marketplace zip URL origin mismatch: https://evil.test" },
    });
    expect(harness.known.projectManager.installSkill).not.toHaveBeenCalled();
  });

  it("skills.installMarketplace maps a redirecting zip response to internal error", async () => {
    useSkillService(
      skillService(async (url) =>
        url === SKILL_MANIFEST_URL
          ? new Response(JSON.stringify(skillManifest([DEMO])), { status: 200 })
          : new Response(null, {
              status: 302,
              headers: { location: "http://169.254.169.252/latest/meta-data/" },
            }),
      ),
    );
    const frame = await callMethod(harness, "skills.installMarketplace", {
      projectId: "p1",
      name: "demo",
      version: "1.0.0",
    });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: -32603, message: "Marketplace zip download failed: HTTP 302" },
    });
    expect(harness.known.projectManager.installSkill).not.toHaveBeenCalled();
  });

  it("skills.installMarketplace leaves no tmp zip behind when the zip download fails", async () => {
    const before = countTmpZips("marketplace-skill-");
    useSkillService(
      skillService(async (url) =>
        url === SKILL_MANIFEST_URL
          ? new Response(JSON.stringify(skillManifest([DEMO])), { status: 200 })
          : new Response("boom", { status: 500 }),
      ),
    );
    const frame = await callMethod(harness, "skills.installMarketplace", {
      projectId: "p1",
      name: "demo",
      version: "1.0.0",
    });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: -32603, message: "Marketplace zip download failed: HTTP 500" },
    });
    expect(countTmpZips("marketplace-skill-")).toBe(before);
    expect(harness.known.projectManager.installSkill).not.toHaveBeenCalled();
  });
});

describe("skills.installMarketplace through the real project facade", () => {
  let harness: RpcHarness;
  const DEMO_V1 = skillEntry("demo", "Demo skill", "1.0.0");
  const DEMO_V2 = skillEntry("demo", "Demo skill", "2.0.0");

  beforeEach(async () => {
    harness = await createRealProjectHarness();
  });

  afterEach(async () => {
    await disposeRealProject();
  });

  it("installs a marketplace skill onto disk and removes the tmp zip", async () => {
    const before = countTmpZips("marketplace-skill-");
    useSkillService(
      skillService(
        stubFetch({
          json: { [SKILL_MANIFEST_URL]: skillManifest([DEMO_V1]) },
          zips: { [DEMO_V1.zipUrl]: buildSkillZip("demo", "Demo skill", "1.0.0") },
        }),
      ),
    );
    const frame = await callMethod(harness, "skills.installMarketplace", {
      projectId: "p1",
      name: "demo",
      version: "1.0.0",
    });
    expect(frame).toMatchObject({
      type: "result",
      ok: true,
      data: { name: "demo", source: "project", version: "1.0.0" },
    });
    expect(
      fs.readFileSync(path.join(projectDir, ".spherse/skills/demo/SKILL.md"), "utf-8"),
    ).toContain("name: demo");
    expect(countTmpZips("marketplace-skill-")).toBe(before);
  });

  it("overwrites an installed skill via marketplace update", async () => {
    useSkillService(
      skillService(
        stubFetch({
          json: { [SKILL_MANIFEST_URL]: skillManifest([DEMO_V1]) },
          zips: { [DEMO_V1.zipUrl]: buildSkillZip("demo", "Demo skill", "1.0.0") },
        }),
      ),
    );
    const first = await callMethod(harness, "skills.installMarketplace", {
      projectId: "p1",
      name: "demo",
      version: "1.0.0",
    });
    expect(first).toMatchObject({ type: "result", ok: true, data: { version: "1.0.0" } });

    useSkillService(
      skillService(
        stubFetch({
          json: { [SKILL_MANIFEST_URL]: skillManifest([DEMO_V2]) },
          zips: { [DEMO_V2.zipUrl]: buildSkillZip("demo", "Demo skill v2", "2.0.0") },
        }),
      ),
    );
    const second = await callMethod(harness, "skills.installMarketplace", {
      projectId: "p1",
      name: "demo",
      version: "2.0.0",
    });
    expect(second).toMatchObject({
      type: "result",
      ok: true,
      data: { version: "2.0.0", description: "Demo skill v2" },
    });
  });
});
