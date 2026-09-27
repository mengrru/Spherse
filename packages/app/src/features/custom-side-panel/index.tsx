import { useEffect, useRef, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import { useBusSubscription } from "../../hooks/useBusSubscription";
import { useCustomSidePanelStore } from "../../stores/custom-side-panel-store";
import { useCustomSidePanel } from "../../queries/custom-side-panel";

export function CustomSidePanel({ children }: { children: React.ReactNode }) {
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const active = useCustomSidePanelStore((state) => state.isActive(projectId));
  const { data, isError } = useCustomSidePanel(projectId, client);

  const resolvedPath = isError ? null : data?.path;
  if (!(active && resolvedPath != null)) return <>{children}</>;

  return <CustomSidePanelFrame key={projectId} path={resolvedPath} />;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function CustomSidePanelFrame({ path }: { path: string }) {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
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
    <iframe
      key={reloadKey}
      src={client.getPreviewUrl(path)}
      className="h-full w-full border-0"
      title={t("custom-side-panel.title")}
      sandbox="allow-scripts allow-same-origin"
      onError={() => setLoadError(true)}
    />
  );
}
