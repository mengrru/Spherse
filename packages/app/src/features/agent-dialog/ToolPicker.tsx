import { useState } from "react";
import { ChevronDownIcon, AlertTriangleIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { TOOL_GROUPS, type ToolGroup } from "./tool-registry";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { HintLabel } from "./HintLabel";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "../../components/ui/collapsible";

function GroupButton({
  group,
  selected,
  onToggleGroup,
}: {
  group: ToolGroup;
  selected: boolean;
  onToggleGroup: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const button = (
    <Button
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
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="bottom">{t(group.hint)}</TooltipContent>
    </Tooltip>
  );
}

export function ToolPicker({
  selectedTools,
  onToggleGroup,
}: {
  selectedTools: string[];
  onToggleGroup: (groupToolIds: string[]) => void;
}) {
  const { t } = useI18n();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const normalGroups = TOOL_GROUPS.filter((g) => !g.advanced);
  const advancedGroups = TOOL_GROUPS.filter((g) => g.advanced);
  const anyAdvancedSelected = advancedGroups.some((g) => g.toolIds.every((id) => selectedTools.includes(id)));

  return (
    <Field>
      <HintLabel hint={t("agent-dialog.toolsHint")}>{t("agent-dialog.toolsLabel")}</HintLabel>
      <div className="flex flex-wrap gap-1.5">
        {normalGroups.map((group) => (
          <GroupButton
            key={group.label}
            group={group}
            selected={group.toolIds.every((id) => selectedTools.includes(id))}
            onToggleGroup={onToggleGroup}
          />
        ))}
      </div>
      {advancedGroups.length > 0 ? (
        <Collapsible open={advancedOpen || anyAdvancedSelected} onOpenChange={setAdvancedOpen} className="mt-2">
          <CollapsibleTrigger
            render={
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
                <AlertTriangleIcon className="size-3.5 text-warning" />
                {t("tool.advanced_section")}
                <ChevronDownIcon className="size-3.5 transition-transform data-[panel-open]:rotate-180" />
              </Button>
            }
          />
          <CollapsibleContent className="flex flex-wrap gap-1.5 pt-1.5">
            {advancedGroups.map((group) => (
              <GroupButton
                key={group.label}
                group={group}
                selected={group.toolIds.every((id) => selectedTools.includes(id))}
                onToggleGroup={onToggleGroup}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </Field>
  );
}
