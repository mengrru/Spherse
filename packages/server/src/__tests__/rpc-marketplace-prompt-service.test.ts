import { beforeEach, describe, expect, it, vi } from "vitest";
import { promptFallbackChain } from "../prompt-marketplace.js";
import { callMethod, type RpcHarness } from "@spherse/rpc/testing";
import {
  createHarness,
  promptEntry,
  promptManifest,
  promptService,
  promptUrl,
  recordingFetch,
  stubFetch,
  usePromptService,
  type FetchCall,
} from "./rpc-marketplace-testing.js";

vi.mock("../prompt-marketplace.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../prompt-marketplace.js")>()),
  promptMarketplaceService: { getPrompts: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("prompt marketplace service through rpc", () => {
  let harness: RpcHarness;
  const ZH_CN = promptManifest("zh-cn", [promptEntry("worldview", "世界观创作助手")]);
  const EN_US = promptManifest("en-us", [promptEntry("worldview", "Worldbuilding Assistant")]);

  beforeEach(() => {
    harness = createHarness();
  });

  it("promptFallbackChain orders zh-cn and en-us fallbacks per language family", () => {
    expect(promptFallbackChain("zh-cn")).toEqual(["zh-cn", "en-us"]);
    expect(promptFallbackChain("zh-tw")).toEqual(["zh-tw", "zh-cn", "en-us"]);
    expect(promptFallbackChain("zh")).toEqual(["zh", "zh-cn", "en-us"]);
    expect(promptFallbackChain("en-us")).toEqual(["en-us", "zh-cn"]);
    expect(promptFallbackChain("ja-jp")).toEqual(["ja-jp", "en-us", "zh-cn"]);
  });

  it("marketplace.prompts returns the manifest for the requested language", async () => {
    const calls: FetchCall[] = [];
    usePromptService(
      promptService(
        recordingFetch(stubFetch({ json: { [promptUrl("zh-cn")]: ZH_CN, [promptUrl("en-us")]: EN_US } }), calls),
      ),
    );
    const frame = await callMethod(harness, "marketplace.prompts", { language: "zh-cn" });
    expect(frame).toMatchObject({
      type: "result",
      ok: true,
      data: { language: "zh-cn", prompts: [{ title: "世界观创作助手" }] },
    });
    expect(calls.map((call) => call.url)).toEqual([promptUrl("zh-cn")]);
  });

  it("marketplace.prompts falls back to zh-cn when the zh-tw manifest is missing", async () => {
    const calls: FetchCall[] = [];
    usePromptService(
      promptService(
        recordingFetch(stubFetch({ json: { [promptUrl("zh-cn")]: ZH_CN, [promptUrl("en-us")]: EN_US } }), calls),
      ),
    );
    const frame = await callMethod(harness, "marketplace.prompts", { language: "zh-tw" });
    expect(frame).toMatchObject({
      type: "result",
      ok: true,
      data: { language: "zh-cn", prompts: [{ title: "世界观创作助手" }] },
    });
    expect(calls.map((call) => call.url)).toEqual([promptUrl("zh-tw"), promptUrl("zh-cn")]);
  });

  it("marketplace.prompts falls back to zh-cn when the en-us manifest is missing", async () => {
    usePromptService(promptService(stubFetch({ json: { [promptUrl("zh-cn")]: ZH_CN } })));
    const frame = await callMethod(harness, "marketplace.prompts", { language: "en-us" });
    expect(frame).toMatchObject({ type: "result", ok: true, data: { language: "zh-cn" } });
  });

  it("marketplace.prompts caches per requested language within the ttl", async () => {
    const calls: FetchCall[] = [];
    usePromptService(
      promptService(recordingFetch(stubFetch({ json: { [promptUrl("zh-cn")]: ZH_CN } }), calls)),
    );
    await callMethod(harness, "marketplace.prompts", { language: "zh-cn" });
    await callMethod(harness, "marketplace.prompts", { language: "zh-cn" });
    expect(calls.map((call) => call.url)).toEqual([promptUrl("zh-cn")]);
  });

  it("marketplace.prompts refetches after the cache ttl expires", async () => {
    const calls: FetchCall[] = [];
    usePromptService(
      promptService(recordingFetch(stubFetch({ json: { [promptUrl("en-us")]: EN_US } }), calls), 0),
    );
    const first = await callMethod(harness, "marketplace.prompts", { language: "zh-cn" });
    const second = await callMethod(harness, "marketplace.prompts", { language: "zh-cn" });
    expect(first).toMatchObject({ type: "result", ok: true });
    expect(second).toMatchObject({ type: "result", ok: true });
    expect(calls.map((call) => call.url)).toEqual([
      promptUrl("zh-cn"),
      promptUrl("en-us"),
      promptUrl("zh-cn"),
      promptUrl("en-us"),
    ]);
  });

  it("marketplace.prompts maps a fully missing fallback chain to not found", async () => {
    usePromptService(promptService(stubFetch({})));
    const frame = await callMethod(harness, "marketplace.prompts", { language: "zh-tw" });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: {
        code: 100,
        message: 'No prompt templates available for language "zh-tw" or its fallbacks',
      },
    });
  });

  it("marketplace.prompts maps an upstream server error to internal error", async () => {
    usePromptService(promptService(stubFetch({ statuses: { [promptUrl("zh-cn")]: 500 } })));
    const frame = await callMethod(harness, "marketplace.prompts", { language: "zh-cn" });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: -32603, message: "Prompt marketplace fetch failed: HTTP 500" },
    });
  });

  it("marketplace.prompts maps an upstream payload that is not valid json to internal error", async () => {
    usePromptService(
      promptService(
        stubFetch({ statuses: { [promptUrl("zh-cn")]: 200 }, bodies: { [promptUrl("zh-cn")]: "not json" } }),
      ),
    );
    const frame = await callMethod(harness, "marketplace.prompts", { language: "zh-cn" });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: -32603, message: expect.stringMatching(/^Prompt marketplace payload is not valid JSON: /) },
    });
  });

  it("marketplace.prompts maps an upstream payload that violates the contract to internal error", async () => {
    usePromptService(
      promptService(
        stubFetch({
          json: {
            [promptUrl("zh-cn")]: {
              schemaVersion: 1,
              generatedAt: "x",
              language: "zh-cn",
              prompts: [{}],
            },
          },
        }),
      ),
    );
    const frame = await callMethod(harness, "marketplace.prompts", { language: "zh-cn" });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: -32603, message: expect.stringMatching(/^Prompt marketplace payload is invalid: /) },
    });
  });

  it("marketplace.prompts maps an oversized payload to internal error", async () => {
    const big = "x".repeat(5 * 1024 * 1024 + 1);
    usePromptService(
      promptService(async (url) =>
        url === promptUrl("zh-cn")
          ? new Response(big, { status: 200, headers: { "content-length": String(big.length) } })
          : new Response("not found", { status: 404 }),
      ),
    );
    const frame = await callMethod(harness, "marketplace.prompts", { language: "zh-cn" });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: {
        code: -32603,
        message: "Prompt marketplace payload exceeds size limit (5242881 bytes)",
      },
    });
  });
});
