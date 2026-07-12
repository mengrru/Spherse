import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { useCases } from "../data/use-cases";
import type { TranslationKey } from "../i18n";

interface UseCasesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: (key: TranslationKey) => string;
}

export function UseCasesModal({ open, onOpenChange, t }: UseCasesModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("feature.moreCases")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-6 overflow-y-auto pb-2">
          {useCases.map((useCase, idx) => (
            <div key={idx} className="flex flex-col gap-2">
              <img
                src={useCase.screenshot}
                alt={t(useCase.i18nKey as TranslationKey)}
                className="w-full rounded-lg border border-border"
              />
              <p className="text-sm text-muted-foreground">
                {t(useCase.i18nKey as TranslationKey)}
              </p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
