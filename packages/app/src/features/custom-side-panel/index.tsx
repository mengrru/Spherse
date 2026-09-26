import { useEffect, useRef, useState } from "react";
import { PanelLeftCloseIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import { useCustomSidePanelStore } from "../../stores/custom-side-panel-store";
import { Button } from "../../components/ui/button";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function CustomSidePanel({ path }: { path: string }) {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const toggle = useCustomSidePanelStore((state) => state.toggle);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useBusSubscription(projectId, "fs-watch", (_type, payload) => {
    const current = pathRef.current;
    if (!current) return;
    const changedPath = normalizePath((payload as { path?: string } | null)?.path ?? "");
    if (changedPath !== normalizePath(current)) return;
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      setLoadError(false);
      setReloadKey((k) => k + 1);
    }, 300);
  });

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, []);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-muted-foreground">
        <p>{t("custom-side-panel.loadFailed")}</p>
      </div>
    );
  }

  return (
    <div className="group relative h-full w-full">
      <iframe
        key={reloadKey}
        src={client.getPreviewUrl(path)}
        className="h-full w-full border-0"
        title={t("custom-side-panel.title")}
        sandbox="allow-scripts allow-same-origin"
        onError={() => setLoadError(true)}
      />
      <Button
        variant="outline"
        size="icon-sm"
        className="absolute end-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        onClick={() => toggle(projectId)}
        title={t("custom-side-panel.exitTooltip")}
        aria-label={t("custom-side-panel.exitTooltip")}
      >
        <PanelLeftCloseIcon />
      </Button>
    </div>
  );
}
