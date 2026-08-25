import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import type { ApiClient } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Textarea } from "../../../components/ui/textarea";
import { useThemeSettings, updateProjectThemeSettings } from "../../../queries/theme-settings";

export function ThemeSettingsDialog({
  projectId,
  client,
  open,
  onOpenChange,
}: {
  projectId: string;
  client: ApiClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();
  const { data, isPending, error } = useThemeSettings(projectId, client, open);
  const initialLoadFailed = error !== null && data === undefined;
  const savedContent = initialLoadFailed ? "" : data?.content ?? "";

  useEffect(() => {
    if (error) toast.error(t("theme-settings.loadFailed", { message: error.message }));
  }, [error, t]);

  useEffect(() => {
    if (open) setDraft(null);
  }, [open, projectId]);

  const content = draft ?? savedContent;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProjectThemeSettings(projectId, client, content);
      setDraft(content);
      toast.success(t("theme-settings.saved"));
    } catch (err) {
      toast.error(t("theme-settings.saveFailed", { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t("theme-settings.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("theme-settings.description")}
          </p>
          <Textarea
            value={content}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("theme-settings.placeholder")}
            disabled={isPending}
            className="h-[55vh] font-mono text-xs"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || isPending || content === savedContent}
          >
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
