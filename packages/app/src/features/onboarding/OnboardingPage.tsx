import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { useAppStore } from "../../stores/app-store";
import { useHostBridge } from "../../context/host-bridge-context";
import { useGlobalApiClient } from "../../lib/use-connection";
import { useFeature } from "../../lib/use-feature";
import { ProjectMarketDialog } from "../project-market/ProjectMarketDialog";
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

export function OnboardingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bridge = useHostBridge();
  const openProject = useAppStore((state) => state.openProject);
  const globalClient = useGlobalApiClient();
  const marketEnabled = useFeature("project-marketplace");
  const [marketOpen, setMarketOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const busyRef = useRef(false);

  const handleOpenOrCreate = () => {
    if (bridge.kind === "browser") {
      setProjectName("");
      setCreateOpen(true);
      return;
    }
    void handleSelectDirectory();
  };

  const handleSelectDirectory = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const projectId = await openProject(bridge);
      if (projectId) navigate(`/project/${projectId}`);
    } catch {
      toast.error(t("onboarding.error.unexpected"));
    } finally {
      busyRef.current = false;
    }
  };

  const handleBrowserCreate = async () => {
    const name = projectName.trim();
    if (!name || busyRef.current || !bridge.project) return;
    busyRef.current = true;
    try {
      const result = await bridge.project.openProject(name);
      if (!result) throw new Error("project creation returned no id");
      await useAppStore.getState().refreshProjects(bridge);
      setCreateOpen(false);
      navigate(`/project/${result.projectId}`);
    } catch {
      toast.error(t("onboarding.error.unexpected"));
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center overflow-auto bg-background px-6 pb-16 pt-10 text-foreground">
      <header className="mb-8 text-center">
        <h1 className="mb-2 text-3xl font-semibold">{t("onboarding.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("onboarding.subtitle")}</p>
      </header>
      <div className="grid w-full max-w-3xl grid-cols-2 gap-4">
        <ActionCard
          title={t("onboarding.action.openOrCreate")}
          desc={t("onboarding.desc.openOrCreate")}
          onClick={handleOpenOrCreate}
        />
        {globalClient && marketEnabled && (
          <ActionCard
            title={t("onboarding.action.openMarket")}
            desc={t("onboarding.desc.openMarket")}
            onClick={() => setMarketOpen(true)}
          />
        )}
      </div>
      {globalClient && marketEnabled && (
        <ProjectMarketDialog
          open={marketOpen}
          onOpenChange={setMarketOpen}
          client={globalClient}
        />
      )}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("onboarding.browser.createProject")}</DialogTitle>
            <DialogDescription>{t("onboarding.browser.desc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="onboarding-browser-project-name">
              {t("onboarding.browser.projectName")}
            </Label>
            <Input
              id="onboarding-browser-project-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleBrowserCreate();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("onboarding.browser.cancel")}
            </Button>
            <Button onClick={() => void handleBrowserCreate()} disabled={!projectName.trim()}>
              {t("onboarding.browser.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActionCard({
  title,
  desc,
  onClick,
}: {
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col items-start gap-2 rounded-md border border-border bg-card p-5 text-start transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
    >
      <span className="font-medium text-foreground">{title}</span>
      <span className="text-sm text-muted-foreground">{desc}</span>
    </button>
  );
}
