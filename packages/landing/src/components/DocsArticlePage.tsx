import type { Locale } from "@spherse/i18n";
import { Navigate, useParams } from "react-router";
import type { TranslationKey } from "../i18n";
import { getDoc } from "../lib/docs";
import { DocMarkdown } from "./DocMarkdown";

interface DocsArticlePageProps {
  t: (key: TranslationKey) => string;
  locale: Locale;
}

export function DocsArticlePage({ t, locale }: DocsArticlePageProps) {
  const { docId } = useParams<{ docId: string }>();
  const content = docId ? getDoc(docId, locale) : null;

  if (!content) {
    return <Navigate to="/docs" replace />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <article className="rounded-xl border border-border bg-card p-6 text-start sm:p-8">
        <DocMarkdown t={t}>{content}</DocMarkdown>
      </article>
    </div>
  );
}
