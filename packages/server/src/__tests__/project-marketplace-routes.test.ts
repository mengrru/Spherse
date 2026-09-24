import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import AdmZip from "adm-zip";
import { registerProjectMarketplaceRoutes } from "../routes/project-marketplace.js";
import { createProjectMarketplaceService } from "../marketplace.js";

const MANIFEST_URL = "https://marketplace.test/spherse/projects/manifest.json";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function buildProjectZip(name: string, files: Record<string, string> = {}): Buffer {
  const zip = new AdmZip();
  zip.addFile(`${name}/`, Buffer.alloc(0));
  for (const [rel, content] of Object.entries(files)) {
    zip.addFile(`${name}/${rel}`, Buffer.from(content, "utf-8"));
  }
  return zip.toBuffer();
}

function makeManifest(projects: Array<Record<string, unknown>>): unknown {
  return { schemaVersion: 1, generatedAt: "2026-09-19T00:00:00Z", projects };
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
  return `https://marketplace.test/spherse/projects/${name}/${version}/${name}-${version}.zip`;
}

const manifestEntries = [
  {
    name: "demo-world",
    description: "Demo project",
    version: "1.0.0",
    category: "游戏",
    zipUrl: zipUrlFor("demo-world", "1.0.0"),
    size: 100,
    updatedAt: "2026-09-19T00:00:00Z",
  },
  {
    name: "evil-world",
    description: "Evil project",
    version: "1.0.0",
    category: "游戏",
    zipUrl: "https://evil.test/evil-world-1.0.0.zip",
    size: 100,
    updatedAt: "2026-09-19T00:00:00Z",
  },
];

describe("project marketplace routes (global, no project context)", () => {
  let app: FastifyInstance;
  let destDir: string;
  let fetchCalls: string[];

  beforeAll(async () => {
    fetchCalls = [];
    destDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-project-market-dest-"));
    const service = createProjectMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 60_000,
      fetchFn: async (url, init) => {
        fetchCalls.push(url);
        return makeStubFetch(makeManifest(manifestEntries), {
          [zipUrlFor("demo-world", "1.0.0")]: buildProjectZip("demo-world", {
            "readme.md": "hello",
            "data/scene.json": "{}",
          }),
        })(url, init);
      },
    });
    app = Fastify();
    registerProjectMarketplaceRoutes(app, { projectMarketplace: service });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(destDir, { recursive: true, force: true });
  });

  afterEach(() => {
    for (const entry of fs.readdirSync(destDir)) {
      fs.rmSync(path.join(destDir, entry), { recursive: true, force: true });
    }
  });

  it("returns the manifest on the global route and caches it within the ttl", async () => {
    const res1 = await app.inject({ method: "GET", url: "/api/marketplace/projects" });
    expect(res1.statusCode).toBe(200);
    const body = res1.json();
    expect(body.schemaVersion).toBe(1);
    expect(body.projects).toHaveLength(2);
    expect(body.projects[0].name).toBe("demo-world");
    expect(body.projects[0].category).toBe("游戏");

    const res2 = await app.inject({ method: "GET", url: "/api/marketplace/projects" });
    expect(res2.statusCode).toBe(200);
    expect(fetchCalls).toHaveLength(1);
  });

  it("installs a marketplace project onto disk through the real core facade", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/projects/install",
      payload: { name: "demo-world", version: "1.0.0", destDir },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projectRoot).toBe(path.join(destDir, "demo-world"));
    expect(fs.readFileSync(path.join(destDir, "demo-world/readme.md"), "utf-8")).toBe("hello");
    expect(fs.existsSync(path.join(destDir, "demo-world/data/scene.json"))).toBe(true);
    expect(fs.existsSync(path.join(destDir, "demo-world/meta.json"))).toBe(false);
  });

  it("responds 404 for an unknown marketplace project", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/projects/install",
      payload: { name: "missing", version: "1.0.0", destDir },
    });
    expect(res.statusCode).toBe(404);
  });

  it("responds 409 when the requested version no longer matches the manifest", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/projects/install",
      payload: { name: "demo-world", version: "0.9.0", destDir },
    });
    expect(res.statusCode).toBe(409);
  });

  it("responds 400 for a relative destDir", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/projects/install",
      payload: { name: "demo-world", version: "1.0.0", destDir: "relative/path" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("responds 400 when destDir is not a directory", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/projects/install",
      payload: { name: "demo-world", version: "1.0.0", destDir: path.join(destDir, "missing") },
    });
    expect(res.statusCode).toBe(400);
  });

  it("responds 502 when the zip url points to a different origin (SSRF guard)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/marketplace/projects/install",
      payload: { name: "evil-world", version: "1.0.0", destDir },
    });
    expect(res.statusCode).toBe(502);
  });

  it("responds 502 when the manifest is invalid against the contract", async () => {
    const badService = createProjectMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 0,
      fetchFn: makeStubFetch({ schemaVersion: 1, generatedAt: "x", projects: [{}] }, {}),
    });
    const badApp = Fastify();
    registerProjectMarketplaceRoutes(badApp, { projectMarketplace: badService });
    await badApp.ready();
    const res = await badApp.inject({ method: "GET", url: "/api/marketplace/projects" });
    expect(res.statusCode).toBe(502);
    await badApp.close();
  });

  it("responds 502 when the manifest host is unreachable", async () => {
    const downService = createProjectMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 0,
      fetchFn: async () => {
        throw new Error("network down");
      },
    });
    const downApp = Fastify();
    registerProjectMarketplaceRoutes(downApp, { projectMarketplace: downService });
    await downApp.ready();
    const res = await downApp.inject({ method: "GET", url: "/api/marketplace/projects" });
    expect(res.statusCode).toBe(502);
    await downApp.close();
  });

  it("leaves no tmp zip behind when the install succeeds or the download fails", async () => {
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("marketplace-project-")).length;

    const okRes = await app.inject({
      method: "POST",
      url: "/api/marketplace/projects/install",
      payload: { name: "demo-world", version: "1.0.0", destDir },
    });
    expect(okRes.statusCode).toBe(200);

    const failService = createProjectMarketplaceService({
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 60_000,
      fetchFn: async (url: string) => {
        if (url === MANIFEST_URL) {
          return new Response(JSON.stringify(makeManifest(manifestEntries)), { status: 200 });
        }
        return new Response("boom", { status: 500 });
      },
    });
    const failApp = Fastify();
    registerProjectMarketplaceRoutes(failApp, { projectMarketplace: failService });
    await failApp.ready();
    const failRes = await failApp.inject({
      method: "POST",
      url: "/api/marketplace/projects/install",
      payload: { name: "demo-world", version: "1.0.0", destDir },
    });
    expect(failRes.statusCode).toBe(502);
    await failApp.close();

    const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("marketplace-project-")).length;
    expect(after).toBe(before);
  });
});
