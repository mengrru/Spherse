import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import type { Feature } from "../data/features";
import type { TranslationKey } from "../i18n";

interface FeatureModalProps {
  feature: Feature | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: (key: TranslationKey) => string;
}

export function FeatureModal({ feature, open, onOpenChange, t }: FeatureModalProps) {
  if (!feature) return null;
  const Icon = feature.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-5" />
            {t(`${feature.i18nKeyPrefix}.title` as TranslationKey)}
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {feature.screenshots.map((src, idx) => (
            <img
              key={idx}
              src={src}
              alt={`${t(`${feature.i18nKeyPrefix}.title` as TranslationKey)} ${idx + 1}`}
              className="h-auto w-full max-w-none flex-shrink-0 rounded-lg border border-border"
              style={{ minWidth: "100%" }}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
