import { useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { Button } from "../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { ArrowLeftIcon, CheckIcon, CopyIcon, RefreshCwIcon, XIcon } from "lucide-react";

interface HeaderProps {
  filePath: string;
  isDirty: boolean;
  isEditing: boolean;
  isEditable: boolean;
  isHtml: boolean;
  htmlView: "preview" | "source";
  saving: boolean;
  onBack: () => void;
  onClose: () => void;
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
  onClose,
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
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="outline" size="sm" onClick={onBack} title={t("common.back")}>
          <ArrowLeftIcon />
          {t("common.back")}
        </Button>
      </div>
      <div className="group/header flex min-w-0 flex-1 items-center gap-0">
        <span className="me-1 truncate font-mono text-sm text-muted-foreground">
          {isDirty && <span className="me-1 text-primary">●</span>}
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
      <div className="flex shrink-0 items-center gap-2">
        {isHtml && !isEditing && (
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[htmlView]}
            onValueChange={(values) => {
              const next = values[0];
              if (next === "preview" || next === "source") {
                onHtmlViewChange(next);
              }
            }}
          >
            <ToggleGroupItem value="preview">
              {t("content-browser.preview")}
            </ToggleGroupItem>
            <ToggleGroupItem value="source">
              {t("content-browser.source")}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
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
        {!isEditing && (
          <Button variant="ghost" size="icon-sm" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>
            <XIcon />
          </Button>
        )}
      </div>
    </div>
  );
}
