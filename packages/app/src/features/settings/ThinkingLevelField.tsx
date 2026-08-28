import { Field, FieldLabel } from "../../components/ui/field";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../components/ui/tooltip";
import { InfoIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { SectionTitle } from "./SectionTitle";
import type { ThinkingLevel } from "@spherse/core";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "low", "medium", "high"];

export function ThinkingLevelField({
  value,
  onChange,
}: {
  value: ThinkingLevel | undefined;
  onChange: (level: ThinkingLevel) => void;
}) {
  const { t } = useI18n();
  return (
    <Field className="mt-3">
      <SectionTitle as={FieldLabel} className="items-center">
        {t("settings.models.thinkingLevel")}
        <Tooltip>
          <TooltipTrigger
            aria-label={t("settings.models.thinkingLevelHint")}
            className="inline-flex cursor-help text-muted-foreground"
          >
            <InfoIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>
            <span>{t("settings.models.thinkingLevelHint")}</span>
          </TooltipContent>
        </Tooltip>
      </SectionTitle>
      <NativeSelect
        className="w-full"
        value={value ?? "medium"}
        onChange={(e) => onChange(e.target.value as ThinkingLevel)}
      >
        {THINKING_LEVELS.map((level) => (
          <NativeSelectOption key={level} value={level}>
            {t(`settings.models.thinkingLevel.${level}`)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}
