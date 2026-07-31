import { Link, useLocation } from "react-router";
import type { Locale } from "@spherse/i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";
import type { TranslationKey } from "../i18n";

interface HeaderProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

export function Header({ locale, onLocaleChange, t }: HeaderProps) {
  const location = useLocation();
  const isCases = location.pathname === "/cases";

  return (
    <header className="flex items-center px-6 py-3">
      {isCases && (
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← {t("cases.backHome")}
        </Link>
      )}
      <div className="ms-auto flex items-center gap-4">
        <Link
          to="/cases"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("nav.explore")}
        </Link>
        <LanguageSwitcher locale={locale} onLocaleChange={onLocaleChange} t={t} />
      </div>
    </header>
  );
}
