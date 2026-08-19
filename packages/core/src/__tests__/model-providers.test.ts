import { describe, it, expect, vi, beforeEach } from "vitest";

const { streamSimpleMock } = vi.hoisted(() => ({ streamSimpleMock: vi.fn() }));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    streamSimple: streamSimpleMock,
    getProviders: () => [],
    getModels: () => [],
    getModel: () => undefined,
  }),
  builtinImagesModels: () => ({
    getProviders: () => [],
    getModels: () => [],
    setProvider: () => {},
  }),
}));

import { ModelCatalog } from "../model-providers/catalog.js";

describe("getChatStreamFn temperature injection", () => {
  beforeEach(() => {
    streamSimpleMock.mockReset();
  });

  it("injects temperature into stream options when a value is provided", async () => {
    const streamFn = new ModelCatalog().getChatStreamFn({ temperature: 0.3 });
    const model = { id: "gemini-2.5-pro" } as never;
    const context = { input: [] } as never;
    const options = { maxTokens: 100 } as never;

    await streamFn(model, context, options);

    expect(streamSimpleMock).toHaveBeenCalledTimes(1);
    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    expect(passedOptions).toHaveProperty("temperature", 0.3);
    expect(passedOptions).toHaveProperty("maxTokens", 100);
  });

  it("omits temperature from options when undefined", async () => {
    const streamFn = new ModelCatalog().getChatStreamFn(undefined);
    const model = { id: "gemini-2.5-pro" } as never;
    const context = { input: [] } as never;
    const options = { maxTokens: 100 } as never;

    await streamFn(model, context, options);

    expect(streamSimpleMock).toHaveBeenCalledTimes(1);
    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    expect(passedOptions).not.toHaveProperty("temperature");
    expect(passedOptions).toHaveProperty("maxTokens", 100);
  });

  it("omits temperature from options when null sampling", async () => {
    const streamFn = new ModelCatalog().getChatStreamFn(null as never);
    const model = { id: "gemini-2.5-pro" } as never;
    const context = { input: [] } as never;
    const options = { maxTokens: 100 } as never;

    await streamFn(model, context, options);

    expect(streamSimpleMock).toHaveBeenCalledTimes(1);
    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    expect(passedOptions).not.toHaveProperty("temperature");
  });
});

describe("getChatStreamFn topP injection", () => {
  beforeEach(() => {
    streamSimpleMock.mockReset();
  });

  it("adds onPayload to options when topP is provided", async () => {
    const streamFn = new ModelCatalog().getChatStreamFn({ topP: 0.9 });
    const model = { id: "gpt-4o", api: "openai-completions" } as never;
    const context = { input: [] } as never;
    const options = { maxTokens: 100 } as never;

    await streamFn(model, context, options);

    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    expect(typeof passedOptions.onPayload).toBe("function");
    expect(passedOptions).toHaveProperty("maxTokens", 100);
  });

  it("omits onPayload when topP is undefined", async () => {
    const streamFn = new ModelCatalog().getChatStreamFn(undefined);
    const model = { id: "gpt-4o" } as never;
    const context = { input: [] } as never;

    await streamFn(model, context, {});

    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    expect(passedOptions).not.toHaveProperty("onPayload");
  });

  it("injects root-level top_p for openai-completions", async () => {
    const streamFn = new ModelCatalog().getChatStreamFn({ topP: 0.5 });
    const model = { id: "m", api: "openai-completions" } as never;

    await streamFn(model, { input: [] } as never, {});

    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    const result = passedOptions.onPayload({ messages: [] }, model);
    expect(result).toEqual({ messages: [], top_p: 0.5 });
  });

  it("injects root-level top_p for openai-responses", async () => {
    const streamFn = new ModelCatalog().getChatStreamFn({ topP: 0.5 });
    const model = { id: "m", api: "openai-responses" } as never;

    await streamFn(model, { input: [] } as never, {});

    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    const result = passedOptions.onPayload({ input: [] }, model);
    expect(result).toEqual({ input: [], top_p: 0.5 });
  });

  it("injects root-level top_p for anthropic-messages", async () => {
    const streamFn = new ModelCatalog().getChatStreamFn({ topP: 0.5 });
    const model = { id: "m", api: "anthropic-messages" } as never;

    await streamFn(model, { input: [] } as never, {});

    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    const result = passedOptions.onPayload({ messages: [] }, model);
    expect(result).toEqual({ messages: [], top_p: 0.5 });
  });

  it("injects topP into config for google-generative-ai", async () => {
    const streamFn = new ModelCatalog().getChatStreamFn({ topP: 0.5 });
    const model = { id: "m", api: "google-generative-ai" } as never;

    await streamFn(model, { input: [] } as never, {});

    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    const result = passedOptions.onPayload({ contents: [], config: { temperature: 0.3 } }, model);
    expect(result).toEqual({ contents: [], config: { temperature: 0.3, topP: 0.5 } });
  });

  it("initializes config for google when absent", async () => {
    const streamFn = new ModelCatalog().getChatStreamFn({ topP: 0.5 });
    const model = { id: "m", api: "google-generative-ai" } as never;

    await streamFn(model, { input: [] } as never, {});

    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    const result = passedOptions.onPayload({ contents: [] }, model);
    expect(result).toEqual({ contents: [], config: { topP: 0.5 } });
  });

  it("returns undefined (no-op) for unknown api", async () => {
    const streamFn = new ModelCatalog().getChatStreamFn({ topP: 0.5 });
    const model = { id: "m", api: "some-other-api" } as never;

    await streamFn(model, { input: [] } as never, {});

    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    const result = passedOptions.onPayload({ foo: 1 }, model);
    expect(result).toBeUndefined();
  });

  it("coexists with temperature injection", async () => {
    const streamFn = new ModelCatalog().getChatStreamFn({ temperature: 0.7, topP: 0.5 });
    const model = { id: "m", api: "openai-completions" } as never;

    await streamFn(model, { input: [] } as never, {});

    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    expect(passedOptions).toHaveProperty("temperature", 0.7);
    expect(typeof passedOptions.onPayload).toBe("function");
  });
});
