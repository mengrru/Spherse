import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { DownloadIcon, LoaderCircleIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useHostBridge } from "../../context/host-bridge-context";
import { ApiError, type GlobalApiClient } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import {
  invalidateMarketplaceProjectQueries,
  useMarketplaceProjects,
} from "../../queries/marketplace-projects";
import { buildProjectRoute } from "../activity-bar/use-project-actions";
import { deriveCategories, filterByCategory } from "./categories";

type CardStatus = "idle" | "downloading" | "error";

export function ProjectMarketDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: GlobalApiClient;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bridge = useHostBridge();
  const openProjectAtPath = useAppStore((s) => s.openProjectAtPath);
  const marketQuery = useMarketplaceProjects(client, open);
  const [statuses, setStatuses] = useState<Record<string, CardStatus>>({});
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStatuses({});
      setSelectedCategory(null);
      void invalidateMarketplaceProjectQueries();
    }
  }, [open]);

  const entries = useMemo(() => marketQuery.data?.projects ?? [], [marketQuery.data]);
  const categories = useMemo(() => deriveCategories(entries), [entries]);
  const visible = useMemo(
    () => filterByCategory(entries, selectedCategory),
    [entries, selectedCategory],
  );

  const setStatus = (name: string, status: CardStatus) => {
    setStatuses((prev) => ({ ...prev, [name]: status }));
  };

  const handleDownload = async (name: string, version: string) => {
    const destDir = (await bridge.project?.selectDirectory()) ?? null;
    if (!destDir) return;
    setStatus(name, "downloading");
    let projectRoot: string;
    try {
      ({ projectRoot } = await client.installMarketplaceProject({ name, version, destDir }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t("project-market.manifestChanged"));
        await invalidateMarketplaceProjectQueries();
        setStatus(name, "idle");
        return;
      }
      setStatus(name, "error");
      toast.error(
        t("project-market.downloadFailed", { name, message: (err as Error).message ?? "" }),
      );
      return;
    }
    try {
      const projectId = await openProjectAtPath(bridge, projectRoot);
      if (projectId) {
        const project = useAppStore.getState().projects.get(projectId);
        navigate(buildProjectRoute(projectId, project?.lastRoute));
        onOpenChange(false);
      } else {
        toast.error(t("project-market.openFailed", { name }));
      }
    } catch (err) {
      console.error("[project-market] failed to open installed project:", err);
      toast.error(t("project-market.openFailed", { name }));
    } finally {
      setStatus(name, "idle");
    }
  };

  const renderBody = () => {
    if (marketQuery.isPending) {
      return <p className="py-10 text-center text-muted-foreground">{t("project-market.loading")}</p>;
    }
    if (marketQuery.isError) {
      return (
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-muted-foreground">{t("project-market.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => marketQuery.refetch()}>
            {t("project-market.retry")}
          </Button>
        </div>
      );
    }
    if (entries.length === 0) {
      return <p className="py-10 text-center text-muted-foreground">{t("project-market.empty")}</p>;
    }
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {visible.map((entry) => {
          const status = statuses[entry.name] ?? "idle";
          const busy = status === "downloading";
          return (
            <div
              key={entry.name}
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
              data-market-project={entry.name}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium">{entry.name}</span>
                <span className="shrink-0 font-mono text-[0.625rem] text-muted-foreground">
                  v{entry.version}
                </span>
              </div>
              <p className="line-clamp-3 flex-1 text-muted-foreground">{entry.description}</p>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate rounded-full bg-muted px-2 py-0.5 text-[0.625rem] text-muted-foreground">
                    {entry.category}
                  </span>
                  <span className="shrink-0 text-[0.625rem] text-muted-foreground">
                    {t("project-market.updatedAt", {
                      date: new Date(entry.updatedAt).toLocaleDateString(),
                    })}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant={status === "error" ? "destructive" : "outline"}
                  disabled={busy}
                  onClick={() => handleDownload(entry.name, entry.version)}
                >
                  {busy ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
                  {busy ? t("project-market.downloading") : t("project-market.download")}
                </Button>
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
          <DialogTitle>{t("project-market.title")}</DialogTitle>
        </DialogHeader>
        {entries.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1" data-market-categories>
            <button
              type="button"
              onClick={() => setSelectedCategory(null)}
              className={
                selectedCategory === null
                  ? "shrink-0 rounded-full border border-primary bg-primary px-2.5 py-0.5 text-xs text-primary-foreground"
                  : "shrink-0 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
              }
            >
              {t("project-market.categoryAll")}
            </button>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setSelectedCategory(category)}
                className={
                  selectedCategory === category
                    ? "shrink-0 rounded-full border border-primary bg-primary px-2.5 py-0.5 text-xs text-primary-foreground"
                    : "shrink-0 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
                }
              >
                {category}
              </button>
            ))}
          </div>
        )}
        <div className="max-h-[60vh] overflow-y-auto">{renderBody()}</div>
        <p className="text-[0.625rem] text-muted-foreground">{t("project-market.footerNote")}</p>
      </DialogContent>
    </Dialog>
  );
}
