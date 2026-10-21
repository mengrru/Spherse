import { useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { FileWarningIcon, ExternalLinkIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useProjectCtx } from "../../context/project-context";
import { useHostBridge } from "../../context/host-bridge-context";
import { useApiClient } from "../../lib/use-connection";

function joinPath(root: string, rel: string): string {
  return `${root.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
}

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

export function UnsupportedFileCard({ filePath }: { filePath: string }) {
  const { t } = useI18n();
  const { projectId, projectRoot } = useProjectCtx();
  const bridge = useHostBridge();
  const client = useApiClient(projectId);
  const [downloading, setDownloading] = useState(false);

  const desktopDownload = bridge.project?.downloadFile;
  const canDownload = Boolean(desktopDownload ?? bridge.saveBlob);

  const handleOpen = () => {
    const absolute = joinPath(projectRoot, filePath);
    bridge.project?.openFileExternal(absolute).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err));
    });
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      if (desktopDownload) {
        await desktopDownload(joinPath(projectRoot, filePath));
        return;
      }
      if (!client || !bridge.saveBlob) return;
      const blob = await client.downloadFile(filePath);
      await bridge.saveBlob(basename(filePath), blob);
    } catch (err) {
      toast.error(t("content-browser.unsupported.downloadFailed", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <FileWarningIcon className="size-12 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t("content-browser.unsupported.title")}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t("content-browser.unsupported.description")}</p>
      </div>
      <div className="flex items-center gap-2">
        {canDownload && (
          <Button variant="outline" size="sm" onClick={handleDownload} disabled={downloading}>
            {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
            {t("content-browser.unsupported.download")}
          </Button>
        )}
        {bridge.capabilities.openFileExternal && (
          <Button variant="outline" size="sm" onClick={handleOpen}>
            <ExternalLinkIcon />
            {t("content-browser.unsupported.openExternally")}
          </Button>
        )}
      </div>
    </div>
  );
}
