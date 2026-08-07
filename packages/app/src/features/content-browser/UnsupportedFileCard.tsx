import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { FileWarningIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useProjectCtx } from "../../context/project-context";
import { useHostBridge } from "../../context/host-bridge-context";

function joinPath(root: string, rel: string): string {
  return `${root.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
}

export function UnsupportedFileCard({ filePath }: { filePath: string }) {
  const { t } = useI18n();
  const { projectRoot } = useProjectCtx();
  const bridge = useHostBridge();

  const handleOpen = () => {
    const absolute = joinPath(projectRoot, filePath);
    bridge.project?.openFileExternal(absolute).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <FileWarningIcon className="size-12 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t("content-browser.unsupported.title")}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t("content-browser.unsupported.description")}</p>
      </div>
      {bridge.capabilities.openFileExternal && (
        <Button variant="outline" size="sm" onClick={handleOpen}>
          <ExternalLinkIcon />
          {t("content-browser.unsupported.openExternally")}
        </Button>
      )}
    </div>
  );
}
