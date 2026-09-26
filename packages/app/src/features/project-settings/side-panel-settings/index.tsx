import { useEffect, useState } from "react";import { toast } from "sonner";
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
import { updateCustomSidePanelSettings } from "../../../queries/custom-side-panel";

const SIDE_PANEL_EXTENSIONS = new Set(["html", "htm"]);

function normalizeSidePanelPath(input: string): string | null {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed === "." || trimmed.startsWith("/") || trimmed.includes("..")) return null;
  const normalized = trimmed.replace(/^\.\//, "").replace(/\/+/g, "/");
  if (!normalized) return null;
  if (normalized === ".spherse" || normalized.startsWith(".spherse/")) return null;
  const ext = normalized.split(".").pop()?.toLowerCase();
  if (!ext || !SIDE_PANEL_EXTENSIONS.has(ext)) return null;
  return normalized;
}

export function SidePanelSettingsDialog({
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
  const [path, setPath] = useState("");
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    client
      .getSidePanelSettings()
      .then((settings) => {
        setSavedPath(settings.path);
        setPath(settings.path ?? "");
      })
      .catch((err: unknown) =>
        toast.error(t("side-panel-settings.loadFailed", { message: (err as Error).message })),
      );
  }, [client, open, t]);

  const handleSave = async () => {
    const trimmed = path.trim();
    const valueToSave = trimmed === "" ? null : trimmed;

    if (valueToSave !== null) {
      const normalized = normalizeSidePanelPath(valueToSave);
      if (!normalized) {
        toast.error(t("side-panel-settings.invalidPath"));
        return;
      }
    }

    setSaving(true);
    try {
      const result = await updateCustomSidePanelSettings(projectId, client, valueToSave);
      setSavedPath(result.path);
      toast.success(t("side-panel-settings.saved"));
      onOpenChange(false);
    } catch (err) {
      toast.error(t("side-panel-settings.saveFailed", { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      const result = await updateCustomSidePanelSettings(projectId, client, null);
      setSavedPath(result.path);
      setPath("");
      toast.success(t("side-panel-settings.saved"));
      onOpenChange(false);
    } catch (err) {
      toast.error(t("side-panel-settings.saveFailed", { message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("side-panel-settings.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("side-panel-settings.description")}
          </p>
          <FieldGroup>
            <Field>
              <FieldLabel>{t("side-panel-settings.pathLabel")}</FieldLabel>
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={t("side-panel-settings.pathPlaceholder")}
              />
            </Field>
          </FieldGroup>
        </div>
        <DialogFooter>
          {savedPath && (
            <Button type="button" variant="outline" onClick={handleClear} disabled={saving} className="mr-auto">
              {t("side-panel-settings.clear")}
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
