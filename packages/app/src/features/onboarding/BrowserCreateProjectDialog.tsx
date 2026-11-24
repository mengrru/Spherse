import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { useAppStore } from "../../stores/app-store";
import { useHostBridge } from "../../context/host-bridge-context";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";

export function BrowserCreateProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bridge = useHostBridge();
  const [projectName, setProjectName] = useState("");
  const busyRef = useRef(false);

  const handleCreate = async () => {
    const name = projectName.trim();
    if (!name || busyRef.current || !bridge.project) return;
    busyRef.current = true;
    try {
      const result = await bridge.project.openProject(name);
      if (!result) throw new Error("project creation returned no id");
      await useAppStore.getState().refreshProjects(bridge);
      onOpenChange(false);
      setProjectName("");
      navigate(`/project/${result.projectId}`);
    } catch {
      toast.error(t("onboarding.error.unexpected"));
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("onboarding.browser.createProject")}</DialogTitle>
          <DialogDescription>{t("onboarding.browser.desc")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="browser-create-project-name">{t("onboarding.browser.projectName")}</Label>
          <Input
            id="browser-create-project-name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("onboarding.browser.cancel")}
          </Button>
          <Button onClick={() => void handleCreate()} disabled={!projectName.trim()}>
            {t("onboarding.browser.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
