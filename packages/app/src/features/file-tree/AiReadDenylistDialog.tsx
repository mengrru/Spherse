import type { KeyboardEvent } from "react";
import { Trash2Icon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import type { ApiClient } from "../../lib/api";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { useAiReadDenylist } from "./useAiReadDenylist";

export function AiReadDenylistDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ApiClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const denylist = useAiReadDenylist(client, open);
  const { t } = useI18n();

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      denylist.addInput();
    }
  };

  const handleSave = async () => {
    const saved = await denylist.save();
    if (saved) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("ai-read-denylist.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("ai-read-denylist.description")}
          </p>
          <div className="flex gap-2">
            <Input
              value={denylist.input}
              onChange={(event) => denylist.setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("ai-read-denylist.placeholder")}
            />
            <Button type="button" onClick={denylist.addInput}>
              {t("common.add")}
            </Button>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border border-border">
            {denylist.loading ? (
              <p className="p-3 text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : denylist.paths.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">{t("ai-read-denylist.emptyState")}</p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {denylist.paths.map((path) => (
                  <div key={path} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{path}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("ai-read-denylist.removeLabel", { path })}
                      onClick={() => denylist.removePath(path)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleSave} disabled={denylist.saving}>
            {denylist.saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
