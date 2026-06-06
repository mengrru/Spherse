import { useI18n } from "@spherse/i18n/react";

export function EmptyState() {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background text-foreground">
      <h1 className="mb-2 text-2xl font-semibold">
        Spherse
      </h1>
      <p className="text-sm text-muted-foreground">
        {t("empty-state.openProject")}
      </p>
    </div>
  );
}
