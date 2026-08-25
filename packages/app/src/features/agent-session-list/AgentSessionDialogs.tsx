import { useI18n } from "@spherse/i18n/react";
import { AgentDialog } from "../agent-dialog";
import { TriggerDialog } from "../agent-trigger";
import { McpDialog } from "../agent-mcp";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { SessionStatusDialog } from "./SessionStatusDialog";
import type { AgentSummary, SessionInfo } from "../../lib/types";

export type DialogState =
  | { kind: "none" }
  | { kind: "create-agent" }
  | { kind: "edit-agent"; id: string }
  | { kind: "delete-agent"; agent: AgentSummary }
  | { kind: "delete-session"; session: SessionInfo }
  | { kind: "trigger"; agent: AgentSummary }
  | { kind: "mcp"; agent: AgentSummary }
  | { kind: "session-status"; session: SessionInfo };

interface AgentSessionDialogsProps {
  dialog: DialogState;
  projectId: string;
  onClose: () => void;
  onCreateAgent: (slug: string, content: string, themeContent: string) => Promise<void>;
  onEditAgent: (slug: string, content: string, themeContent: string) => Promise<void>;
  onDeleteAgent: (agent: AgentSummary) => Promise<void>;
  onDeleteSession: (session: SessionInfo) => Promise<void>;
}

export function AgentSessionDialogs({
  dialog,
  projectId,
  onClose,
  onCreateAgent,
  onEditAgent,
  onDeleteAgent,
  onDeleteSession,
}: AgentSessionDialogsProps) {
  const { t } = useI18n();

  return (
    <>
      {dialog.kind === "create-agent" && (
        <AgentDialog mode="create" onSubmit={onCreateAgent} onCancel={onClose} />
      )}
      {dialog.kind === "edit-agent" && (
        <AgentDialog mode="edit" agentId={dialog.id} onSubmit={onEditAgent} onCancel={onClose} />
      )}
      <AlertDialog
        open={dialog.kind === "delete-agent"}
        onOpenChange={(open) => { if (!open) onClose(); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("file-tree.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("agent-session-list.confirmDeleteAgent", {
                name: dialog.kind === "delete-agent" ? dialog.agent.name : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              if (dialog.kind === "delete-agent") onDeleteAgent(dialog.agent);
            }}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={dialog.kind === "delete-session"}
        onOpenChange={(open) => { if (!open) onClose(); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("session.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("session.confirmDeleteDescription", {
                title: dialog.kind === "delete-session" ? dialog.session.title ?? t("session.untitled") : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              if (dialog.kind === "delete-session") onDeleteSession(dialog.session);
            }}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {dialog.kind === "trigger" && (
        <TriggerDialog
          open={true}
          onOpenChange={(open) => { if (!open) onClose(); }}
          agentId={dialog.agent.id}
          projectId={projectId}
        />
      )}
      {dialog.kind === "mcp" && (
        <McpDialog
          open={true}
          onOpenChange={(open) => { if (!open) onClose(); }}
          agentId={dialog.agent.id}
          projectId={projectId}
        />
      )}
      {dialog.kind === "session-status" && (
        <SessionStatusDialog
          session={dialog.session}
          open={true}
          onOpenChange={(open) => { if (!open) onClose(); }}
        />
      )}
    </>
  );
}
