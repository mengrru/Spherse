import { useI18n } from "@spherse/i18n/react";
import { TOOL_GROUPS } from "./tool-registry";
import { Button } from "../../components/ui/button";
import { Field, FieldLabel } from "../../components/ui/field";

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
      <FieldLabel>{t("agent-dialog.toolsLabel")}</FieldLabel>
      <div className="flex flex-wrap gap-1.5">
        {TOOL_GROUPS.map((group) => {
          const selected = group.toolIds.every((id) => selectedTools.includes(id));
          return (
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
        })}
      </div>
    </Field>
  );
}
