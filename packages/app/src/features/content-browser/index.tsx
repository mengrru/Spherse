import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@spherse/i18n/react";
import type { AgentSummary, ActiveSessionInfo } from "../../lib/types";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import { useHostBridge } from "../../context/host-bridge-context";
import { useFeature } from "../../lib/use-feature";
import { ConflictBanner } from "./ConflictBanner";
import { ConfirmDialogs } from "./ConfirmDialogs";
import { ContentView } from "./ContentView";
import { Header } from "./Header";
import { classifyFileKind } from "./file-kind";
import { TextSelectionSession } from "../text-selection-session";
import { useContentEditor } from "./hooks/useContentEditor";
import { useContentFile } from "./hooks/useContentFile";

export interface ContentBrowserProps {
  filePath: string;
  onBack: () => void;
  onClose: () => void;
  agents: AgentSummary[];
  activeSessions?: ActiveSessionInfo[];
  onStartSession?: (agentId: string, selectedText: string, sourcePath: string, comment?: string) => void;
}

export function ContentBrowser({
  filePath,
  onBack,
  onClose,
  agents,
  activeSessions,
  onStartSession,
}: ContentBrowserProps) {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const bridge = useHostBridge();
  const textSelectionEnabled = useFeature("text-selection-session");
  const [htmlView, setHtmlView] = useState<"preview" | "source">("preview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const { content, setContent, binary, loading, error, dataUpdatedAt, reload: reloadContent } = useContentFile(projectId, client, filePath);
  const editor = useContentEditor({
    client,
    projectId,
    filePath,
    content,
    setContent,
  });

  const handleRefresh = useCallback(() => {
    reloadContent();
    setRefreshKey((k) => k + 1);
  }, [reloadContent]);

  useEffect(() => {
    setRefreshKey((k) => k + 1);
  }, [dataUpdatedAt, filePath]);

  const { isMarkdown, isHtml, isImage } = classifyFileKind(filePath);
  const isEditable = !isImage && !binary && !loading && bridge.capabilities.content.editable;
  const findable = !loading && !error && !binary && !isImage && !(isHtml && htmlView === "preview");

  return (
    <div data-content-browser className="flex flex-col h-full">
      <Header
        filePath={filePath}
        isDirty={editor.isDirty}
        isEditing={editor.isEditing}
        isEditable={isEditable}
        isHtml={isHtml}
        htmlView={htmlView}
        saving={editor.saving}
        findable={findable}
        onBack={() => editor.requestLeave(onBack)}
        onClose={() => editor.requestLeave(onClose)}
        onEnterEdit={editor.enterEdit}
        onCancelEdit={editor.cancelEdit}
        onSave={() => void editor.save()}
        onHtmlViewChange={setHtmlView}
        onRefresh={handleRefresh}
        onFindToggle={() => setFindOpen((v) => !v)}
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
      {textSelectionEnabled ? (
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
              filePath={filePath}
              content={content}
              binary={binary}
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
              refreshKey={refreshKey}
              findOpen={findOpen}
              onFindOpenChange={setFindOpen}
            />
          )}
        </TextSelectionSession>
      ) : (
        <ContentView
          filePath={filePath}
          content={content}
          binary={binary}
          loading={loading}
          error={error}
          isMarkdown={isMarkdown}
          isHtml={isHtml}
          isImage={isImage}
          htmlView={htmlView}
          isEditing={editor.isEditing}
          editedContent={editor.editedContent}
          onEditedContentChange={editor.setEditedContent}
          refreshKey={refreshKey}
          findOpen={findOpen}
          onFindOpenChange={setFindOpen}
        />
      )}
      <ConfirmDialogs
        showLeaveConfirm={editor.showLeaveConfirm}
        showCancelConfirm={editor.showCancelConfirm}
        onLeaveOpenChange={editor.setShowLeaveConfirm}
        onCancelOpenChange={editor.setShowCancelConfirm}
        onConfirmLeave={editor.confirmLeave}
        onConfirmCancel={editor.confirmCancel}
      />
    </div>
  );
}
