import { useRef } from "react";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import type { HtmlCard } from "./types";
import { useProjectCtx } from "../../context/project-context";
import { useChatRuntime } from "./runtime-context";

interface HtmlCardRendererProps {
  card: HtmlCard;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";
}

export function HtmlCardRenderer({ card }: HtmlCardRendererProps) {
  const { t } = useI18n();
  const { client, projectRoot, projectId } = useProjectCtx();
  const runtime = useChatRuntime();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  function injectRuntime(iframe: HTMLIFrameElement | null) {
    if (!iframe || !runtime) return;
    const win = iframe.contentWindow as (Window & { __SPHERSE__?: unknown }) | null;
    if (!win) return;
    const payload = {
      sessionId: runtime.sessionId,
      agentId: runtime.agentId,
      projectId,
    };
    try {
      win.__SPHERSE__ = payload;
    } catch {
      /* cross-origin: ignore */
    }
    try {
      win.postMessage({ type: "spherse:runtime", ...payload }, "*");
    } catch {
      /* ignore */
    }
  }

  const width = card.width ? `${Math.min(card.width, card.max_width ?? 800)}px` : "100%";
  const height = Math.min(card.height ?? 400, card.max_height ?? 600);

  async function handleSave() {
    if (!client || !projectRoot || !card.html) return;

    const suggestedName = card.title
      ? sanitizeFileName(card.title) + ".html"
      : "untitled.html";
    const defaultPath = projectRoot + "/" + suggestedName;

    const filePath = await window.electronAPI.showSaveDialog({
      defaultPath,
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    });
    if (!filePath) return;

    if (!filePath.startsWith(projectRoot + "/") && filePath !== projectRoot) {
      toast.error(t("chat.fileMustBeInProject"));
      return;
    }

    const html = card.html.includes("charset")
      ? card.html
      : card.html.replace(/<head([^>]*)>/i, `<head$1><meta charset="UTF-8">`);

    const relativePath = filePath.slice(projectRoot.length + 1);
    try {
      await client.saveContent(relativePath, html || card.html);
      toast.success(t("chat.saveSuccess"));
    } catch (err) {
      toast.error(t("chat.saveFailed", { message: (err as Error).message }));
    }
  }

  const saveButton = card.html ? (
    <button
      type="button"
      onClick={handleSave}
      className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/card:opacity-100 [.group-title_&]:opacity-100"
    >
      <DownloadIcon className="size-3.5" />
    </button>
  ) : null;

  return (
    <div
      className="group/card my-2 overflow-hidden rounded-lg border border-border"
      style={{ maxWidth: `min(${card.max_width ?? 800}px, 100%)`, width }}
    >
      {card.title ? (
        <div className="group-title flex items-center justify-between border-b border-border bg-muted px-3 py-1.5">
          <span className="truncate text-xs font-semibold text-muted-foreground">
            {card.title}
          </span>
          {saveButton}
        </div>
      ) : undefined}
      <div className="relative">
        {!card.title && (
          <div className="absolute right-1.5 top-1.5 z-10 rounded-md bg-background/80 p-0.5 backdrop-blur-sm">
            {saveButton}
          </div>
        )}
        {card.file_path && client ? (
          <iframe
            ref={iframeRef}
            src={client.getPreviewUrl(card.file_path)}
            onLoad={() => injectRuntime(iframeRef.current)}
            style={{
              width: "100%",
              height: `${height}px`,
              border: "none",
              display: "block",
            }}
          />
        ) : (
          <iframe
            ref={iframeRef}
            srcDoc={card.html}
            sandbox="allow-scripts allow-same-origin"
            onLoad={() => injectRuntime(iframeRef.current)}
            style={{
              width: "100%",
              height: `${height}px`,
              border: "none",
              display: "block",
            }}
          />
        )}
      </div>
    </div>
  );
}
