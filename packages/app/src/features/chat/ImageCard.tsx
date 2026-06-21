import { DownloadIcon, Loader2Icon, AlertCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import type { ImageCard } from "../../lib/types";
import { useProjectCtx } from "../../context/project-context";

interface ImageCardRendererProps {
  card: ImageCard;
}

export function ImageCardRenderer({ card }: ImageCardRendererProps) {
  const { t } = useI18n();
  const { client, projectRoot } = useProjectCtx();

  async function handleExport() {
    if (!client || !projectRoot || !card.path) return;

    const ext = card.path.split(".").pop() ?? "png";
    const defaultPath = `${projectRoot}/image-${Date.now()}.${ext}`;

    const filePath = await window.electronAPI.showSaveDialog({
      defaultPath,
      filters: [
        { name: ext.toUpperCase(), extensions: [ext] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (!filePath) return;

    if (!filePath.startsWith(projectRoot + "/") && filePath !== projectRoot) {
      toast.error(t("chat.fileMustBeInProject"));
      return;
    }

    try {
      await client.exportImage(card.path, filePath);
      toast.success(t("chat.imageExportSuccess"));
    } catch (err) {
      toast.error(t("chat.imageExportFailed", { message: (err as Error).message }));
    }
  }

  if (card.status === "generating") {
    return (
      <div className="my-2 flex h-48 items-center justify-center rounded-lg border border-border bg-muted">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2Icon className="size-6 animate-spin" />
          <span className="text-xs">{t("chat.imageGenerating")}</span>
        </div>
      </div>
    );
  }

  if (card.status === "error") {
    return (
      <div className="my-2 flex h-32 items-center justify-center rounded-lg border border-destructive/50 bg-destructive/5">
        <div className="flex flex-col items-center gap-2 text-destructive">
          <AlertCircleIcon className="size-5" />
          <span className="text-xs">{card.errorMessage ?? t("chat.imageGenerateFailed")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border">
      <div className="group/img relative">
        <div className="absolute right-1.5 top-1.5 z-10 rounded-md bg-background/80 p-0.5 opacity-0 backdrop-blur-sm transition-opacity group-hover/img:opacity-100">
          <button
            type="button"
            onClick={handleExport}
            className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            title={t("chat.exportImage")}
          >
            <DownloadIcon className="size-3.5" />
          </button>
        </div>
        {card.path && client ? (
          <img
            src={client.getPreviewUrl(card.path)}
            alt={card.prompt}
            className="max-w-full rounded-md"
          />
        ) : undefined}
      </div>
    </div>
  );
}
