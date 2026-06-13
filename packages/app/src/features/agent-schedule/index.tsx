import { useEffect, useState } from "react";
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
import type { ScheduleEntry, ScheduleInfo, ScheduleLogEntry } from "../../lib/types";
import type { ApiClient } from "../../lib/api";
import { useProjectDataStore } from "../../stores/project-data-store";
import { ScheduleForm } from "./ScheduleForm";
import { ScheduleList } from "./ScheduleList";
import { ScheduleLogs } from "./ScheduleLogs";
import { EMPTY_RUNNING_SCHEDULE_IDS, EMPTY_SCHEDULES, LOG_LIMIT, PRESETS } from "./constants";
import { useI18n } from "@spherse/i18n/react";
import { PlusIcon } from "lucide-react";
import { Button } from "../../components/ui/button";

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  projectKey: string;
  client: ApiClient;
}

export function ScheduleDialog({ open, onOpenChange, agentId, projectKey, client }: ScheduleDialogProps) {
  const { t } = useI18n();
  const schedules = useProjectDataStore((s) => s.projects[projectKey]?.schedulesByAgent?.[agentId] ?? EMPTY_SCHEDULES);
  const runningScheduleIds = useProjectDataStore((s) => s.projects[projectKey]?.runningScheduleIdsByAgent?.[agentId] ?? EMPTY_RUNNING_SCHEDULE_IDS);
  const scheduleEventVersion = useProjectDataStore((s) => s.projects[projectKey]?.scheduleEventVersion ?? 0);
  const agentName = useProjectDataStore((s) => s.projects[projectKey]?.agents?.find((a) => a.id === agentId)?.name ?? "");
  const refreshSchedules = useProjectDataStore((s) => s.refreshSchedules);
  const createSchedule = useProjectDataStore((s) => s.createSchedule);
  const updateSchedule = useProjectDataStore((s) => s.updateSchedule);
  const deleteSchedule = useProjectDataStore((s) => s.deleteSchedule);
  const triggerSchedule = useProjectDataStore((s) => s.triggerSchedule);

  const [activeTab, setActiveTab] = useState("config");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleEntry | null>(null);
  const [cron, setCron] = useState("");
  const [preset, setPreset] = useState("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [notify, setNotify] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
  const [logs, setLogs] = useState<ScheduleLogEntry[]>([]);

  const scheduleNameMap: Record<string, string> = {};
  for (const schedule of schedules) {
    scheduleNameMap[schedule.id] = schedule.name || schedule.cron;
  }

  useEffect(() => {
    if (open) refreshSchedules(projectKey, client, agentId);
  }, [open, projectKey, client, agentId, refreshSchedules]);

  useEffect(() => {
    if (open && activeTab === "logs") {
      client.getScheduleLogs(agentId, LOG_LIMIT).then(setLogs).catch(() => {});
    }
  }, [open, activeTab, agentId, client, scheduleEventVersion]);

  function resetForm() {
    setEditingId(null);
    setCron("");
    setPreset("");
    setMessage("");
    setName("");
    setNotify(false);
    setNotificationMessage("");
    setExpandedId(null);
  }

  function startCreate() {
    resetForm();
    setEditingId("__new__");
  }

  function handlePresetChange(value: string) {
    setPreset(value);
    const entry = PRESETS.find((p) => p.id === value);
    if (entry) setCron(entry.cron);
  }

  async function handleSave() {
    if (!cron.trim() || !message.trim()) return;
    const data = {
      name: name || undefined,
      cron,
      message,
      mode: "new_session" as const,
      notify,
      notificationMessage: notify && notificationMessage.trim() ? notificationMessage.trim() : undefined,
    };
    if (editingId === "__new__") {
      await createSchedule(projectKey, client, agentId, data);
    } else if (editingId) {
      await updateSchedule(projectKey, client, agentId, editingId, data);
    }
    resetForm();
  }

  function handleEdit(entry: ScheduleEntry) {
    setEditingId(entry.id);
    setExpandedId(null);
    setCron(entry.cron);
    setMessage(entry.message);
    setName(entry.name ?? "");
    setNotify(entry.notify);
    setNotificationMessage(entry.notificationMessage ?? "");
  }

  async function handleTrigger(entry: ScheduleEntry) {
    await triggerSchedule(projectKey, client, agentId, entry.id);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await deleteSchedule(projectKey, client, agentId, deleteTarget.id);
    setDeleteTarget(null);
  }

  async function handleToggle(entry: ScheduleInfo) {
    await updateSchedule(projectKey, client, agentId, entry.id, { enabled: !entry.enabled });
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
            {activeTab === "config" && !editingId && (
              <Button size="default" onClick={startCreate}>
                <PlusIcon className="size-4" />
                {t("agent-schedule.createSchedule")}
              </Button>
            )}
          </div>

          <TabsContent value="config" className="min-h-0 flex-1 overflow-y-auto">
            {editingId ? (
              <ScheduleForm
                editingId={editingId}
                name={name}
                cron={cron}
                preset={preset}
                message={message}
                notify={notify}
                notificationMessage={notificationMessage}
                onNameChange={setName}
                onCronChange={setCron}
                onPresetChange={handlePresetChange}
                onMessageChange={setMessage}
                onNotifyChange={setNotify}
                onNotificationMessageChange={setNotificationMessage}
                onInsertVariable={(variable) => setMessage((prev) => prev + `{{${variable}}}`)}
                onSave={handleSave}
                onCancel={resetForm}
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
