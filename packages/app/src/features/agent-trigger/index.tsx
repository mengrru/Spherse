import { useState } from "react";import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
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
import type { TriggerEntry, TriggerInfo } from "../../lib/types";
import { useApiClient } from "../../lib/use-connection";
import { useTriggerStore } from "./store";
import { TriggerForm } from "./TriggerForm";
import { TriggerList } from "./TriggerList";
import { TriggerLogs } from "./TriggerLogs";
import { useTriggerLogs } from "./hooks/use-trigger-logs";
import {
  createAgentTrigger,
  deleteAgentTrigger,
  resetAgentTriggerBinding,
  updateAgentTrigger,
  useAgentTriggers,
} from "../../queries/triggers";
import {
  draftToTriggerData,
  emptyTriggerDraft,
  entryToDraft,
  type TriggerDraft,
} from "./trigger-form-helpers";
import { EMPTY_RUNNING_TRIGGER_IDS } from "./constants";
import { useI18n } from "@spherse/i18n/react";
import { InfoIcon, PlusIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useProjectCatalog } from "../../queries/project";

interface TriggerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  projectId: string;
}

export function TriggerDialog({ open, onOpenChange, agentId, projectId }: TriggerDialogProps) {
  const { t } = useI18n();
  const client = useApiClient(projectId);
  const { agents } = useProjectCatalog(projectId, client);
  const { triggers, isPending } = useAgentTriggers(projectId, client, agentId);
  const runningTriggerIds = useTriggerStore(
    (s) => s.byProject[projectId]?.runningTriggerIdsByAgent?.[agentId] ?? EMPTY_RUNNING_TRIGGER_IDS,
  );
  const triggerEventVersion = useTriggerStore(
    (s) => s.byProject[projectId]?.triggerEventVersion ?? 0,
  );
  const runTrigger = useTriggerStore((s) => s.runTrigger);
  const agent = agents.find((item) => item.id === agentId);
  const agentName = agent?.name ?? "";
  const logFilePath = agent ? `.spherse/agents/${agent.slug}/triggers/logs.jsonl` : "";

  const [activeTab, setActiveTab] = useState("config");
  const [draft, setDraft] = useState<TriggerDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TriggerEntry | null>(null);
  const logs = useTriggerLogs(client, agentId, open && activeTab === "logs", triggerEventVersion);

  const triggerNameMap: Record<string, string> = {};
  for (const trigger of triggers) {
    triggerNameMap[trigger.id] =
      trigger.name || (trigger.type === "time" ? trigger.cron! : trigger.eventName!);
  }

  function patchDraft(patch: Partial<TriggerDraft>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function clearDraft() {
    setDraft(null);
    setEditingId(null);
  }

  function handleStartCreate() {
    setDraft(emptyTriggerDraft());
    setEditingId(null);
  }

  function handleStartEdit(entry: TriggerEntry) {
    setDraft(entryToDraft(entry));
    setEditingId(entry.id);
    setExpandedId(null);
  }

  async function handleSave() {
    if (!draft) return;
    const data = draftToTriggerData(draft);
    if (!data) {
      toast.error(t("agent-trigger.invalidTrigger"));
      return;
    }
    if (editingId === null) {
      await createAgentTrigger(projectId, client, agentId, data);
    } else {
      await updateAgentTrigger(projectId, client, agentId, editingId, data);
    }
    clearDraft();
  }

  async function handleTrigger(entry: TriggerEntry) {
    await runTrigger(projectId, client, agentId, entry.id);
  }

  async function handleResetBinding() {
    if (!draft || editingId === null) return;
    await resetAgentTriggerBinding(projectId, client, agentId, editingId);
    patchDraft({ boundSessionId: undefined });
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await deleteAgentTrigger(projectId, client, agentId, deleteTarget.id);
    setDeleteTarget(null);
  }

  async function handleToggle(entry: TriggerInfo) {
    await updateAgentTrigger(projectId, client, agentId, entry.id, { enabled: !entry.enabled });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            {agentName
              ? `${t("agent-trigger.dialogTitle")} | ${agentName}`
              : t("agent-trigger.dialogTitle")}
            <Tooltip>
              <TooltipTrigger
                aria-label={t("agent-trigger.dialogTitleHint")}
                className="inline-flex cursor-help text-muted-foreground"
              >
                <InfoIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>{t("agent-trigger.dialogTitleHint")}</TooltipContent>
            </Tooltip>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
          <div className="mb-3 flex items-center">
            <TabsList>
              <TabsTrigger value="config">{t("agent-trigger.tabConfig")}</TabsTrigger>
              <TabsTrigger value="logs">{t("agent-trigger.tabLogs")}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="config" className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-3">
              {draft ? (
                <TriggerForm
                  key={draft.id}
                  draft={draft}
                  isNew={editingId === null}
                  onChange={patchDraft}
                  onInsertVariable={(variable) =>
                    patchDraft({ message: `${draft.message}{{${variable}}}` })
                  }
                  onSave={handleSave}
                  onCancel={clearDraft}
                  onResetBinding={handleResetBinding}
                />
              ) : (
                <div className="flex justify-end">
                  <Button size="default" onClick={handleStartCreate}>
                    <PlusIcon className="size-4" />
                    {t("agent-trigger.createTrigger")}
                  </Button>
                </div>
              )}

              {triggers.length === 0 && !draft && !isPending ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("agent-trigger.noTriggers")}
                </p>
              ) : (
                <TriggerList
                  triggers={triggers}
                  runningTriggerIds={runningTriggerIds}
                  expandedId={expandedId}
                  editingId={editingId}
                  onToggle={handleToggle}
                  onExpand={setExpandedId}
                  onTrigger={handleTrigger}
                  onEdit={handleStartEdit}
                  onDelete={setDeleteTarget}
                />
              )}
            </div>
          </TabsContent>

          <TabsContent value="logs" className="min-h-0 flex-1">
            <TriggerLogs
              logs={logs}
              agentName={agentName}
              triggerNameMap={triggerNameMap}
              logFilePath={logFilePath}
            />
          </TabsContent>
        </Tabs>

        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
              <AlertDialogDescription>{t("agent-trigger.confirmDelete")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleDelete}>
                {t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

export { TriggerEventBridge } from "./TriggerEventBridge";
