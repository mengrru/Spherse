import { useI18n } from "@spherse/i18n/react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { SearchFileField } from "./SearchFileField";
import { HintLabel } from "./HintLabel";
import { XIcon } from "lucide-react";

export function ContextPathField({
  contextPaths,
  onAdd,
  onRemove,
}: {
  contextPaths: string[];
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Field>
      <HintLabel hint={t("agent-dialog.refsHint")}>{t("agent-dialog.refsLabel")}</HintLabel>
      {contextPaths.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {contextPaths.map((path) => (
            <Badge key={path} variant="secondary" className="gap-1">
              {path}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="-mr-1 size-4"
                onClick={() => onRemove(path)}
              >
                <XIcon />
              </Button>
            </Badge>
          ))}
        </div>
      )}
      <SearchFileField
        exclude={contextPaths}
        onSelect={onAdd}
        placeholder={t("agent-dialog.refsPlaceholder")}
      />
    </Field>
  );
}
