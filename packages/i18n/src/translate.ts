import type { Locale } from "./types.js";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./types.js";
import type { TranslationKey } from "./catalog.js";
import { zhCN, zhTW, en } from "./catalog.js";
import { formatTemplate } from "./format.js";

const catalogs: Record<Locale, Record<TranslationKey, string>> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
};

export function normalizeLocale(value: unknown): Locale {
  if (typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value)) {
    return value as Locale;
  }
  return DEFAULT_LOCALE;
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const catalog = catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
  const value = catalog[key] ?? catalogs[DEFAULT_LOCALE][key] ?? key;
  return formatTemplate(value, params);
}

export function createTranslator(locale: Locale) {
  return {
    locale,
    t: (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(locale, key, params),
  };
}
