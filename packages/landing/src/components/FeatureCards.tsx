import { features } from "../data/features";
import type { TranslationKey } from "../i18n";

interface FeatureCardsProps {
  t: (key: TranslationKey) => string;
}

export function FeatureCards({ t }: FeatureCardsProps) {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto mb-10 max-w-3xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {t("feature.heading")}
        </h2>
        <p className="mt-3 text-base text-muted-foreground md:text-lg">
          {t("feature.subheading")}
        </p>
      </div>
      <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <article
              key={feature.id}
              className="group flex h-full flex-col items-start gap-4 rounded-xl border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex size-12 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-accent">
                <Icon className="size-6 text-foreground" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">
                  {t(`${feature.i18nKeyPrefix}.title` as TranslationKey)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`${feature.i18nKeyPrefix}.desc` as TranslationKey)}
                </p>
              </div>
            </article>
          );
        })}
      </div>
      <div className="mx-auto mt-12 max-w-3xl text-center">
        <p className="text-base text-muted-foreground md:text-lg">
          {t("feature.slogan")}
        </p>
        <p className="mt-3 text-lg font-medium text-foreground md:text-xl">
          {t("feature.motto")}
        </p>
      </div>
    </section>
  );
}
