import { useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import type { ChatAttachment } from "./types";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";

interface MessageAttachmentsProps {
  attachments: ChatAttachment[];
}

export function MessageAttachments({ attachments }: MessageAttachmentsProps) {
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const [openPath, setOpenPath] = useState<string | null>(null);

  if (!client) return null;
  const images = attachments.filter((a) => a.type === "image");
  if (images.length === 0) return null;

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {images.map((att) => (
          <button
            type="button"
            key={att.path}
            onClick={() => setOpenPath(att.path)}
            className="block overflow-hidden rounded-md border border-border"
          >
            <img
              src={client.getPreviewUrl(att.path)}
              alt=""
              className="max-h-48 max-w-full cursor-zoom-in object-cover"
            />
          </button>
        ))}
      </div>
      {openPath &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setOpenPath(null)}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-6 backdrop-blur-sm"
          >
            <img
              src={client.getPreviewUrl(openPath)}
              alt=""
              className="max-h-full max-w-full rounded-md object-contain"
            />
            <button
              type="button"
              onClick={() => setOpenPath(null)}
              aria-label="close"
              className="absolute end-4 top-4 rounded-full bg-background/80 p-2 text-foreground"
            >
              <XIcon />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
