import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { ChevronDownIcon, LoaderCircleIcon, PencilIcon, PlayIcon, TrashIcon } from "lucide-react";
import type { ScheduleEntry, ScheduleInfo } from "../../lib/types";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "@/lib/utils";

interface ScheduleListProps {
  schedules: ScheduleInfo[];
  runningScheduleIds: string[];
  expandedId: string | null;
  onToggle: (entry: ScheduleInfo) => void;
  onExpand: (id: string | null) => void;
  onTrigger: (entry: ScheduleEntry) => void;
  onEdit: (entry: ScheduleEntry) => void;
  onDelete: (entry: ScheduleEntry) => void;
}

export function ScheduleList({
  schedules,
  runningScheduleIds,
  expandedId,
  onToggle,
  onExpand,
  onTrigger,
  onEdit,
  onDelete,
}: ScheduleListProps) {
  const { t } = useI18n();

  return (
    <div className="h-full flex flex-col gap-3">
      {schedules.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground text-center">{t("agent-schedule.noSchedules")}</p>
        </div>
      )}

      {schedules.map((entry) => {
        const isExpanded = expandedId === entry.id;
        const isRunning = runningScheduleIds.includes(entry.id);
        return (
          <div key={entry.id}>
            <div className="flex items-center gap-2 p-2 rounded-md bg-muted">
              <Switch checked={entry.enabled} onCheckedChange={() => onToggle(entry)} />
              <span className="flex-1 text-sm truncate">{entry.name || entry.cron}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {entry.nextTriggerAt ? new Date(entry.nextTriggerAt).toLocaleString() : ""}
              </span>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => onExpand(isExpanded ? null : entry.id)}>
                <ChevronDownIcon className={cn("size-3.5 transition-transform", isExpanded && "rotate-180")} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title={isRunning ? t("agent-schedule.runningNow") : t("agent-schedule.triggerNow")}
                disabled={isRunning}
                onClick={() => onTrigger(entry)}
              >
                {isRunning ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <PlayIcon className="size-3.5" />}
              </Button>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => onEdit(entry)}>
                <PencilIcon className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-6 text-destructive" onClick={() => onDelete(entry)}>
                <TrashIcon className="size-3.5" />
              </Button>
            </div>
            {isExpanded && (
              <div className="mt-1 mb-2 ml-8 space-y-1 text-xs text-muted-foreground">
                <p>cron: {entry.cron}</p>
                <p>{t("agent-schedule.message")}: {entry.message}</p>
                {entry.notify && entry.notificationMessage && <p>{t("agent-schedule.notify")}: {entry.notificationMessage}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
