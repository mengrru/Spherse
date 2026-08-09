import type { TranslationKey } from "../i18n";

interface DocsPageProps {
  t: (key: TranslationKey) => string;
}

export function DocsPage({ t }: DocsPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {t("docs.title")}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">{t("docs.construction")}</p>
    </div>
  );
}
