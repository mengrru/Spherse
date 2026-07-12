import { SUPPORTED_LOCALES, type Locale } from "@spherse/i18n";
import type { TranslationKey } from "../i18n";
import { cn } from "../lib/utils";

const LANG_LABELS: Record<Locale, TranslationKey> = {
  "zh-CN": "lang.zhCN",
  "zh-TW": "lang.zhTW",
  en: "lang.en",
};

interface LanguageSwitcherProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

export function LanguageSwitcher({ locale, onLocaleChange, t }: LanguageSwitcherProps) {
  return (
    <div className="flex items-center gap-1">
      {SUPPORTED_LOCALES.map((lang) => (
        <button
          key={lang}
          onClick={() => onLocaleChange(lang)}
          className={cn(
            "rounded-md px-2 py-1 text-sm transition-colors",
            locale === lang
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(LANG_LABELS[lang])}
        </button>
      ))}
    </div>
  );
}
