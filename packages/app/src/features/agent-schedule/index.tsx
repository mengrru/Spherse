import { useEffect, useReducer, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
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
import type { ScheduleEntry, ScheduleInfo } from "../../lib/types";
import { useProjectDataStore } from "../../stores/project-data-store";
import { useProjectCtx } from "../../context/project-context";
import { useScheduleStore } from "./store";
import { ScheduleForm } from "./ScheduleForm";
import { ScheduleList } from "./ScheduleList";
import { ScheduleLogs } from "./ScheduleLogs";
import { useScheduleLogs } from "./hooks/use-schedule-logs";
import {
  scheduleFormReducer,
  IDLE_FORM_STATE,
  type ScheduleFormFields,
} from "./schedule-form-reducer";
import { EMPTY_RUNNING_SCHEDULE_IDS, EMPTY_SCHEDULES, PRESETS } from "./constants";
import { useI18n } from "@spherse/i18n/react";
import { PlusIcon } from "lucide-react";
import { Button } from "../../components/ui/button";

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  projectId: string;
}

export function ScheduleDialog({ open, onOpenChange, agentId, projectId }: ScheduleDialogProps) {
  const { t } = useI18n();
  const { client } = useProjectCtx();
  const schedules = useScheduleStore((s) => s.byProject[projectId]?.schedulesByAgent?.[agentId] ?? EMPTY_SCHEDULES);
  const runningScheduleIds = useScheduleStore((s) => s.byProject[projectId]?.runningScheduleIdsByAgent?.[agentId] ?? EMPTY_RUNNING_SCHEDULE_IDS);
  const scheduleEventVersion = useScheduleStore((s) => s.byProject[projectId]?.scheduleEventVersion ?? 0);
  const agentName = useProjectDataStore((s) => s.projects[projectId]?.agents?.find((a) => a.id === agentId)?.name ?? "");
  const refreshSchedules = useScheduleStore((s) => s.refreshSchedules);
  const createSchedule = useScheduleStore((s) => s.createSchedule);
  const updateSchedule = useScheduleStore((s) => s.updateSchedule);
  const deleteSchedule = useScheduleStore((s) => s.deleteSchedule);
  const triggerSchedule = useScheduleStore((s) => s.triggerSchedule);

  const [activeTab, setActiveTab] = useState("config");
  const [form, dispatch] = useReducer(scheduleFormReducer, IDLE_FORM_STATE);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleEntry | null>(null);
  const logs = useScheduleLogs(client, agentId, open && activeTab === "logs", scheduleEventVersion);

  const scheduleNameMap: Record<string, string> = {};
  for (const schedule of schedules) {
    scheduleNameMap[schedule.id] = schedule.name || schedule.cron;
  }

  useEffect(() => {
    if (open) refreshSchedules(projectId, client, agentId);
  }, [open, projectId, client, agentId, refreshSchedules]);

  function patchField<Field extends keyof ScheduleFormFields>(field: Field, value: ScheduleFormFields[Field]) {
    dispatch({ type: "patch", patch: { [field]: value } });
  }

  function handlePresetChange(value: string) {
    const entry = PRESETS.find((p) => p.id === value);
    dispatch({ type: "patch", patch: entry ? { preset: value, cron: entry.cron } : { preset: value } });
  }

  async function handleSave() {
    if (!form.cron.trim() || !form.message.trim()) return;
    const data = {
      name: form.name || undefined,
      cron: form.cron,
      message: form.message,
      mode: "new_session" as const,
      notify: form.notify,
      notificationMessage: form.notify && form.notificationMessage.trim() ? form.notificationMessage.trim() : undefined,
    };
    if (form.mode === "create") {
      await createSchedule(projectId, client, agentId, data);
    } else if (form.mode === "edit" && form.editingId) {
      await updateSchedule(projectId, client, agentId, form.editingId, data);
    }
    dispatch({ type: "reset" });
    setExpandedId(null);
  }

  function handleEdit(entry: ScheduleEntry) {
    dispatch({ type: "edit", entry });
    setExpandedId(null);
  }

  async function handleTrigger(entry: ScheduleEntry) {
    await triggerSchedule(projectId, client, agentId, entry.id);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await deleteSchedule(projectId, client, agentId, deleteTarget.id);
    setDeleteTarget(null);
  }

  async function handleToggle(entry: ScheduleInfo) {
    await updateSchedule(projectId, client, agentId, entry.id, { enabled: !entry.enabled });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex h-[60vh] w-[50vw] !max-w-[50vw] flex-col sm:!max-w-[50vw]">
        <DialogHeader>
          <DialogTitle>{agentName ? `${t("agent-schedule.dialogTitle")} | ${agentName}` : t("agent-schedule.dialogTitle")}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1">
          <div className="mb-3 flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="config">{t("agent-schedule.tabConfig")}</TabsTrigger>
              <TabsTrigger value="logs">{t("agent-schedule.tabLogs")}</TabsTrigger>
            </TabsList>
            {activeTab === "config" && form.mode === "idle" && (
              <Button size="default" onClick={() => dispatch({ type: "startCreate" })}>
                <PlusIcon className="size-4" />
                {t("agent-schedule.createSchedule")}
              </Button>
            )}
          </div>

          <TabsContent value="config" className="min-h-0 flex-1 overflow-y-auto">
            {form.mode !== "idle" ? (
              <ScheduleForm
                editingId={form.editingId ?? ""}
                name={form.name}
                cron={form.cron}
                preset={form.preset}
                message={form.message}
                notify={form.notify}
                notificationMessage={form.notificationMessage}
                onNameChange={(v) => patchField("name", v)}
                onCronChange={(v) => patchField("cron", v)}
                onPresetChange={handlePresetChange}
                onMessageChange={(v) => patchField("message", v)}
                onNotifyChange={(v) => patchField("notify", v)}
                onNotificationMessageChange={(v) => patchField("notificationMessage", v)}
                onInsertVariable={(variable) => dispatch({ type: "patch", patch: { message: form.message + `{{${variable}}}` } })}
                onSave={handleSave}
                onCancel={() => dispatch({ type: "reset" })}
              />
            ) : (
              <ScheduleList
                schedules={schedules}
                runningScheduleIds={runningScheduleIds}
                expandedId={expandedId}
                onToggle={handleToggle}
                onExpand={setExpandedId}
                onTrigger={handleTrigger}
                onEdit={handleEdit}
                onDelete={setDeleteTarget}
              />
            )}
          </TabsContent>

          <TabsContent value="logs" className="min-h-0 flex-1 overflow-y-auto">
            <ScheduleLogs logs={logs} agentName={agentName} scheduleNameMap={scheduleNameMap} />
          </TabsContent>
        </Tabs>

        <AlertDialog open={!!deleteTarget} onOpenChange={(nextOpen) => { if (!nextOpen) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("common.delete")}</AlertDialogTitle>
              <AlertDialogDescription>{t("agent-schedule.confirmDelete")}</AlertDialogDescription>
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
