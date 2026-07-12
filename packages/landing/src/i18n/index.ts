import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  normalizeLocale,
  type Locale,
} from "@spherse/i18n";
import { zhCN } from "./locales/zh-CN";
import { zhTW } from "./locales/zh-TW";
import { en } from "./locales/en";

type TranslationKey = keyof typeof zhCN;

const catalogs: Record<Locale, Record<TranslationKey, string>> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
};

const STORAGE_KEY = "spherse-landing-locale";

function detectInitialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const normalized = normalizeLocale(stored);
    if ((SUPPORTED_LOCALES as readonly string[]).includes(normalized)) {
      return normalized;
    }
  }
  return normalizeLocale(navigator.language);
}

export function useLandingI18n() {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => {
      const catalog = catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
      let value = catalog[key] ?? catalogs[DEFAULT_LOCALE][key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replace(`{${k}}`, String(v));
        }
      }
      return value;
    },
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return { locale, setLocale, t } as const;
}

export type { TranslationKey };
