import { useState, useEffect, useCallback, useRef } from "react";
import type { ApiClient } from "../lib/api";
import type { AgentProfile } from "../lib/types";
import { TextSelectionToolbar } from "../components/TextSelectionToolbar";
import { SelectionSessionDialog } from "../components/SelectionSessionDialog";
import { MarkdownContent } from "../components/MarkdownContent";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { ArrowLeftIcon } from "lucide-react";

interface ContentBrowserProps {
  client: ApiClient;
  filePath: string;
  onBack: () => void;
  agents: AgentProfile[];
  onStartSession?: (agentId: string, selectedText: string, sourcePath: string, comment?: string) => void;
}

export function ContentBrowser({ client, filePath, onBack, agents, onStartSession }: ContentBrowserProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [htmlView, setHtmlView] = useState<"preview" | "source">("preview");

  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const [selectionState, setSelectionState] = useState<{
    text: string;
    position: { x: number; y: number };
  } | null>(null);
  const [showSessionDialog, setShowSessionDialog] = useState(false);

  const isMarkdown =
    filePath.endsWith(".md") ||
    filePath.endsWith(".markdown") ||
    filePath.endsWith(".agents.md");
  const isHtml = filePath.endsWith(".html") || filePath.endsWith(".htm");
  const isEditable = !isHtml;
  const isDirty = isEditing && editedContent !== (content ?? "");

  useEffect(() => {
    setIsEditing(false);
    setConflict(false);
    setSaveError(null);
    setShowLeaveConfirm(false);
    setLoading(true);
    setError(null);
    client
      .getContent(filePath)
      .then((data) => {
        if (data) {
          setContent(data.content);
        } else {
          setError("File not found");
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filePath, client]);

  const handleEnterEdit = () => {
    setEditedContent(content ?? "");
    setSaveError(null);
    setConflict(false);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (isDirty) {
      setShowCancelConfirm(true);
    } else {
      setIsEditing(false);
      setSaveError(null);
      setConflict(false);
    }
  };

  const handleConfirmCancel = () => {
    setShowCancelConfirm(false);
    setIsEditing(false);
    setSaveError(null);
    setConflict(false);
  };

  const handleBackClick = () => {
    if (isDirty) {
      setShowLeaveConfirm(true);
    } else {
      onBack();
    }
  };

  const handleConfirmLeave = () => {
    setShowLeaveConfirm(false);
    setIsEditing(false);
    onBack();
  };

  const handleSave = useCallback(async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await client.saveContent(filePath, editedContent);
      setContent(editedContent);
      setIsEditing(false);
      setConflict(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [client, filePath, editedContent, isDirty, saving]);

  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isEditing, handleSave]);

  useEffect(() => {
    if (isEditing || showSessionDialog) return;

    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setSelectionState(null);
        return;
      }

      const contentEl = contentRef.current;
      if (!contentEl) return;

      const range = selection.getRangeAt(0);
      if (!contentEl.contains(range.commonAncestorContainer)) return;

      const text = selection.toString().trim();
      const endRange = range.cloneRange();
      endRange.collapse(false);
      const endRect = endRange.getBoundingClientRect();
      const y = endRect.top > 50 ? endRect.top - 36 : endRect.bottom + 4;

      setSelectionState({
        text,
        position: { x: endRect.left, y },
      });
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [isEditing, showSessionDialog]);

  useEffect(() => {
    if (!isEditing) return;
    const ws = client.createFsWatchWebSocket(() => {
      setConflict(true);
    });
    return () => ws.close();
  }, [isEditing, client]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-3">
        <Button variant="outline" onClick={handleBackClick}>
          <ArrowLeftIcon />
          返回
        </Button>
        <span className="flex-1 font-mono text-sm text-muted-foreground">
          {isDirty && <span className="mr-1 text-primary">●</span>}
          {filePath}
        </span>
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCancelEdit}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || saving}
            >
              {saving ? "保存中..." : "保存"}
            </Button>
          </div>
        ) : isEditable && !isHtml ? (
          <Button variant="outline" size="sm" onClick={handleEnterEdit}>
            编辑
          </Button>
        ) : null}
        {isHtml && !isEditing && (
          <div className="flex overflow-hidden rounded-md border border-border">
            <Button
              variant={htmlView === "preview" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none"
              onClick={() => setHtmlView("preview")}
            >
              预览
            </Button>
            <Button
              variant={htmlView === "source" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none border-l border-border"
              onClick={() => setHtmlView("source")}
            >
              源码
            </Button>
          </div>
        )}
      </div>
      {conflict && isEditing && (
        <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm">
          <span className="flex-1">文件已被外部修改</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConflict(false)}
          >
            保留我的修改
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const data = await client.getContent(filePath);
              if (data) {
                setContent(data.content);
                setEditedContent(data.content);
              }
              setConflict(false);
            }}
          >
            重新加载文件
          </Button>
        </div>
      )}
      {saveError && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          保存失败: {saveError}
        </div>
      )}
      {isHtml && htmlView === "preview" && !isEditing && !loading && !error ? (
        <iframe
          src={client.getPreviewUrl(filePath)}
          className="flex-1 w-full border-0"
          title="HTML Preview"
        />
      ) : isEditing ? (
        <Textarea
          className="min-h-0 flex-1 resize-none rounded-none border-none bg-background p-4 font-mono text-sm leading-relaxed shadow-none focus-visible:ring-0"
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <div ref={contentRef} className="flex-1 overflow-y-auto p-4">
          {loading && <p className="p-8 text-center text-muted-foreground">加载中...</p>}
          {error && <p className="p-8 text-center text-destructive">{error}</p>}
          {content && !loading && (
            isMarkdown ? (
              <div className="rounded-lg border border-border bg-card p-6 text-card-foreground">
                <MarkdownContent variant="document">{content}</MarkdownContent>
              </div>
            ) : (
              <pre className="rounded-lg border border-border bg-card p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap">{content}</pre>
            )
          )}
        </div>
      )}
      <AlertDialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>有未保存的修改</AlertDialogTitle>
            <AlertDialogDescription>确定离开当前文件并放弃这些修改吗？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleConfirmLeave}>
              放弃修改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>有未保存的修改</AlertDialogTitle>
            <AlertDialogDescription>确定取消编辑并放弃这些修改吗？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleConfirmCancel}>
              放弃修改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {selectionState && !showSessionDialog && (
        <TextSelectionToolbar
          position={selectionState.position}
          onAction={() => setShowSessionDialog(true)}
          onClose={() => setSelectionState(null)}
        />
      )}
      {showSessionDialog && selectionState && (
        <SelectionSessionDialog
          selectedText={selectionState.text}
          sourcePath={filePath}
          agents={agents}
          position={selectionState.position}
          onSubmit={(agentId, comment) => {
            onStartSession?.(agentId, selectionState.text, filePath, comment);
            setShowSessionDialog(false);
            setSelectionState(null);
          }}
          onClose={() => {
            setShowSessionDialog(false);
            setSelectionState(null);
          }}
        />
      )}
    </div>
  );
}
