import { useI18n } from "@spherse/i18n/react";
import { Button } from "../../components/ui/button";
import { ArrowLeftIcon } from "lucide-react";

interface HeaderProps {
  filePath: string;
  isDirty: boolean;
  isEditing: boolean;
  isEditable: boolean;
  isHtml: boolean;
  htmlView: "preview" | "source";
  saving: boolean;
  onBack: () => void;
  onEnterEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onHtmlViewChange: (view: "preview" | "source") => void;
}

export function Header({
  filePath,
  isDirty,
  isEditing,
  isEditable,
  isHtml,
  htmlView,
  saving,
  onBack,
  onEnterEdit,
  onCancelEdit,
  onSave,
  onHtmlViewChange,
}: HeaderProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-3">
      <Button variant="outline" onClick={onBack}>
        <ArrowLeftIcon />
        {t("common.back")}
      </Button>
      <span className="flex-1 font-mono text-sm text-muted-foreground">
        {isDirty && <span className="mr-1 text-primary">●</span>}
        {filePath}
      </span>
      {isEditing ? (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCancelEdit}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={!isDirty || saving}
          >
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      ) : isEditable && !isHtml ? (
        <Button variant="outline" size="sm" onClick={onEnterEdit}>
          {t("common.edit")}
        </Button>
      ) : null}
      {isHtml && !isEditing && (
        <div className="flex overflow-hidden rounded-md border border-border">
          <Button
            variant={htmlView === "preview" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => onHtmlViewChange("preview")}
          >
            {t("content-browser.preview")}
          </Button>
          <Button
            variant={htmlView === "source" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none border-l border-border"
            onClick={() => onHtmlViewChange("source")}
          >
            {t("content-browser.source")}
          </Button>
        </div>
      )}
    </div>
  );
}
