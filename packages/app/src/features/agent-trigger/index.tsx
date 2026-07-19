import { useEffect, useReducer, useState } from "react";
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
import { useProjectDataStore } from "../../stores/project-data-store";
import { useProjectCtx } from "../../context/project-context";
import { useTriggerStore } from "./store";
import { TriggerForm } from "./TriggerForm";
import { TriggerList } from "./TriggerList";
import { TriggerLogs } from "./TriggerLogs";
import { useTriggerLogs } from "./hooks/use-trigger-logs";
import {
  triggerFormReducer,
  IDLE_FORM_STATE,
  type TriggerFormFields,
} from "./trigger-form-reducer";
import { EMPTY_RUNNING_TRIGGER_IDS, EMPTY_TRIGGERS } from "./constants";
import { useI18n } from "@spherse/i18n/react";
import { InfoIcon, PlusIcon } from "lucide-react";
import { Button } from "../../components/ui/button";

interface TriggerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  projectId: string;
}

export function TriggerDialog({ open, onOpenChange, agentId, projectId }: TriggerDialogProps) {  const { t } = useI18n();
  const { client } = useProjectCtx();
  const triggers = useTriggerStore((s) => s.byProject[projectId]?.triggersByAgent?.[agentId] ?? EMPTY_TRIGGERS);
  const runningTriggerIds = useTriggerStore((s) => s.byProject[projectId]?.runningTriggerIdsByAgent?.[agentId] ?? EMPTY_RUNNING_TRIGGER_IDS);
  const triggerEventVersion = useTriggerStore((s) => s.byProject[projectId]?.triggerEventVersion ?? 0);
  const agentName = useProjectDataStore((s) => s.projects[projectId]?.agents?.find((a) => a.id === agentId)?.name ?? "");
  const logFilePath = useProjectDataStore((s) => {
    const agent = s.projects[projectId]?.agents?.find((a) => a.id === agentId);
    return agent ? `.spherse/agents/${agent.slug}/triggers/logs.jsonl` : "";
  });
  const refreshTriggers = useTriggerStore((s) => s.refreshTriggers);
  const createTrigger = useTriggerStore((s) => s.createTrigger);
  const updateTrigger = useTriggerStore((s) => s.updateTrigger);
  const deleteTrigger = useTriggerStore((s) => s.deleteTrigger);
  const runTrigger = useTriggerStore((s) => s.runTrigger);

  const [activeTab, setActiveTab] = useState("config");
  const [form, dispatch] = useReducer(triggerFormReducer, IDLE_FORM_STATE);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TriggerEntry | null>(null);
  const logs = useTriggerLogs(client, agentId, open && activeTab === "logs", triggerEventVersion);

  const triggerNameMap: Record<string, string> = {};
  for (const trigger of triggers) {
    triggerNameMap[trigger.id] = trigger.name || (trigger.type === "time" ? trigger.cron! : trigger.eventName!);
  }

  useEffect(() => {
    if (open) refreshTriggers(projectId, client, agentId);
  }, [open, projectId, client, agentId, refreshTriggers]);

  function patchField<Field extends keyof TriggerFormFields>(field: Field, value: TriggerFormFields[Field]) {
    dispatch({ type: "patch", patch: { [field]: value } });
  }

  async function handleSave() {
    if (form.type === "time") {
      if (!form.cron.trim() || !form.message.trim()) return;
    } else {
      if (!form.eventName.trim() || !form.message.trim()) return;
    }
    if (form.sessionMode === "existing_session" && !form.targetSessionId.trim()) return;
    const data = {
      name: form.name || undefined,
      type: form.type,
      cron: form.type === "time" ? form.cron : undefined,
      eventName: form.type === "event" ? form.eventName : undefined,
      message: form.message,
      mode: form.sessionMode,
      targetSessionId: form.sessionMode === "existing_session" ? form.targetSessionId.trim() : "",
      notify: form.notify,
      notificationMessage: form.notify && form.notificationMessage.trim() ? form.notificationMessage.trim() : undefined,
    };
    if (form.mode === "create") {
      await createTrigger(projectId, client, agentId, data);
    } else if (form.mode === "edit" && form.editingId) {
      await updateTrigger(projectId, client, agentId, form.editingId, data);
    }
    dispatch({ type: "reset" });
    setExpandedId(null);
  }

  function handleEdit(entry: TriggerEntry) {
    dispatch({ type: "edit", entry });
    setExpandedId(null);
  }

  async function handleTrigger(entry: TriggerEntry) {
    await runTrigger(projectId, client, agentId, entry.id);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await deleteTrigger(projectId, client, agentId, deleteTarget.id);
    setDeleteTarget(null);
  }

  async function handleToggle(entry: TriggerInfo) {
    await updateTrigger(projectId, client, agentId, entry.id, { enabled: !entry.enabled });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            {agentName ? `${t("agent-trigger.dialogTitle")} | ${agentName}` : t("agent-trigger.dialogTitle")}
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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1">
          <div className="mb-3 flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="config">{t("agent-trigger.tabConfig")}</TabsTrigger>
              <TabsTrigger value="logs">{t("agent-trigger.tabLogs")}</TabsTrigger>
            </TabsList>
            {activeTab === "config" && form.mode === "idle" && (
              <Button size="default" onClick={() => dispatch({ type: "startCreate" })}>
                <PlusIcon className="size-4" />
                {t("agent-trigger.createTrigger")}
              </Button>
            )}
          </div>

          <TabsContent value="config" className="min-h-0 flex-1 overflow-y-auto">
            {form.mode !== "idle" ? (
              <TriggerForm
                editingId={form.editingId ?? ""}
                type={form.type}
                name={form.name}
                cron={form.cron}
                eventName={form.eventName}
                message={form.message}
                sessionMode={form.sessionMode}
                targetSessionId={form.targetSessionId}
                notify={form.notify}
                notificationMessage={form.notificationMessage}
                onTypeChange={(v) => patchField("type", v)}
                onNameChange={(v) => patchField("name", v)}
                onCronChange={(v) => patchField("cron", v)}
                onEventNameChange={(v) => patchField("eventName", v)}
                onMessageChange={(v) => patchField("message", v)}
                onSessionModeChange={(v) => patchField("sessionMode", v)}
                onTargetSessionIdChange={(v) => patchField("targetSessionId", v)}
                onNotifyChange={(v) => patchField("notify", v)}
                onNotificationMessageChange={(v) => patchField("notificationMessage", v)}
                onInsertVariable={(variable) => dispatch({ type: "patch", patch: { message: form.message + `{{${variable}}}` } })}
                onSave={handleSave}
                onCancel={() => dispatch({ type: "reset" })}
              />
            ) : (
              <TriggerList
                triggers={triggers}
                runningTriggerIds={runningTriggerIds}
                expandedId={expandedId}
                onToggle={handleToggle}
                onExpand={setExpandedId}
                onTrigger={handleTrigger}
                onEdit={handleEdit}
                onDelete={setDeleteTarget}
              />
            )}
          </TabsContent>

          <TabsContent value="logs" className="min-h-0 flex-1">
            <TriggerLogs logs={logs} agentName={agentName} triggerNameMap={triggerNameMap} logFilePath={logFilePath} />
          </TabsContent>
        </Tabs>

        <AlertDialog open={!!deleteTarget} onOpenChange={(nextOpen) => { if (!nextOpen) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
              <AlertDialogDescription>{t("agent-trigger.confirmDelete")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleDelete}>{t("common.delete")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

export { TriggerEventBridge } from "./TriggerEventBridge";
