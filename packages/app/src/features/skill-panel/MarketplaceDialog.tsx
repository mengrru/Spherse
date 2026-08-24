import { useEffect, useMemo, useState } from "react";
import { DownloadIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useProjectCtx } from "../../context/project-context";
import { ApiError, type ApiClient } from "../../lib/api";
import {
  invalidateMarketplaceQueries,
  invalidateProjectSkillQueries,
  useMarketplaceSkills,
  useProjectSkills,
} from "../../queries/skills";
import { invalidateProjectFileQueries } from "../../queries/content";
import { deriveSkillCardState } from "./marketplace-state";

type CardStatus = "idle" | "installing" | "error";

export function MarketplaceDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ApiClient;
}) {
  const { projectId } = useProjectCtx();
  const { t } = useI18n();
  const skillsQuery = useProjectSkills(projectId, client);
  const marketQuery = useMarketplaceSkills(projectId, client, open);
  const [statuses, setStatuses] = useState<Record<string, CardStatus>>({});

  useEffect(() => {
    if (open) {
      setStatuses({});
      void invalidateMarketplaceQueries(projectId);
      void invalidateProjectSkillQueries(projectId);
    }
  }, [open, projectId]);

  const localByName = useMemo(() => {
    const map = new Map<string, { version?: string }>();
    for (const skill of skillsQuery.data ?? []) map.set(skill.name, skill);
    return map;
  }, [skillsQuery.data]);

  const setStatus = (name: string, status: CardStatus) => {
    setStatuses((prev) => ({ ...prev, [name]: status }));
  };

  const handleInstall = async (name: string, version: string, isUpdate: boolean) => {
    setStatus(name, "installing");
    try {
      const skill = await client.installMarketplaceSkill(name, version);
      await invalidateProjectSkillQueries(projectId);
      await invalidateProjectFileQueries(projectId, `.spherse/skills/${name}`);
      setStatus(name, "idle");
      if (isUpdate) {
        toast.success(t("skill-panel.marketplace.updateSuccess", { name, version: skill.version ?? version }));
      } else {
        toast.success(t("skill-panel.marketplace.installSuccess", { name }));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t("skill-panel.marketplace.manifestChanged"));
        await invalidateMarketplaceQueries(projectId);
        setStatus(name, "idle");
        return;
      }
      setStatus(name, "error");
      const message = (err as Error).message ?? "";
      toast.error(
        isUpdate
          ? t("skill-panel.marketplace.updateFailed", { name, message })
          : t("skill-panel.marketplace.installFailed", { name, message }),
      );
    }
  };

  const renderBody = () => {
    if (marketQuery.isPending) {
      return <p className="py-10 text-center text-muted-foreground">{t("skill-panel.marketplace.loading")}</p>;
    }
    if (marketQuery.isError) {
      return (
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-muted-foreground">{t("skill-panel.marketplace.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => marketQuery.refetch()}>
            {t("skill-panel.marketplace.retry")}
          </Button>
        </div>
      );
    }
    const entries = marketQuery.data?.skills ?? [];
    if (entries.length === 0) {
      return <p className="py-10 text-center text-muted-foreground">{t("skill-panel.marketplace.empty")}</p>;
    }
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {entries.map((entry) => {
          const state = deriveSkillCardState(localByName.get(entry.name), entry.version);
          const status = statuses[entry.name] ?? "idle";
          const busy = status === "installing";
          return (
            <div
              key={entry.name}
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
              data-skill={entry.name}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium">{entry.name}</span>
                <span className="shrink-0 font-mono text-[0.625rem] text-muted-foreground">
                  v{entry.version}
                </span>
              </div>
              <p className="line-clamp-3 flex-1 text-muted-foreground">{entry.description}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.625rem] text-muted-foreground">
                  {t("skill-panel.marketplace.updatedAt", {
                    date: new Date(entry.updatedAt).toLocaleDateString(),
                  })}
                </span>
                {state === "installed" ? (
                  <span className="text-xs text-muted-foreground">{t("skill-panel.marketplace.installed")}</span>
                ) : (
                  <Button
                    size="sm"
                    variant={status === "error" ? "destructive" : state === "update" ? "default" : "outline"}
                    disabled={busy}
                    onClick={() => handleInstall(entry.name, entry.version, state === "update")}
                  >
                    {busy ? (
                      <LoaderCircleIcon className="animate-spin" />
                    ) : state === "update" ? (
                      <RefreshCwIcon />
                    ) : (
                      <DownloadIcon />
                    )}
                    {state === "update"
                      ? t("skill-panel.marketplace.update")
                      : t("skill-panel.marketplace.install")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("skill-panel.marketplace.title")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">{renderBody()}</div>
        <p className="text-[0.625rem] text-muted-foreground">{t("skill-panel.marketplace.note")}</p>
      </DialogContent>
    </Dialog>
  );
}
