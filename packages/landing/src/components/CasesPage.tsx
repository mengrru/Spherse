import { cases } from "../data/cases";
import { sampleUrl } from "../lib/sample";
import { Hero } from "./Hero";
import type { TranslationKey } from "../i18n";

interface CasesPageProps {
  t: (key: TranslationKey) => string;
}

export function CasesPage({ t }: CasesPageProps) {
  return (
    <>
      <Hero t={t} />

      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("cases.pageTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("cases.pageSubtitle")}</p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {cases.map((item) => {
            const href = sampleUrl(item.zipFile);
            return (
              <article
                key={item.id}
                className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
              >
                <img
                  src={item.screenshot}
                  alt={t(item.titleKey)}
                  className="aspect-[16/10] w-full object-cover"
                  loading="lazy"
                />
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <h2 className="text-sm font-medium text-foreground">{t(item.titleKey)}</h2>
                  <p className="flex-1 text-xs text-muted-foreground">{t(item.descKey)}</p>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      {t("cases.download")}
                    </a>
                  ) : (
                    <span
                      aria-disabled
                      className="mt-1 inline-flex items-center justify-center rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground"
                    >
                      {t("cases.download")}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}
