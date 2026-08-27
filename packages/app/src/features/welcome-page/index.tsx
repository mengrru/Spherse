import { useEffect, useRef, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import { useWelcomePage } from "../../queries/welcome-page";
import { useBusSubscription } from "../../hooks/useBusSubscription";

const HTML_EXTENSIONS = new Set(["html", "htm"]);

function getFileExtension(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return ext;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function WelcomePage({
  fallback,
}: {
  fallback: React.ReactNode;
}) {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const { data, isError } = useWelcomePage(projectId, client);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const path = isError ? null : data?.path;

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

  if (path === undefined) return null;
  if (path === null) return <>{fallback}</>;

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>{t("welcome-page.loadFailed")}</p>
      </div>
    );
  }

  const ext = getFileExtension(path);
  const isHtml = HTML_EXTENSIONS.has(ext);
  const previewUrl = client.getPreviewUrl(path);

  if (isHtml) {
    return (
      <iframe
        key={reloadKey}
        src={previewUrl}
        className="flex-1 w-full border-0"
        title="Welcome Page"
        sandbox="allow-scripts allow-same-origin"
        onError={() => setLoadError(true)}
      />
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <img
        key={reloadKey}
        src={previewUrl}
        alt="Welcome Page"
        className="max-h-full max-w-full object-contain"
        onError={() => setLoadError(true)}
      />
    </div>
  );
}
