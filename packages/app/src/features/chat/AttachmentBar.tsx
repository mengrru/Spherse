import { Loader2Icon, XIcon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import type { AttachedImage } from "./types";

export type AttachStatus = "idle" | "compressing" | "uploading" | "error";

interface AttachmentBarProps {
  image: AttachedImage | null;
  status: AttachStatus;
  onRemove: () => void;
}

export function AttachmentBar({ image, status, onRemove }: AttachmentBarProps) {
  const { t } = useI18n();
  const busy = status === "compressing" || status === "uploading";

  return (
    <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-card p-2" data-chat-attachment-bar>
      {busy ? (
        <div className="flex size-16 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Loader2Icon className="size-5 animate-spin" />
        </div>
      ) : image ? (
        <div className="group/att relative size-16 shrink-0">
          <img
            src={image.previewUrl}
            alt=""
            className="size-16 rounded-md border border-border object-cover"
          />
          <button
            type="button"
            onClick={onRemove}
            title={t("chat.removeAttachment")}
            className="absolute end-0.5 top-0.5 rounded-sm bg-background/80 p-0.5 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:text-foreground group-hover/att:opacity-100"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
