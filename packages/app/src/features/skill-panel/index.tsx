import { useState } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { useI18n } from "@spherse/i18n/react";
import { toast } from "sonner";
import { FileTree } from "../../components/file-tree";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "../../components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { useProjectCtx } from "../../context/project-context";
import { useApiClient } from "../../lib/use-connection";
import { useHostBridge } from "../../context/host-bridge-context";
import { CreateSkillDialog } from "./CreateSkillDialog";

export function SkillPanel() {
  const { projectId } = useProjectCtx();
  const client = useApiClient(projectId);
  const bridge = useHostBridge();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const contentPath = searchParams.get("path") ?? undefined;
  const [createOpen, setCreateOpen] = useState(false);

  const handleSelectFile = (filePath: string) => {
    if (!projectId) return;
    navigate(`/project/${projectId}/content?path=${encodeURIComponent(filePath)}`);
  };

  const handleFileDeleted = (deletedPath: string) => {
    if (contentPath && (contentPath === deletedPath || contentPath.startsWith(`${deletedPath}/`))) {
      if (projectId) navigate(`/project/${projectId}`);
    }
  };

  const handleInstallClick = async () => {
    const zipPath = await bridge.project?.selectSkillZip();
    if (!zipPath) return;
    try {
      const skill = await client.installSkill(zipPath);
      toast.success(t("skill-panel.install.success", { name: skill.name }));
    } catch (err) {
      const message = (err as Error).message ?? "";
      if (message.toLowerCase().includes("already exists")) {
        toast.error(t("skill-panel.install.exists"));
      } else {
        toast.error(t("skill-panel.install.failed", { message }));
      }
    }
  };

  return (
    <>
      <div className="border-b border-sidebar-border p-2">
        <SidebarGroup className="px-0 py-0">
          <SidebarGroupLabel className="h-7 px-0 text-[11px] font-semibold tracking-wide uppercase">
            {t("project-panel.skills")}
          </SidebarGroupLabel>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<SidebarGroupAction className="top-1 right-0" />}
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom">
              <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                {t("skill-panel.create")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleInstallClick}>
                {t("skill-panel.install")}
                <span className="ms-auto text-[0.625rem] text-muted-foreground">{t("skill-panel.install.hint")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <SidebarGroupContent>
            <FileTree
              rootPath=".spherse/skills"
              selectedFilePath={contentPath}
              onSelectFile={handleSelectFile}
              onDeleted={handleFileDeleted}
              emptyLabel={t("skill-panel.empty")}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </div>
      <CreateSkillDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        client={client}
      />
    </>
  );
}
