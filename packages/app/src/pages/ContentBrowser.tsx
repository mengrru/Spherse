import { useState, useEffect, useCallback, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ApiClient } from "../lib/api";
import type { AgentProfile } from "../lib/types";
import { TextSelectionToolbar } from "../components/TextSelectionToolbar";
import { SelectionSessionDialog } from "../components/SelectionSessionDialog";

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
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-surface">
        <button
          className="px-3 py-1 bg-[var(--muted-bg)] rounded text-sm text-[var(--primary)] hover:bg-[var(--hover-strong)]"
          onClick={handleBackClick}
        >
          ← 返回
        </button>
        <span className="text-sm text-[var(--secondary)] font-mono flex-1">
          {isDirty && <span className="text-[var(--accent)] mr-1">●</span>}
          {filePath}
        </span>
        {isEditing ? (
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 text-xs bg-[var(--muted-bg)] text-[var(--secondary)] rounded hover:bg-[var(--hover-strong)]"
              onClick={handleCancelEdit}
            >
              取消
            </button>
            <button
              className={`px-3 py-1 text-xs rounded ${
                isDirty && !saving
                  ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                  : "bg-[var(--muted-bg)] text-[var(--muted)] cursor-not-allowed"
              }`}
              onClick={handleSave}
              disabled={!isDirty || saving}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        ) : isEditable && !isHtml ? (
          <button
            className="px-3 py-1 text-xs bg-[var(--muted-bg)] text-[var(--secondary)] rounded hover:bg-[var(--hover-strong)]"
            onClick={handleEnterEdit}
          >
            编辑
          </button>
        ) : null}
        {isHtml && !isEditing && (
          <div className="flex rounded overflow-hidden border border-[var(--border)]">
            <button
              className={`px-3 py-1 text-xs ${htmlView === "preview" ? "bg-[var(--active-bg)] text-[var(--primary)]" : "bg-[var(--muted-bg)] text-[var(--secondary)] hover:bg-[var(--hover-strong)]"}`}
              onClick={() => setHtmlView("preview")}
            >
              预览
            </button>
            <button
              className={`px-3 py-1 text-xs border-l border-[var(--border)] ${htmlView === "source" ? "bg-[var(--active-bg)] text-[var(--primary)]" : "bg-[var(--muted-bg)] text-[var(--secondary)] hover:bg-[var(--hover-strong)]"}`}
              onClick={() => setHtmlView("source")}
            >
              源码
            </button>
          </div>
        )}
      </div>
      {conflict && isEditing && (
        <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm">
          <span className="flex-1">文件已被外部修改</span>
          <button
            className="px-2 py-0.5 text-xs rounded border border-amber-300 hover:bg-amber-100"
            onClick={() => setConflict(false)}
          >
            保留我的修改
          </button>
          <button
            className="px-2 py-0.5 text-xs rounded border border-amber-300 hover:bg-amber-100"
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
          </button>
        </div>
      )}
      {saveError && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-[var(--danger)] text-sm">
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
        <textarea
          className="flex-1 p-4 font-mono text-sm leading-relaxed resize-none bg-surface border-none outline-none"
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <div ref={contentRef} className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-[var(--muted)] text-center p-8">加载中...</p>}
          {error && <p className="text-[var(--danger)] text-center p-8">{error}</p>}
          {content && !loading && (
            isMarkdown ? (
              <div className="bg-surface p-6 rounded-lg border border-[var(--border)] leading-relaxed prose-content">
                <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
              </div>
            ) : (
              <pre className="bg-surface p-4 rounded-lg border border-[var(--border)] font-mono text-sm whitespace-pre-wrap leading-relaxed">{content}</pre>
            )
          )}
        </div>
      )}
      {showLeaveConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "var(--overlay)" }}>
          <div className="bg-surface rounded-lg shadow-lg p-6 max-w-sm w-full border border-[var(--border)]">
            <p className="text-[var(--primary)] mb-4">有未保存的修改，确定离开？</p>
            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 text-sm bg-[var(--muted-bg)] rounded hover:bg-[var(--hover-strong)] text-[var(--secondary)]"
                onClick={() => setShowLeaveConfirm(false)}
              >
                继续编辑
              </button>
              <button
                className="px-4 py-2 text-sm bg-[var(--danger)] text-white rounded hover:bg-[var(--danger-hover)]"
                onClick={handleConfirmLeave}
              >
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}
      {showCancelConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "var(--overlay)" }}>
          <div className="bg-surface rounded-lg shadow-lg p-6 max-w-sm w-full border border-[var(--border)]">
            <p className="text-[var(--primary)] mb-4">有未保存的修改，确定取消编辑？</p>
            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 text-sm bg-[var(--muted-bg)] rounded hover:bg-[var(--hover-strong)] text-[var(--secondary)]"
                onClick={() => setShowCancelConfirm(false)}
              >
                继续编辑
              </button>
              <button
                className="px-4 py-2 text-sm bg-[var(--danger)] text-white rounded hover:bg-[var(--danger-hover)]"
                onClick={handleConfirmCancel}
              >
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}
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
