import { useI18n } from "@spherse/i18n/react";
import { Button } from "../../components/ui/button";

interface ConflictBannerProps {
  onKeep: () => void;
  onReload: () => void;
}

export function ConflictBanner({ onKeep, onReload }: ConflictBannerProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm">
      <span className="flex-1">{t("content-browser.conflictBannerText")}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={onKeep}
      >
        {t("content-browser.conflictKeepMine")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onReload}
      >
        {t("content-browser.conflictReload")}
      </Button>
    </div>
  );
}
