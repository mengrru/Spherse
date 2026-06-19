import { createContext, useCallback, useContext } from "react";
import type { Locale } from "./types.js";
import type { TranslationKey } from "./catalog.js";
import { translate } from "./translate.js";

const I18nContext = createContext<Locale>("zh-CN");

export function I18nProvider(props: {
  locale: Locale;
  children: React.ReactNode;
}): React.ReactElement {
  return <I18nContext.Provider value={props.locale}>{props.children}</I18nContext.Provider>;
}

export function useI18n(): {
  locale: Locale;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
} {
  const locale = useContext(I18nContext);
  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );
  return { locale, t };
}
