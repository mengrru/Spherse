import { useState } from "react";
import { FolderCogIcon } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { FileTree } from "../../components/file-tree";
import { AiReadDenylistDialog } from "./AiReadDenylistDialog";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "../../components/ui/sidebar";
import { useHostBridge } from "../../context/host-bridge-context";
import { useProjectCtx } from "../../context/project-context";

export function UserFilePanel() {
  const { projectId } = useProjectCtx();
  const bridge = useHostBridge();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [aiDenylistOpen, setAiDenylistOpen] = useState(false);
  const { t } = useI18n();
  const contentPath = searchParams.get("path") ?? undefined;
  const canMutate = bridge.capabilities.content.editable;

  const handleSelectFile = (filePath: string) => {
    if (!projectId) return;
    navigate(`/project/${projectId}/content?path=${encodeURIComponent(filePath)}`);
  };

  const handleFileDeleted = (deletedPath: string) => {
    if (contentPath && (contentPath === deletedPath || contentPath.startsWith(`${deletedPath}/`))) {
      if (projectId) navigate(`/project/${projectId}`);
    }
  };

  return (
    <>
      <div className="border-b border-sidebar-border p-2">
        <SidebarGroup className="px-0 py-0">
          <SidebarGroupLabel className="h-7 px-0 text-[11px] font-semibold tracking-wide uppercase">
            {t("project-panel.files")}
          </SidebarGroupLabel>
          {canMutate && (
            <SidebarGroupAction
              className="top-1 right-0"
              onClick={() => setAiDenylistOpen(true)}
              title={t("project-panel.aiReadDenylistTooltip")}
            >
              <FolderCogIcon />
            </SidebarGroupAction>
          )}
          <SidebarGroupContent>
            <FileTree
              selectedFilePath={contentPath}
              onSelectFile={handleSelectFile}
              onDeleted={handleFileDeleted}
              readOnly={!canMutate}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </div>
      {canMutate && <AiReadDenylistDialog open={aiDenylistOpen} onOpenChange={setAiDenylistOpen} />}
    </>
  );
}
