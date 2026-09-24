import { useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { Button } from "../../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { ArrowLeftIcon, CheckIcon, Columns2Icon, CopyIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";

export interface HeaderEditing {
  isDirty: boolean;
  isEditing: boolean;
  isEditable: boolean;
  saving: boolean;
  onEnter: () => void;
  onCancel: () => void;
  onSave: () => void;
}

interface HeaderProps {
  filePath: string;
  isHtml: boolean;
  htmlView: "preview" | "source";
  findable: boolean;
  editing?: HeaderEditing;
  onBack?: () => void;
  onSplit?: () => void;
  onClose: () => void;
  onHtmlViewChange: (view: "preview" | "source") => void;
  onRefresh: () => void;
  onFindToggle: () => void;
}

export function Header({
  filePath,
  isHtml,
  htmlView,
  findable,
  editing,
  onBack,
  onSplit,
  onClose,
  onHtmlViewChange,
  onRefresh,
  onFindToggle,
}: HeaderProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const isEditing = editing?.isEditing ?? false;
  return (
    <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-3">
      {onBack && (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" onClick={onBack} title={t("common.back")}>
            <ArrowLeftIcon />
            {t("common.back")}
          </Button>
        </div>
      )}
      <div className="group/header flex min-w-0 flex-1 items-center gap-0">
        <span className="me-1 truncate font-mono text-sm text-muted-foreground">
          {editing?.isDirty && <span className="me-1 text-primary">●</span>}
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
        {findable && !isEditing && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onFindToggle}
            title={t("content-browser.find.placeholder")}
            aria-label={t("content-browser.find.placeholder")}
          >
            <SearchIcon />
          </Button>
        )}
        {onSplit && !isEditing && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onSplit}
            title={t("content-browser.split")}
            aria-label={t("content-browser.split")}
          >
            <Columns2Icon />
          </Button>
        )}
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
        {editing && <EditControls editing={editing} />}
        {!isEditing && (
          <Button variant="ghost" size="icon-sm" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>
            <XIcon className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function EditControls({ editing }: { editing: HeaderEditing }) {
  const { t } = useI18n();
  if (editing.isEditing) {
    return (
      <>
        <Button variant="outline" size="sm" onClick={editing.onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={editing.onSave} disabled={!editing.isDirty || editing.saving}>
          {editing.saving ? t("common.saving") : t("common.save")}
        </Button>
      </>
    );
  }
  if (!editing.isEditable) return null;
  return (
    <Button variant="outline" size="sm" onClick={editing.onEnter}>
      {t("common.edit")}
    </Button>
  );
}
