import { describe, expect, it } from "vitest";
import { parseContract, schemas } from "../index.js";

describe("model settings contracts", () => {
  it("accepts a valid sanitized response", () => {
    const payload = {
      models: {
        text: {
          defaultModel: "anthropic/claude-sonnet-4",
          providers: { anthropic: { configured: true }, openai: { configured: false } },
          sampling: { temperature: 0.7 },
          thinkingLevel: "high",
        },
        image: {
          defaultModel: "openai/gpt-image-2",
          providers: { openai: { configured: true } },
        },
      },
      customProviders: [
        {
          id: "custom-foo",
          name: "Foo",
          baseUrl: "https://api.foo.com/v1",
          models: ["foo/foo-mini"],
          keyless: false,
          headers: { "X-Custom": "bar" },
        },
      ],
    };
    expect(parseContract(schemas.modelSettingsResponse, payload)).toEqual(payload);
  });

  it("accepts a minimal sanitized response without optional fields", () => {
    const payload = {
      models: {
        text: { defaultModel: "", providers: {} },
        image: { defaultModel: "", providers: {} },
      },
      customProviders: [],
    };
    expect(parseContract(schemas.modelSettingsResponse, payload)).toEqual(payload);
  });

  it("rejects a response that leaks provider api keys", () => {
    expect(() =>
      parseContract(schemas.modelSettingsResponse, {
        models: {
          text: { defaultModel: "", providers: { anthropic: { apiKey: "sk-leak" } } },
          image: { defaultModel: "", providers: {} },
        },
        customProviders: [],
      }),
    ).toThrow(/Invalid payload/);
  });

  it("accepts a valid write request with tri-state api keys", () => {
    const payload = {
      models: {
        text: {
          defaultModel: "",
          providers: {
            anthropic: { apiKey: "sk-new" },
            openai: { apiKey: "" },
            deepseek: {},
          },
          sampling: { temperature: 0.5 },
          thinkingLevel: "medium",
        },
        image: { defaultModel: "openai/gpt-image-2", providers: {} },
      },
      customProviders: [],
    };
    expect(parseContract(schemas.modelSettingsRequest, payload)).toEqual(payload);
  });

  it("accepts a write request without providers and customProviders fields", () => {
    const payload = {
      models: {
        text: { defaultModel: "anthropic/claude-sonnet-4" },
        image: { defaultModel: "" },
      },
    };
    expect(parseContract(schemas.modelSettingsRequest, payload)).toEqual(payload);
  });

  it("rejects a write request with an invalid thinking level", () => {
    expect(() =>
      parseContract(schemas.modelSettingsRequest, {
        models: {
          text: { defaultModel: "", thinkingLevel: "xhigh" },
          image: { defaultModel: "" },
        },
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects a write request missing required defaultModel", () => {
    expect(() =>
      parseContract(schemas.modelSettingsRequest, {
        models: {
          text: { providers: {} },
          image: { defaultModel: "" },
        },
      }),
    ).toThrow(/Invalid payload/);
  });

  it("rejects a custom provider with a non-string header value", () => {
    expect(() =>
      parseContract(schemas.modelSettingsRequest, {
        models: { text: { defaultModel: "" }, image: { defaultModel: "" } },
        customProviders: [
          {
            id: "x",
            name: "X",
            baseUrl: "https://x.example",
            models: [],
            keyless: true,
            headers: { "X-A": 1 },
          },
        ],
      }),
    ).toThrow(/Invalid payload/);
  });
});
