import { useI18n } from "@spherse/i18n/react";
import { TOOL_GROUPS } from "./tool-registry";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { HintLabel } from "./HintLabel";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";

export function ToolPicker({
  selectedTools,
  onToggleGroup,
}: {
  selectedTools: string[];
  onToggleGroup: (groupToolIds: string[]) => void;
}) {
  const { t } = useI18n();
  return (
    <Field>
      <HintLabel hint={t("agent-dialog.toolsHint")}>{t("agent-dialog.toolsLabel")}</HintLabel>
      <div className="flex flex-wrap gap-1.5">
        {TOOL_GROUPS.map((group) => {
          const selected = group.toolIds.every((id) => selectedTools.includes(id));
          const button = (
            <Button
              key={group.label}
              type="button"
              variant={selected ? "default" : "outline"}
              size="sm"
              onClick={() => onToggleGroup(group.toolIds)}
            >
              {t(group.label)}
            </Button>
          );
          if (!group.hint) return button;
          return (
            <Tooltip key={group.label}>
              <TooltipTrigger render={button} />
              <TooltipContent side="bottom">{t(group.hint)}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </Field>
  );
}
