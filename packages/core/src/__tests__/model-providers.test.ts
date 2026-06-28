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

import { getChatStreamFn } from "../model-providers/index.js";

describe("getChatStreamFn temperature injection", () => {
  beforeEach(() => {
    streamSimpleMock.mockReset();
  });

  it("injects temperature into stream options when a value is provided", async () => {
    const streamFn = getChatStreamFn(0.3);
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
    const streamFn = getChatStreamFn(undefined);
    const model = { id: "gemini-2.5-pro" } as never;
    const context = { input: [] } as never;
    const options = { maxTokens: 100 } as never;

    await streamFn(model, context, options);

    expect(streamSimpleMock).toHaveBeenCalledTimes(1);
    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    expect(passedOptions).not.toHaveProperty("temperature");
    expect(passedOptions).toHaveProperty("maxTokens", 100);
  });

  it("omits temperature from options when null", async () => {
    const streamFn = getChatStreamFn(null as never);
    const model = { id: "gemini-2.5-pro" } as never;
    const context = { input: [] } as never;
    const options = { maxTokens: 100 } as never;

    await streamFn(model, context, options);

    expect(streamSimpleMock).toHaveBeenCalledTimes(1);
    const [, , passedOptions] = streamSimpleMock.mock.calls[0];
    expect(passedOptions).not.toHaveProperty("temperature");
  });
});
