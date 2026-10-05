import type { Locale } from "@spherse/i18n";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import type { TranslationKey } from "../i18n";
import { docIds, docTitle, docExcerpt, getDoc } from "../lib/docs";
import { DEFAULT_LOCALE } from "@spherse/i18n";

interface DocsPageProps {
  t: (key: TranslationKey) => string;
  locale: Locale;
}

export function DocsPage({ t, locale }: DocsPageProps) {
  const articles = docIds().map((id) => ({
    id,
    title: docTitle(getDoc(id, locale) ?? getDoc(id, DEFAULT_LOCALE) ?? ""),
    excerpt: docExcerpt(getDoc(id, locale) ?? getDoc(id, DEFAULT_LOCALE) ?? ""),
  }));

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("docs.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("docs.subtitle")}</p>
      </div>

      <div className="flex flex-col gap-4">
        {articles.map((article) => (
          <Link
            key={article.id}
            to={`/docs/${article.id}`}
            className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4 text-start transition-colors hover:border-foreground/30"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-medium text-foreground">
                {article.title}
              </span>
              <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {article.excerpt}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}
