import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { useAppStore } from "../../stores/app-store";
import { useHostBridge } from "../../context/host-bridge-context";
import { useGlobalApiClient } from "../../lib/use-connection";
import { ProjectMarketDialog } from "../project-market/ProjectMarketDialog";

export function OnboardingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bridge = useHostBridge();
  const openProject = useAppStore((state) => state.openProject);
  const globalClient = useGlobalApiClient();
  const [marketOpen, setMarketOpen] = useState(false);
  const busyRef = useRef(false);

  const handleOpenOrCreate = async () => {
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
        {globalClient && (
          <ActionCard
            title={t("onboarding.action.openMarket")}
            desc={t("onboarding.desc.openMarket")}
            onClick={() => setMarketOpen(true)}
          />
        )}
      </div>
      {globalClient && (
        <ProjectMarketDialog
          open={marketOpen}
          onOpenChange={setMarketOpen}
          client={globalClient}
        />
      )}
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
