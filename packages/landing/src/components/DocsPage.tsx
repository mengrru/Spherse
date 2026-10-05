import type { Locale } from "@spherse/i18n";
import type { TranslationKey } from "../i18n";
import { getDoc } from "../lib/docs";
import { DocMarkdown } from "./DocMarkdown";

const TAILSCALE_DOC_ID = "tailscale";

interface DocsPageProps {
  t: (key: TranslationKey) => string;
  locale: Locale;
}

export function DocsPage({ t, locale }: DocsPageProps) {
  const content = getDoc(TAILSCALE_DOC_ID, locale);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("docs.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("docs.subtitle")}</p>
      </div>

      {content && (
        <article className="rounded-xl border border-border bg-card p-6 text-start sm:p-8">
          <DocMarkdown t={t}>{content}</DocMarkdown>
        </article>
      )}
    </div>
  );
}
