import { useEffect, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { INVALID_NAME_RE } from "../../components/file-tree/tree-model";
import type { ApiClient } from "../../lib/api";

export function CreateSkillDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ApiClient;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setContent("");
      setSubmitting(false);
    }
  }, [open]);

  const trimmedName = name.trim();
  const nameInvalid = name !== "" && (INVALID_NAME_RE.test(name) || name.startsWith("."));
  const canSubmit = trimmedName !== "" && !nameInvalid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await client.createSkill(trimmedName, description, content);
      toast.success(t("skill-panel.create.success", { name: trimmedName }));
      onOpenChange(false);
    } catch (err) {
      const message = (err as Error).message ?? "";
      if (message.toLowerCase().includes("already exists")) {
        toast.error(t("skill-panel.create.exists", { name: trimmedName }));
      } else {
        toast.error(t("skill-panel.create.failed", { message }));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("skill-panel.createDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="skill-name">{t("skill-panel.createDialog.nameLabel")}</Label>
            <Input
              id="skill-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {nameInvalid && (
              <p className="text-xs text-destructive">{t("skill-panel.nameInvalid")}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-description">
              {t("skill-panel.createDialog.descriptionLabel")}
            </Label>
            <Input
              id="skill-description"
              placeholder={t("skill-panel.createDialog.descriptionPlaceholder")}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skill-content">{t("skill-panel.createDialog.contentLabel")}</Label>
            <Textarea
              id="skill-content"
              className="h-50"
              placeholder={t("skill-panel.createDialog.contentPlaceholder")}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("skill-panel.createDialog.cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {t("skill-panel.createDialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
