import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import AdmZip from "adm-zip";
import { createProject, type ProjectRuntime, type Logger } from "@spherse/core";
import { registerMarketplaceRoutes } from "../routes/marketplace.js";
import { createMarketplaceService } from "../marketplace.js";
import { setAppVersion } from "../server-info.js";
import type { ProjectRegistry } from "../registry.js";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

const MANIFEST_URL = "https://marketplace.test/spherse/skills/manifest.json";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function buildSkillZip(name: string, description: string, version?: string): Buffer {
  const frontmatter = version
    ? `---\nname: ${name}\ndescription: ${description}\nversion: ${version}\n---\n\nBody.\n`
    : `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`;
  const zip = new AdmZip();
  zip.addFile(`${name}/`, Buffer.alloc(0));
  zip.addFile(`${name}/SKILL.md`, Buffer.from(frontmatter, "utf-8"));
  return zip.toBuffer();
}

function makeManifest(skills: Array<Record<string, unknown>>): unknown {
  return { schemaVersion: 1, generatedAt: "2026-08-24T00:00:00Z", skills };
}

function makeStubFetch(manifest: unknown, zips: Record<string, Buffer>): FetchLike {
  return async (url: string) => {
    if (url === MANIFEST_URL) {
      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const buf = zips[url];
    if (buf) return new Response(new Uint8Array(buf), { status: 200 });
    return new Response("not found", { status: 404 });
  };
}

function zipUrlFor(name: string, version: string): string {
  return `https://marketplace.test/spherse/skills/${name}/${version}/${name}-${version}.zip`;
}

afterEach(() => {
  setAppVersion(undefined);
});

describe("marketplace routes: manifest proxy with stub fetch", () => {
  let app: FastifyInstance;
  let fetchCalls: string[];

  beforeAll(async () => {
    fetchCalls = [];
    const manifest = makeManifest([
      { name: "demo", description: "Demo skill", version: "1.0.0", zipUrl: zipUrlFor("demo", "1.0.0"), size: 100, updatedAt: "2026-08-24T00:00:00Z" },
    ]);
    const service = createMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 60_000,
      fetchFn: async (url, init) => {
        fetchCalls.push(url);
        return makeStubFetch(manifest, {})(url, init);
      },
    });
    app = Fastify();
    registerMarketplaceRoutes(app, {} as ProjectRegistry, { marketplace: service });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the manifest and caches it within the ttl", async () => {
    const res1 = await app.inject({ method: "GET", url: "/api/projects/p1/marketplace/skills" });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.schemaVersion).toBe(1);
    expect(body1.skills).toHaveLength(1);
    expect(body1.skills[0].name).toBe("demo");

    const res2 = await app.inject({ method: "GET", url: "/api/projects/p1/marketplace/skills" });
    expect(res2.statusCode).toBe(200);
    expect(fetchCalls).toHaveLength(1);
  });

  it("sends the marketplace user agent on manifest and zip requests", async () => {
    setAppVersion("1.2.3");
    const seen: Array<{ url: string; userAgent: string }> = [];
    const manifest = makeManifest([
      { name: "demo", description: "Demo skill", version: "1.0.0", zipUrl: zipUrlFor("demo", "1.0.0"), size: 100, updatedAt: "2026-08-24T00:00:00Z" },
    ]);
    const stubFetch = async (url: string, init?: RequestInit) => {
      seen.push({ url, userAgent: String((init?.headers as Record<string, string>)?.["User-Agent"] ?? "") });
      return makeStubFetch(manifest, {
        [zipUrlFor("demo", "1.0.0")]: buildSkillZip("demo", "Demo skill", "1.0.0"),
      })(url, init);
    };
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-marketplace-ua-"));
    const runtime = await createProject(tmpDir, { projectName: "UA", logger: silentLogger });
    const service = createMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 60_000,
      fetchFn: stubFetch,
    });
    const uaApp = Fastify();
    uaApp.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: runtime.projectManager };
    });
    registerMarketplaceRoutes(uaApp, {} as ProjectRegistry, { marketplace: service });
    await uaApp.ready();

    const list = await uaApp.inject({ method: "GET", url: "/api/projects/p1/marketplace/skills" });
    expect(list.statusCode).toBe(200);
    const install = await uaApp.inject({
      method: "POST",
      url: "/api/projects/p1/skills/marketplace-install",
      payload: { name: "demo", version: "1.0.0" },
    });
    expect(install.statusCode).toBe(200);
    expect(seen).toHaveLength(2);
    for (const call of seen) {
      expect(call.userAgent).toMatch(/^spherse-marketplace\/1\.2\.3 \((darwin|linux|win32|freebsd|openbsd|sunos|aix) [^)]+\)$/);
    }

    await uaApp.close();
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("responds 502 when the manifest is invalid against the contract", async () => {
    const badService = createMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 0,
      fetchFn: makeStubFetch({ schemaVersion: 1, generatedAt: "x", skills: [{}] }, {}),
    });
    const badApp = Fastify();
    registerMarketplaceRoutes(badApp, {} as ProjectRegistry, { marketplace: badService });
    await badApp.ready();
    const res = await badApp.inject({ method: "GET", url: "/api/projects/p1/marketplace/skills" });
    expect(res.statusCode).toBe(502);
    await badApp.close();
  });

  it("responds 502 when the manifest host is unreachable", async () => {
    const downService = createMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 0,
      fetchFn: async () => {
        throw new Error("network down");
      },
    });
    const downApp = Fastify();
    registerMarketplaceRoutes(downApp, {} as ProjectRegistry, { marketplace: downService });
    await downApp.ready();
    const res = await downApp.inject({ method: "GET", url: "/api/projects/p1/marketplace/skills" });
    expect(res.statusCode).toBe(502);
    await downApp.close();
  });
});

describe("marketplace routes: install with real ProjectManager (write facade contract)", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;
  let app: FastifyInstance;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-marketplace-contract-"));
    runtime = await createProject(tmpDir, { projectName: "Marketplace", logger: silentLogger });
    const pm = runtime.projectManager;

    const manifest = makeManifest([
      { name: "demo", description: "Demo skill", version: "1.0.0", zipUrl: zipUrlFor("demo", "1.0.0"), size: 100, updatedAt: "2026-08-24T00:00:00Z" },
      { name: "evil", description: "Evil skill", version: "1.0.0", zipUrl: "https://evil.test/evil-1.0.0.zip", size: 100, updatedAt: "2026-08-24T00:00:00Z" },
    ]);
    const service = createMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 60_000,
      fetchFn: makeStubFetch(manifest, {
        [zipUrlFor("demo", "1.0.0")]: buildSkillZip("demo", "Demo skill", "1.0.0"),
        [zipUrlFor("demo", "2.0.0")]: buildSkillZip("demo", "Demo skill v2", "2.0.0"),
      }),
    });

    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: pm };
    });
    registerMarketplaceRoutes(app, {} as ProjectRegistry, { marketplace: service });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("installs a marketplace skill onto disk through the real facade", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/skills/marketplace-install",
      payload: { name: "demo", version: "1.0.0" },
    });
    expect(res.statusCode).toBe(200);
    const skill = res.json();
    expect(skill.name).toBe("demo");
    expect(skill.source).toBe("project");
    expect(skill.version).toBe("1.0.0");
    expect(fs.readFileSync(path.join(tmpDir, ".spherse/skills/demo/SKILL.md"), "utf-8")).toContain("name: demo");
  });

  it("overwrites an installed skill via marketplace update", async () => {
    const manifest2 = makeManifest([
      { name: "demo", description: "Demo skill", version: "2.0.0", zipUrl: zipUrlFor("demo", "2.0.0"), size: 120, updatedAt: "2026-08-24T01:00:00Z" },
    ]);
    const service2 = createMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 60_000,
      fetchFn: makeStubFetch(manifest2, {
        [zipUrlFor("demo", "2.0.0")]: buildSkillZip("demo", "Demo skill v2", "2.0.0"),
      }),
    });
    const app2 = Fastify();
    app2.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: runtime.projectManager };
    });
    registerMarketplaceRoutes(app2, {} as ProjectRegistry, { marketplace: service2 });
    await app2.ready();

    const res = await app2.inject({
      method: "POST",
      url: "/api/projects/p1/skills/marketplace-install",
      payload: { name: "demo", version: "2.0.0" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe("2.0.0");
    expect(res.json().description).toBe("Demo skill v2");
    await app2.close();
  });

  it("responds 404 for an unknown marketplace skill", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/skills/marketplace-install",
      payload: { name: "missing", version: "1.0.0" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("responds 409 when the requested version no longer matches the manifest", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/skills/marketplace-install",
      payload: { name: "demo", version: "0.9.0" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("responds 502 when the zip url points to a different origin (SSRF guard)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/skills/marketplace-install",
      payload: { name: "evil", version: "1.0.0" },
    });
    expect(res.statusCode).toBe(502);
  });

  it("responds 502 and leaves no tmp zip when the zip download fails", async () => {
    const tmpBefore = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("marketplace-skill-"));
    const service = createMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 60_000,
      fetchFn: async (url: string) => {
        if (url === MANIFEST_URL) {
          return new Response(JSON.stringify(makeManifest([
            { name: "demo", description: "Demo skill", version: "1.0.0", zipUrl: zipUrlFor("demo", "1.0.0"), size: 100, updatedAt: "2026-08-24T00:00:00Z" },
          ])), { status: 200 });
        }
        return new Response("boom", { status: 500 });
      },
    });
    const failApp = Fastify();
    failApp.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: runtime.projectManager };
    });
    registerMarketplaceRoutes(failApp, {} as ProjectRegistry, { marketplace: service });
    await failApp.ready();

    const res = await failApp.inject({
      method: "POST",
      url: "/api/projects/p1/skills/marketplace-install",
      payload: { name: "demo", version: "1.0.0" },
    });
    expect(res.statusCode).toBe(502);
    const tmpAfter = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("marketplace-skill-"));
    expect(tmpAfter.length).toBe(tmpBefore.length);
    await failApp.close();
  });

  it("refetches the manifest after the cache ttl expires", async () => {
    let fetchCount = 0;
    const service = createMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 0,
      fetchFn: async () => {
        fetchCount++;
        return new Response(
          JSON.stringify(makeManifest([
            { name: "demo", description: "Demo skill", version: "1.0.0", zipUrl: zipUrlFor("demo", "1.0.0"), size: 100, updatedAt: "2026-08-24T00:00:00Z" },
          ])),
          { status: 200 },
        );
      },
    });
    await service.getManifest();
    await service.getManifest();
    expect(fetchCount).toBe(2);
  });

  it("shares a single in-flight manifest fetch across concurrent callers", async () => {
    let fetchCount = 0;
    const service = createMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 60_000,
      fetchFn: async () => {
        fetchCount++;
        await new Promise((r) => setTimeout(r, 20));
        return new Response(
          JSON.stringify(makeManifest([
            { name: "demo", description: "Demo skill", version: "1.0.0", zipUrl: zipUrlFor("demo", "1.0.0"), size: 100, updatedAt: "2026-08-24T00:00:00Z" },
          ])),
          { status: 200 },
        );
      },
    });
    const [a, b] = await Promise.all([service.getManifest(), service.getManifest()]);
    expect(fetchCount).toBe(1);
    expect(a.skills[0].name).toBe("demo");
    expect(b.skills[0].name).toBe("demo");
  });

  it("responds 502 when the zip response redirects (SSRF redirect guard)", async () => {
    const service = createMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 60_000,
      fetchFn: async (url: string) => {
        if (url === MANIFEST_URL) {
          return new Response(JSON.stringify(makeManifest([
            { name: "demo", description: "Demo skill", version: "1.0.0", zipUrl: zipUrlFor("demo", "1.0.0"), size: 100, updatedAt: "2026-08-24T00:00:00Z" },
          ])), { status: 200 });
        }
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.252/latest/meta-data/" } });
      },
    });
    const redirectApp = Fastify();
    redirectApp.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { projectManager: runtime.projectManager };
    });
    registerMarketplaceRoutes(redirectApp, {} as ProjectRegistry, { marketplace: service });
    await redirectApp.ready();

    const res = await redirectApp.inject({
      method: "POST",
      url: "/api/projects/p1/skills/marketplace-install",
      payload: { name: "demo", version: "1.0.0" },
    });
    expect(res.statusCode).toBe(502);
    await redirectApp.close();
  });
});
