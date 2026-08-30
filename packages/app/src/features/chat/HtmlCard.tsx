import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DownloadIcon, Maximize2Icon, XIcon, ChevronRightIcon, ChevronDownIcon } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@spherse/i18n/react";
import type { HtmlCard } from "./types";
import { Button } from "../../components/ui/button";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import { useHostBridge } from "../../context/host-bridge-context";
import { useChatRuntime } from "./runtime-context";
import { isPathInsideProject, toProjectRelative, joinProjectPath } from "../../lib/project-path";
import { ensureCharset, buildFileSrcDoc, buildInlineSrcDoc, isImageFile } from "./html-card-src";

interface HtmlCardRendererProps {
  card: HtmlCard;
  defaultCollapsed?: boolean;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";
}

export function HtmlCardRenderer({ card, defaultCollapsed = false }: HtmlCardRendererProps) {
  const { t } = useI18n();
  const { projectRoot, projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const bridge = useHostBridge();
  const runtime = useChatRuntime();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fetchedHtml, setFetchedHtml] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const userTouched = useRef(false);

  // 当卡片被更新的同路径卡片取代（defaultCollapsed 由 false 变 true）时自动折叠，
  // 除非用户已手动展开/折叠过这张卡片（尊重用户意图）。
  useEffect(() => {
    if (!userTouched.current) setCollapsed(defaultCollapsed);
  }, [defaultCollapsed]);

  const previewUrl = card.file_path && client ? client.getPreviewUrl(card.file_path) : null;
  const isImage = !!card.file_path && isImageFile(card.file_path);

  useEffect(() => {
    if (collapsed) return;
    if (!previewUrl || card.html || isImage) return;
    let cancelled = false;
    setFetchedHtml(null);
    setFetchError(false);
    fetch(previewUrl)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`status ${res.status}`))))
      .then((html) => {
        if (!cancelled) setFetchedHtml(html);
      })
      .catch(() => {
        if (!cancelled) setFetchError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [collapsed, previewUrl, card.html, isImage]);

  useEffect(() => {
    if (!expanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

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

  const explicitWidth = card.width ?? card.max_width;
  const width = explicitWidth ? `${explicitWidth}px` : "100%";
  const height = Math.min(card.height ?? 400, card.max_height ?? 600);

  async function handleSave() {
    if (!card.html) return;

    const suggestedName = card.title
      ? sanitizeFileName(card.title) + ".html"
      : "untitled.html";

    if (!bridge.showSaveDialog) {
      try {
        const blob = new Blob([ensureCharset(card.html)], { type: "text/html" });
        await bridge.saveBlob?.(suggestedName, blob);
      } catch (err) {
        toast.error(t("chat.saveFailed", { message: (err as Error).message }));
      }
      return;
    }

    if (!client || !projectRoot) return;

    const defaultPath = joinProjectPath(projectRoot, suggestedName);

    const filePath = await bridge.showSaveDialog({
      defaultPath,
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    });
    if (!filePath) return;

    if (!isPathInsideProject(projectRoot, filePath)) {
      toast.error(t("chat.fileMustBeInProject"));
      return;
    }

    const html = ensureCharset(card.html);

    const relativePath = toProjectRelative(projectRoot, filePath);
    try {
      await client.saveContent(relativePath, html);
      toast.success(t("chat.saveSuccess"));
    } catch (err) {
      toast.error(t("chat.saveFailed", { message: (err as Error).message }));
    }
  }

  const actionBtnClass =
    "text-muted-foreground opacity-0 transition-opacity hover:bg-transparent hover:text-foreground group-hover/card:opacity-100 [.group-title_&]:opacity-100";

  const saveButton = card.html ? (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleSave}
      className={actionBtnClass}
      title={t("common.save")}
      aria-label={t("common.save")}
    >
      <DownloadIcon className="size-3.5" />
    </Button>
  ) : null;

  const collapseButton = defaultCollapsed ? (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={() => {
        userTouched.current = true;
        setCollapsed(true);
      }}
      className={actionBtnClass}
      title={t("chat.htmlCard.collapse")}
    >
      <ChevronDownIcon className="size-3.5" />
    </Button>
  ) : null;

  const expandButton = (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={() => setExpanded(true)}
      className={actionBtnClass}
      title={t("chat.htmlCard.expand")}
    >
      <Maximize2Icon className="size-3.5" />
    </Button>
  );

  const headerActions = (
    <div className="flex items-center gap-1.5">
      {collapseButton}
      {saveButton}
      {expandButton}
    </div>
  );

  function renderIframe(h: string | number = height) {
    const cssHeight = typeof h === "number" ? `${h}px` : h;
    const sandbox = "allow-scripts allow-same-origin";
    const iframeStyle = {
      width: "100%",
      height: cssHeight,
      border: "none",
      display: "block" as const,
    };
    const onLoad = () => injectRuntime(iframeRef.current);

    // 图片 file_path 直接用 <img> 加载 preview URL，避免把二进制当文本读取产生乱码。
    if (isImage && previewUrl) {
      return (
        <img
          src={previewUrl}
          alt={card.title ?? ""}
          style={{
            display: "block",
            maxWidth: "100%",
            maxHeight: cssHeight,
            width: "auto",
            height: "auto",
            margin: "0 auto",
          }}
        />
      );
    }

    // file_path 卡片统一经 srcDoc 同源渲染：preview 服务器（localhost）与父窗口不同源，
    // 直接用 src 加载会让 injectRuntime 写入 window.__SPHERSE__ 触发 SecurityError 被吞掉，
    // 运行时上下文无法注入。改用 srcDoc 后 iframe 继承父窗口 origin，注入路径与 content 模式一致。
    // <base>（buildFileSrcDoc 注入）把 base URL 指向 preview 目录，保证相对资源（img/css/js）仍可解析。
    // 流式期间 card.html 由 render_card 工具回传，直接复用；历史恢复时 html 缺失，由 useEffect fetch 拉取。
    // fetch 失败时降级为 src（丢失运行时注入，但至少保证卡片可见）。
    if (card.file_path && client && previewUrl) {
      const effectiveHtml = card.html ?? fetchedHtml;
      if (effectiveHtml !== null) {
        return (
          <iframe
            ref={iframeRef}
            srcDoc={buildFileSrcDoc(effectiveHtml, previewUrl)}
            sandbox={sandbox}
            onLoad={onLoad}
            style={iframeStyle}
          />
        );
      }
      if (fetchError) {
        return (
          <iframe
            ref={iframeRef}
            src={previewUrl}
            sandbox={sandbox}
            onLoad={onLoad}
            style={iframeStyle}
          />
        );
      }
      return (
        <div
          className="flex items-center justify-center text-xs text-muted-foreground"
          style={{ height: iframeStyle.height }}
        >
          {t("chat.loading")}
        </div>
      );
    }

    if (card.html) {
      const previewBaseUrl = client ? `${client.getPreviewUrl("")}` : "";
      return (
        <iframe
          ref={iframeRef}
          srcDoc={buildInlineSrcDoc(card.html, previewBaseUrl)}
          sandbox={sandbox}
          onLoad={onLoad}
          style={iframeStyle}
        />
      );
    }

    return null;
  }

  // 同 file_path 的较早卡片：折叠为占位条，不挂载 iframe；点击展开后懒加载。
  if (collapsed) {
    return (
      <div className="group/card my-2 overflow-hidden rounded-lg border border-border">
        <button
          type="button"
          onClick={() => {
            userTouched.current = true;
            setCollapsed(false);
          }}
          className="flex w-full items-center gap-2 bg-muted px-3 py-2 text-start transition-colors hover:bg-accent"
          title={t("chat.htmlCard.showCard")}
        >
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs text-muted-foreground">{card.file_path}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="group/card my-2 overflow-hidden rounded-lg border border-border"
      style={{ maxWidth: "100%", width }}
    >
      {card.title ? (
        <div className="group-title flex items-center justify-between border-b border-border bg-muted px-3 py-1.5">
          <span className="truncate text-xs font-semibold text-muted-foreground">
            {card.title}
          </span>
          {headerActions}
        </div>
      ) : undefined}
      <div className="relative">
        {!card.title && (
          <div className="absolute right-1.5 top-1.5 z-10 rounded-md bg-background/80 p-0.5 backdrop-blur-sm">
            {headerActions}
          </div>
        )}
        {renderIframe()}
      </div>
      {expanded &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex flex-col bg-background">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
              <span className="truncate text-sm font-medium text-foreground">
                {card.title ?? ""}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setExpanded(false)}
                title={t("chat.close")}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 p-2">
              {renderIframe("100%")}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
