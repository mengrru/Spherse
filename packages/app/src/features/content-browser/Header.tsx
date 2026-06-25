import { useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { Button } from "../../components/ui/button";
import { ArrowLeftIcon, CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react";

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
  onRefresh: () => void;
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
  onRefresh,
}: HeaderProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-3">
      <Button variant="outline" onClick={onBack}>
        <ArrowLeftIcon />
        {t("common.back")}
      </Button>
      <div className="group/header flex min-w-0 items-center gap-0">
        <span className="me-1 truncate font-mono text-sm text-muted-foreground">
          {isDirty && <span className="mr-1 text-primary">●</span>}
          {filePath}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 opacity-0 transition-opacity group-hover/header:opacity-100"
          data-copied={copied}
          title={t("content-browser.copyPath")}
          onClick={() => {
            navigator.clipboard.writeText(filePath).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
        </Button>
        {!isEditing && (
          <Button variant="ghost" size="icon-sm" className="shrink-0 opacity-0 transition-opacity group-hover/header:opacity-100" onClick={onRefresh} title={t("content-browser.refresh")}>
            <RefreshCwIcon />
          </Button>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {isEditing ? (
          <>
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
          </>
        ) : isEditable ? (
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
    </div>
  );
}
