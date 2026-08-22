import { upcomingFeatures } from "../data/upcoming";
import type { TranslationKey } from "../i18n";

interface UpcomingFeaturesProps {
  t: (key: TranslationKey) => string;
}

export function UpcomingFeatures({ t }: UpcomingFeaturesProps) {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-8 text-center text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t("upcoming.label")}
        </h2>
        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
          {upcomingFeatures.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.id}
                className="flex items-center gap-4 rounded-xl border border-dashed border-border p-6"
              >
                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="size-6 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">
                    {t(`${feature.i18nKeyPrefix}.title` as TranslationKey)}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(`${feature.i18nKeyPrefix}.desc` as TranslationKey)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
