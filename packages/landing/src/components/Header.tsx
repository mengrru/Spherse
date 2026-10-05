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
  const isExplore = location.pathname === "/explore";
  const isDocsArticle = /^\/docs\/.+/.test(location.pathname);

  return (
    <header className="flex items-center px-6 py-3">
      {isExplore && (
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← {t("cases.backHome")}
        </Link>
      )}
      {isDocsArticle && (
        <Link
          to="/docs"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← {t("docs.backToList")}
        </Link>
      )}
      <div className="ms-auto flex items-center gap-4">
        <Link
          to="/explore"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("nav.explore")}
        </Link>
        <Link
          to="/download"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("nav.download")}
        </Link>
        <Link
          to="/docs"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("nav.docs")}
        </Link>
        <LanguageSwitcher locale={locale} onLocaleChange={onLocaleChange} t={t} />
      </div>
    </header>
  );
}
