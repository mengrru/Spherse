import { useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import type { AgentProfile, ActiveSessionInfo } from "../../lib/types";
import { useProjectCtx } from "../../lib/project-context";
import { ConflictBanner } from "./ConflictBanner";
import { ConfirmDialogs } from "./ConfirmDialogs";
import { ContentView } from "./ContentView";
import { Header } from "./Header";
import { TextSelectionSession } from "../text-selection-session";
import { useContentEditor } from "./hooks/useContentEditor";
import { useContentFile } from "./hooks/useContentFile";

export interface ContentBrowserProps {
  filePath: string;
  onBack: () => void;
  agents: AgentProfile[];
  activeSessions?: ActiveSessionInfo[];
  onStartSession?: (agentId: string, selectedText: string, sourcePath: string, comment?: string) => void;
}

export function ContentBrowser({
  filePath,
  onBack,
  agents,
  activeSessions,
  onStartSession,
}: ContentBrowserProps) {
  const { t } = useI18n();
  const { client, projectId } = useProjectCtx();
  const [htmlView, setHtmlView] = useState<"preview" | "source">("preview");
  const { content, setContent, loading, error } = useContentFile(client, filePath);
  const editor = useContentEditor({
    client,
    filePath,
    content,
    setContent,
  });

  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const isMarkdown =
    ext === "md" ||
    ext === "markdown" ||
    filePath.endsWith(".agents.md");
  const isHtml = ext === "html" || ext === "htm";
  const isImage = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]).has(ext);
  const isEditable = !isHtml && !isImage;

  return (
    <div className="flex flex-col h-full">
      <Header
        filePath={filePath}
        isDirty={editor.isDirty}
        isEditing={editor.isEditing}
        isEditable={isEditable}
        isHtml={isHtml}
        htmlView={htmlView}
        saving={editor.saving}
        onBack={() => editor.requestLeave(onBack)}
        onEnterEdit={editor.enterEdit}
        onCancelEdit={editor.cancelEdit}
        onSave={() => void editor.save()}
        onHtmlViewChange={setHtmlView}
      />
      {editor.conflict && editor.isEditing && (
        <ConflictBanner
          onKeep={() => editor.setConflict(false)}
          onReload={() => void editor.reloadFromDisk()}
        />
      )}
      {editor.saveError && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {t("content-browser.saveFailed", { error: editor.saveError })}
        </div>
      )}
      <TextSelectionSession
        disabled={editor.isEditing}
        sourcePath={filePath}
        agents={agents}
        projectId={projectId}
        activeSessions={activeSessions}
        onStartSession={onStartSession}
      >
        {(contentRef) => (
          <ContentView
            client={client}
            filePath={filePath}
            content={content}
            contentRef={contentRef}
            loading={loading}
            error={error}
            isMarkdown={isMarkdown}
            isHtml={isHtml}
            isImage={isImage}
            htmlView={htmlView}
            isEditing={editor.isEditing}
            editedContent={editor.editedContent}
            onEditedContentChange={editor.setEditedContent}
          />
        )}
      </TextSelectionSession>
      <ConfirmDialogs
        showLeaveConfirm={editor.showLeaveConfirm}
        showCancelConfirm={editor.showCancelConfirm}
        onLeaveOpenChange={editor.setShowLeaveConfirm}
        onCancelOpenChange={editor.setShowCancelConfirm}
        onConfirmLeave={() => editor.confirmLeave(onBack)}
        onConfirmCancel={editor.confirmCancel}
      />
    </div>
  );
}
