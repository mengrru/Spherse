import { PRESET_PROMPT_TEMPLATES } from "@spherse/presets";
import { useI18n } from "@spherse/i18n/react";
import { Button } from "../../components/ui/button";

export type PromptTemplate = (typeof PRESET_PROMPT_TEMPLATES)[number];

export function PromptTemplatePicker({ onSelect }: { onSelect: (template: PromptTemplate) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{t("agent-dialog.templatePresetsLabel")}</span>
      {PRESET_PROMPT_TEMPLATES.map((tpl) => (
        <Button key={tpl.id} type="button" variant="outline" size="sm" onClick={() => onSelect(tpl)}>
          {t(`agent-dialog.template.${tpl.id}`)}
        </Button>
      ))}
    </div>
  );
}
