import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Field, FieldLabel } from "../../components/ui/field";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../components/ui/tooltip";
import { ChevronDownIcon, InfoIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { parseTemperature } from "./parse-temperature";
import { parseTopP } from "./parse-top-p";
import { cn } from "../../lib/utils";
import type { SamplingParams } from "@spherse/core";

interface AdvancedSettingsProps {
  sampling?: SamplingParams;
  onSetSampling: (params: SamplingParams) => void;
  className?: string;
}

interface ParamFieldConfig {
  label: string;
  hint: string;
  placeholder: string;
  resetLabel: string;
  min: number;
  max?: number;
  step: number;
  parse: (value: string) => number | undefined;
}

function ParamField({
  value,
  config,
  onSet,
}: {
  value: number | undefined;
  config: ParamFieldConfig;
  onSet: (value?: number) => void;
}) {
  const [local, setLocal] = useState<string>(value == null ? "" : String(value));
  useEffect(() => {
    setLocal(value == null ? "" : String(value));
  }, [value]);

  const handleBlur = () => {
    const parsed = config.parse(local);
    if (parsed !== value) {
      onSet(parsed);
    }
  };

  return (
    <Field className="mt-3">
      <FieldLabel className="items-center">
        {config.label}
        <Tooltip>
          <TooltipTrigger
            aria-label={config.hint}
            className="inline-flex cursor-help text-muted-foreground"
          >
            <InfoIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>
            <span>{config.hint}</span>
          </TooltipContent>
        </Tooltip>
      </FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={config.min}
          max={config.max}
          step={config.step}
          className="max-w-[10rem]"
          value={local}
          placeholder={config.placeholder}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={handleBlur}
        />
        <Button variant="ghost" size="sm" onClick={() => onSet(undefined)}>
          {config.resetLabel}
        </Button>
      </div>
    </Field>
  );
}

export function AdvancedSettings({
  sampling,
  onSetSampling,
  className,
}: AdvancedSettingsProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

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
        <ParamField
          value={sampling?.temperature}
          onSet={(v) => onSetSampling({ temperature: v })}
          config={{
            label: t("settings.models.temperature"),
            hint: t("settings.models.temperatureHint"),
            placeholder: t("settings.models.temperaturePlaceholder"),
            resetLabel: t("settings.models.temperatureReset"),
            min: 0,
            step: 0.1,
            parse: parseTemperature,
          }}
        />
        <ParamField
          value={sampling?.topP}
          onSet={(v) => onSetSampling({ topP: v })}
          config={{
            label: t("settings.models.topP"),
            hint: t("settings.models.topPHint"),
            placeholder: t("settings.models.topPPlaceholder"),
            resetLabel: t("settings.models.topPReset"),
            min: 0,
            max: 1,
            step: 0.1,
            parse: parseTopP,
          }}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
