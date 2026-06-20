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
import { Input } from "../../../components/ui/input";
import { Field, FieldGroup, FieldLabel } from "../../../components/ui/field";
import { WELCOME_PAGE_SETTINGS_CHANGED_EVENT } from "../../../lib/events";

const WELCOME_PAGE_EXTENSIONS = new Set(["html", "htm", "png", "jpg", "jpeg", "gif", "webp", "svg"]);

function normalizeWelcomePagePath(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === "." || trimmed.startsWith("/") || trimmed.includes("..")) return null;
  const normalized = trimmed.replace(/^\.\//, "").replace(/\/+/g, "/");
  if (!normalized) return null;
  if (normalized === ".spherse" || normalized.startsWith(".spherse/")) return null;
  const ext = normalized.split(".").pop()?.toLowerCase();
  if (!ext || !WELCOME_PAGE_EXTENSIONS.has(ext)) return null;
  return normalized;
}

export function WelcomePageSettingsDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ApiClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [path, setPath] = useState("");
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [_loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    client
      .getWelcomePageSettings()
      .then((settings) => {
        setSavedPath(settings.path);
        setPath(settings.path ?? "");
      })
      .catch((err: unknown) =>
        toast.error(t("welcome-page-settings.loadFailed", { message: (err as Error).message })),
      )
      .finally(() => setLoading(false));
  }, [client, open, t]);

  const handleSave = async () => {
    const trimmed = path.trim();
    const valueToSave = trimmed === "" ? null : trimmed;

    if (valueToSave !== null) {
      const normalized = normalizeWelcomePagePath(valueToSave);
      if (!normalized) {
        toast.error(t("welcome-page-settings.invalidPath"));
        return;
      }
    }

    setSaving(true);
    try {
      const result = await client.updateWelcomePageSettings(valueToSave);
      setSavedPath(result.path);
      window.dispatchEvent(new Event(WELCOME_PAGE_SETTINGS_CHANGED_EVENT));
      toast.success(t("welcome-page-settings.saved"));
      onOpenChange(false);
    } catch (err) {
      toast.error(t("welcome-page-settings.saveFailed", { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      const result = await client.updateWelcomePageSettings(null);
      setSavedPath(result.path);
      setPath("");
      window.dispatchEvent(new Event(WELCOME_PAGE_SETTINGS_CHANGED_EVENT));
      toast.success(t("welcome-page-settings.saved"));
      onOpenChange(false);
    } catch (err) {
      toast.error(t("welcome-page-settings.saveFailed", { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("welcome-page-settings.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("welcome-page-settings.description")}
          </p>
          <FieldGroup>
            <Field>
              <FieldLabel>{t("welcome-page-settings.pathLabel")}</FieldLabel>
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={t("welcome-page-settings.pathPlaceholder")}
              />
            </Field>
          </FieldGroup>
        </div>
        <DialogFooter>
          {savedPath && (
            <Button type="button" variant="outline" onClick={handleClear} disabled={saving} className="mr-auto">
              {t("welcome-page-settings.clear")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
