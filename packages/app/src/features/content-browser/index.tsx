import { useI18n } from "@spherse/i18n/react";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import { useHostBridge } from "../../context/host-bridge-context";
import { useIsMobile } from "../../hooks/use-mobile";
import { useTabsEnabled } from "../tabs";
import { ConflictBanner } from "./ConflictBanner";
import { ConfirmDialogs } from "./ConfirmDialogs";
import { ContentBody } from "./ContentBody";
import { Header } from "./Header";
import { FindScopeRoot } from "./FindScopeRoot";
import { useContentEditor } from "./hooks/useContentEditor";
import { useContentFile } from "./hooks/useContentFile";
import { useContentViewState } from "./hooks/useContentViewState";
import { useLeaveGuard } from "./hooks/useLeaveGuard";

export { ReadOnlyContentBrowser } from "./ReadOnlyContentBrowser";
export { FindScopeRoot } from "./FindScopeRoot";

export interface ContentBrowserProps {
  filePath: string;
  onBack: () => void;
  onClose: () => void;
  onSplit?: () => void;
}

export function ContentBrowser({ filePath, onBack, onClose, onSplit }: ContentBrowserProps) {
  const { t } = useI18n();
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const bridge = useHostBridge();
  const isMobile = useIsMobile();
  const tabsEnabled = useTabsEnabled();
  const file = useContentFile(projectId, client, filePath);
  const view = useContentViewState({ filePath, ...file });
  const editor = useContentEditor({
    client,
    projectId,
    filePath,
    content: file.content,
    setContent: file.setContent,
  });
  const leaveGuard = useLeaveGuard(editor.isDirty);

  const isEditable = !view.isImage && !file.binary && !file.loading && bridge.capabilities.content.editable;
  // 移动端屏幕高度有限：HTML 文件多为自带完整界面的页面，开启标签页时由 tab 承担切换/关闭，
  // 因此隐藏 content browser header，把纵向空间全部留给 HTML 预览。
  const hideHeader = isMobile && tabsEnabled && view.isHtml;

  return (
    <FindScopeRoot data-content-browser className="flex flex-col h-full">
      {!hideHeader && (
        <Header
          filePath={filePath}
          isHtml={view.isHtml}
          htmlView={view.htmlView}
          findable={view.findable}
          editing={{
            isDirty: editor.isDirty,
            isEditing: editor.isEditing,
            isEditable,
            saving: editor.saving,
            onEnter: editor.enterEdit,
            onCancel: editor.cancelEdit,
            onSave: () => void editor.save(),
          }}
          onBack={onBack}
          onSplit={onSplit}
          onClose={onClose}
          onHtmlViewChange={view.setHtmlView}
          onRefresh={view.refresh}
          onFindToggle={view.toggleFind}
        />
      )}
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
      <ContentBody
        filePath={filePath}
        content={file.content}
        binary={file.binary}
        loading={file.loading}
        error={file.error}
        view={view}
        isEditing={editor.isEditing}
        editedContent={editor.editedContent}
        onEditedContentChange={editor.setEditedContent}
      />
      <ConfirmDialogs
        showLeaveConfirm={leaveGuard.open}
        showCancelConfirm={editor.showCancelConfirm}
        onLeaveOpenChange={leaveGuard.onOpenChange}
        onCancelOpenChange={editor.setShowCancelConfirm}
        onConfirmLeave={leaveGuard.confirm}
        onConfirmCancel={editor.confirmCancel}
      />
    </FindScopeRoot>
  );
}
