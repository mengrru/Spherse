import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerPromptMarketplaceRoutes } from "../routes/prompt-marketplace.js";
import { createPromptMarketplaceService, promptFallbackChain } from "../prompt-marketplace.js";

const BASE_URL = "https://prompts.test/spherse/prompts";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function makeManifest(language: string, prompts: Array<Record<string, unknown>>): unknown {
  return { schemaVersion: 1, generatedAt: "2026-10-11T00:00:00Z", language, prompts };
}

function makeEntry(id: string, title: string): Record<string, unknown> {
  return { id, title, description: `${title} description`, category: "创作", content: `${title} content` };
}

interface StubOptions {
  jsonByUrl?: Record<string, unknown>;
  statuses?: Record<string, number>;
  bodies?: Record<string, string>;
}

function makeStubFetch(options: StubOptions): FetchLike {
  return async (url: string) => {
    const status = options.statuses?.[url];
    if (status !== undefined) {
      return new Response(options.bodies?.[url] ?? "error", { status });
    }
    const payload = options.jsonByUrl?.[url];
    if (payload !== undefined) {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

function buildApp(fetchFn: FetchLike, cacheTtlMs = 60_000): FastifyInstance {
  const service = createPromptMarketplaceService({ baseUrl: BASE_URL, cacheTtlMs, fetchFn });
  const app = Fastify();
  registerPromptMarketplaceRoutes(app, { promptMarketplace: service });
  return app;
}

describe("prompt marketplace: fallback chain", () => {
  it("orders zh-cn and en-us fallbacks per language family", () => {
    expect(promptFallbackChain("zh-cn")).toEqual(["zh-cn", "en-us"]);
    expect(promptFallbackChain("zh-tw")).toEqual(["zh-tw", "zh-cn", "en-us"]);
    expect(promptFallbackChain("en-us")).toEqual(["en-us", "zh-cn"]);
    expect(promptFallbackChain("ja-jp")).toEqual(["ja-jp", "en-us", "zh-cn"]);
  });
});

describe("prompt marketplace routes", () => {
  let app: FastifyInstance;
  let fetchCalls: string[];

  beforeAll(() => {
    fetchCalls = [];
    const zhCn = makeManifest("zh-cn", [makeEntry("worldview", "世界观创作助手")]);
    const enUs = makeManifest("en-us", [makeEntry("worldview", "Worldbuilding Assistant")]);
    app = buildApp(async (url, init) => {
      fetchCalls.push(url);
      return makeStubFetch({
        jsonByUrl: {
          [`${BASE_URL}/zh-cn.json`]: zhCn,
          [`${BASE_URL}/en-us.json`]: enUs,
        },
      })(url, init);
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the manifest for the requested language", async () => {
    const res = await app.inject({ method: "GET", url: "/api/marketplace/prompts?language=zh-cn" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.language).toBe("zh-cn");
    expect(body.prompts).toHaveLength(1);
    expect(body.prompts[0].title).toBe("世界观创作助手");
  });

  it("falls back to zh-cn when zh-tw json is missing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/marketplace/prompts?language=zh-tw" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.language).toBe("zh-cn");
    expect(body.prompts[0].title).toBe("世界观创作助手");
    expect(fetchCalls).toContain(`${BASE_URL}/zh-tw.json`);
    expect(fetchCalls).toContain(`${BASE_URL}/zh-cn.json`);
    expect(fetchCalls).not.toContain(`${BASE_URL}/en-us.json`);
  });

  it("falls back to zh-cn when en-us json is missing", async () => {
    const app2 = buildApp(
      makeStubFetch({ jsonByUrl: { [`${BASE_URL}/zh-cn.json`]: makeManifest("zh-cn", [makeEntry("w", "中文")]) } }),
    );
    const res = await app2.inject({ method: "GET", url: "/api/marketplace/prompts?language=en-us" });
    expect(res.statusCode).toBe(200);
    expect(res.json().language).toBe("zh-cn");
    await app2.close();
  });

  it("defaults to en-us when language param is omitted", async () => {
    const app2 = buildApp(
      makeStubFetch({
        jsonByUrl: {
          [`${BASE_URL}/en-us.json`]: makeManifest("en-us", [makeEntry("w", "Worldbuilding")]),
          [`${BASE_URL}/zh-cn.json`]: makeManifest("zh-cn", [makeEntry("w", "中文")]),
        },
      }),
    );
    const res = await app2.inject({ method: "GET", url: "/api/marketplace/prompts" });
    expect(res.statusCode).toBe(200);
    expect(res.json().language).toBe("en-us");
    await app2.close();
  });

  it("caches per requested language within the ttl", async () => {
    const calls: string[] = [];
    const app2 = buildApp(async (url, init) => {
      calls.push(url);
      return makeStubFetch({
        jsonByUrl: { [`${BASE_URL}/zh-cn.json`]: makeManifest("zh-cn", [makeEntry("w", "中文")]) },
      })(url, init);
    });
    await app2.inject({ method: "GET", url: "/api/marketplace/prompts?language=zh-cn" });
    await app2.inject({ method: "GET", url: "/api/marketplace/prompts?language=zh-cn" });
    expect(calls).toHaveLength(1);
    await app2.close();
  });

  it("refetches after the cache ttl expires", async () => {
    const calls: string[] = [];
    const app2 = buildApp(async (url, init) => {
      calls.push(url);
      return makeStubFetch({
        jsonByUrl: { [`${BASE_URL}/en-us.json`]: makeManifest("en-us", [makeEntry("w", "en")]) },
      })(url, init);
    }, 0);
    const res1 = await app2.inject({ method: "GET", url: "/api/marketplace/prompts?language=zh-cn" });
    expect(res1.statusCode).toBe(200);
    const res2 = await app2.inject({ method: "GET", url: "/api/marketplace/prompts?language=zh-cn" });
    expect(res2.statusCode).toBe(200);
    expect(calls).toHaveLength(4);
    await app2.close();
  });

  it("rejects invalid language params with 400", async () => {
    for (const language of ["zh_CN", "ZH-CN", "english", "zh-cn-extra", "x", "zh-cn.json"]) {
      const res = await app.inject({ method: "GET", url: `/api/marketplace/prompts?language=${encodeURIComponent(language)}` });
      expect(res.statusCode).toBe(400);
    }
  });

  it("returns 404 when the whole fallback chain is missing", async () => {
    const app2 = buildApp(makeStubFetch({}));
    const res = await app2.inject({ method: "GET", url: "/api/marketplace/prompts?language=zh-tw" });
    expect(res.statusCode).toBe(404);
    await app2.close();
  });

  it("returns 502 when the upstream responds with a server error", async () => {
    const app2 = buildApp(makeStubFetch({ statuses: { [`${BASE_URL}/zh-cn.json`]: 500 } }));
    const res = await app2.inject({ method: "GET", url: "/api/marketplace/prompts?language=zh-cn" });
    expect(res.statusCode).toBe(502);
    await app2.close();
  });

  it("returns 502 when the upstream payload is not valid json", async () => {
    const app2 = buildApp(
      makeStubFetch({ statuses: { [`${BASE_URL}/zh-cn.json`]: 200 }, bodies: { [`${BASE_URL}/zh-cn.json`]: "not json" } }),
    );
    const res = await app2.inject({ method: "GET", url: "/api/marketplace/prompts?language=zh-cn" });
    expect(res.statusCode).toBe(502);
    await app2.close();
  });

  it("returns 502 when the upstream payload violates the contract", async () => {
    const app2 = buildApp(
      makeStubFetch({ jsonByUrl: { [`${BASE_URL}/zh-cn.json`]: { schemaVersion: 1, generatedAt: "x", language: "zh-cn", prompts: [{}] } } }),
    );
    const res = await app2.inject({ method: "GET", url: "/api/marketplace/prompts?language=zh-cn" });
    expect(res.statusCode).toBe(502);
    await app2.close();
  });

  it("returns 502 when the payload exceeds the size limit", async () => {
    const app2 = buildApp(async (url: string) => {
      if (url === `${BASE_URL}/zh-cn.json`) {
        const big = "x".repeat(5 * 1024 * 1024 + 1);
        return new Response(big, { status: 200, headers: { "content-length": String(big.length) } });
      }
      return new Response("not found", { status: 404 });
    });
    const res = await app2.inject({ method: "GET", url: "/api/marketplace/prompts?language=zh-cn" });
    expect(res.statusCode).toBe(502);
    await app2.close();
  });
});
