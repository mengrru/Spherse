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

export function ThemeSettingsDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ApiClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [_loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    client
      .getThemeSettings()
      .then((settings) => {
        setSavedContent(settings.content);
        setContent(settings.content);
      })
      .catch((err: unknown) =>
        toast.error(t("theme-settings.loadFailed", { message: (err as Error).message })),
      )
      .finally(() => setLoading(false));
  }, [client, open, t]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await client.updateThemeSettings(content);
      setSavedContent(content);
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
            onChange={(e) => setContent(e.target.value)}
            placeholder=":root { --shadcn-primary: #3b82f6; }"
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
            disabled={saving || content === savedContent}
          >
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
