export const SUPPORTED_LOCALES = ["zh-CN", "zh-TW", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "zh-CN";
