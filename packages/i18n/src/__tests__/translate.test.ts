import { describe, it, expect } from "vitest";
import { normalizeLocale, translate, createTranslator } from "../translate.js";
import type { TranslationKey } from "../catalog.js";

describe("normalizeLocale", () => {
  it("returns the locale when valid", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh-TW")).toBe("zh-TW");
  });

  it("returns DEFAULT_LOCALE for unknown values", () => {
    expect(normalizeLocale("ja")).toBe("zh-CN");
    expect(normalizeLocale(undefined)).toBe("zh-CN");
    expect(normalizeLocale(null)).toBe("zh-CN");
    expect(normalizeLocale(123)).toBe("zh-CN");
  });
});

describe("translate", () => {
  it("returns zh-CN value for zh-CN locale", () => {
    expect(translate("zh-CN", "app.loading")).toBe("加载中...");
  });

  it("returns en value for en locale", () => {
    expect(translate("en", "app.loading")).toBe("Loading...");
  });

  it("returns zh-TW value for zh-TW locale", () => {
    expect(translate("zh-TW", "app.loading")).toBe("載入中...");
  });

  it("falls back to zh-CN when locale catalog missing key", () => {
    expect(translate("zh-CN", "settings.title")).toBe("设置");
  });

  it("returns key itself when not found in any catalog", () => {
    expect(translate("zh-CN", "nonexistent.key" as TranslationKey)).toBe("nonexistent.key");
  });
});

describe("createTranslator", () => {
  it("returns a translator with the given locale", () => {
    const { locale, t } = createTranslator("en");
    expect(locale).toBe("en");
    expect(t("app.loading")).toBe("Loading...");
  });
});
