import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Field, FieldLabel } from "../../components/ui/field";
import { ChevronDownIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { parseTemperature } from "./parse-temperature";
import { cn } from "../../lib/utils";

interface AdvancedSettingsProps {
  temperature?: number;
  onSetTemperature: (value?: number) => void;
  onReset: () => void;
  className?: string;
}

export function AdvancedSettings({ temperature, onSetTemperature, onReset, className }: AdvancedSettingsProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [localValue, setLocalValue] = useState<string>(
    temperature == null ? "" : String(temperature),
  );

  useEffect(() => {
    setLocalValue(temperature == null ? "" : String(temperature));
  }, [temperature]);

  const handleBlur = () => {
    const parsed = parseTemperature(localValue);
    if (parsed !== temperature) {
      onSetTemperature(parsed);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("mt-2", className)}>
      <CollapsibleTrigger
        className="inline-flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDownIcon
          className="size-3.5 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
        {t("settings.models.advanced")}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-2 text-xs text-muted-foreground">{t("settings.models.advancedTip")}</p>
        <Field className="mt-3">
          <FieldLabel>{t("settings.models.temperature")}</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              step={0.1}
              className="max-w-[10rem]"
              value={localValue}
              placeholder={t("settings.models.temperaturePlaceholder")}
              onChange={(e) => setLocalValue(e.target.value)}
              onBlur={handleBlur}
            />
            <Button variant="ghost" size="sm" onClick={onReset}>
              {t("settings.models.temperatureReset")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("settings.models.temperatureHint")}</p>
        </Field>
      </CollapsibleContent>
    </Collapsible>
  );
}
