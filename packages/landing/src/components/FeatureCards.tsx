import { useState } from "react";
import { features, type Feature } from "../data/features";
import { FeatureModal } from "./FeatureModal";
import { UseCasesModal } from "./UseCasesModal";
import { Button } from "./ui/button";
import type { TranslationKey } from "../i18n";

interface FeatureCardsProps {
  t: (key: TranslationKey) => string;
}

export function FeatureCards({ t }: FeatureCardsProps) {
  const [selected, setSelected] = useState<Feature | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [useCasesOpen, setUseCasesOpen] = useState(false);

  const handleClick = (feature: Feature) => {
    setSelected(feature);
    setModalOpen(true);
  };

  const handleOpenChange = (open: boolean) => {
    setModalOpen(open);
    if (!open) {
      setSelected(null);
    }
  };

  return (
    <section className="px-6 py-16">
      <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <button
              key={feature.id}
              onClick={() => handleClick(feature)}
              className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex size-12 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-accent">
                <Icon className="size-6 text-foreground" />
              </div>
              <h3 className="font-semibold text-foreground">
                {t(`${feature.i18nKeyPrefix}.title` as TranslationKey)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t(`${feature.i18nKeyPrefix}.desc` as TranslationKey)}
              </p>
            </button>
          );
        })}
      </div>
      <div className="mt-8 flex justify-center">
        <Button variant="outline" onClick={() => setUseCasesOpen(true)}>
          {t("feature.moreCases")}
        </Button>
      </div>
      <p className="mx-auto mt-12 max-w-3xl text-center text-base text-muted-foreground md:text-lg">
        {t("feature.slogan")}
      </p>
      <UseCasesModal
        open={useCasesOpen}
        onOpenChange={setUseCasesOpen}
        t={t}
      />
      <FeatureModal
        feature={selected}
        open={modalOpen}
        onOpenChange={handleOpenChange}
        t={t}
      />
    </section>
  );
}
