import { describe, expect, it } from "vitest";
import { generateCustomProviderId, slugify } from "./custom-provider-id";

describe("slugify", () => {
  it("lowercases a normal name into kebab-case", () => {
    expect(slugify("OpenAI")).toBe("openai");
    expect(slugify("My Cool Provider")).toBe("my-cool-provider");
  });

  it("replaces runs of special characters with a single dash", () => {
    expect(slugify("DeepSeek (v3)")).toBe("deepseek-v3");
    expect(slugify("a_b/c.d")).toBe("a-b-c-d");
  });

  it("collapses consecutive non-alphanumeric runs into one dash", () => {
    expect(slugify("foo!!!bar")).toBe("foo-bar");
    expect(slugify("foo   bar")).toBe("foo-bar");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("---hello---")).toBe("hello");
    expect(slugify("!!!hello!!!")).toBe("hello");
  });

  it("falls back to 'provider' for empty input", () => {
    expect(slugify("")).toBe("provider");
  });

  it("falls back to 'provider' when input is all special characters", () => {
    expect(slugify("!!!")).toBe("provider");
    expect(slugify("@#$%")).toBe("provider");
    expect(slugify("   ")).toBe("provider");
  });

  it("preserves digits", () => {
    expect(slugify("GPT 4o")).toBe("gpt-4o");
  });
});

describe("generateCustomProviderId", () => {
  it("prefixes a unique slug with 'custom-'", () => {
    expect(generateCustomProviderId("OpenAI", [])).toBe("custom-openai");
    expect(generateCustomProviderId("My Provider", [])).toBe("custom-my-provider");
  });

  it("returns the base id when it does not collide with existing", () => {
    expect(generateCustomProviderId("DeepSeek", ["openai", "anthropic"])).toBe(
      "custom-deepseek",
    );
  });

  it("appends '-2' on the first collision", () => {
    expect(generateCustomProviderId("OpenAI", ["custom-openai"])).toBe("custom-openai-2");
  });

  it("appends '-3' when base and '-2' are taken", () => {
    expect(
      generateCustomProviderId("OpenAI", ["custom-openai", "custom-openai-2"]),
    ).toBe("custom-openai-3");
  });

  it("keeps incrementing until a free slot is found", () => {
    const existing = [
      "custom-my-co-provider",
      "custom-my-co-provider-2",
      "custom-my-co-provider-3",
      "custom-my-co-provider-4",
    ];
    expect(generateCustomProviderId("My Co Provider", existing)).toBe(
      "custom-my-co-provider-5",
    );
  });

  it("avoids clashing with built-in ids passed in existing", () => {
    expect(generateCustomProviderId("openai", ["openai"])).toBe("custom-openai");
    expect(generateCustomProviderId("openai", ["openai", "custom-openai"])).toBe(
      "custom-openai-2",
    );
  });

  it("treats existing as unordered and dedupes", () => {
    expect(
      generateCustomProviderId("Anthropic", [
        "custom-anthropic",
        "custom-anthropic",
        "custom-anthropic-2",
      ]),
    ).toBe("custom-anthropic-3");
  });

  it("uses the 'provider' fallback for empty name", () => {
    expect(generateCustomProviderId("", [])).toBe("custom-provider");
  });

  it("appends suffix when the empty-name fallback collides", () => {
    expect(generateCustomProviderId("", ["custom-provider"])).toBe("custom-provider-2");
    expect(
      generateCustomProviderId("!!!", ["custom-provider", "custom-provider-2"]),
    ).toBe("custom-provider-3");
  });

  it("accepts a Set as existing", () => {
    expect(
      generateCustomProviderId("OpenAI", new Set(["custom-openai"])),
    ).toBe("custom-openai-2");
  });
});
