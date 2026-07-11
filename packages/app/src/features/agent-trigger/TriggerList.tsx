import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { ChevronDownIcon, LoaderCircleIcon, PencilIcon, PlayIcon, TrashIcon } from "lucide-react";
import type { TriggerEntry, TriggerInfo } from "../../lib/types";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "@/lib/utils";

interface TriggerListProps {
  triggers: TriggerInfo[];
  runningTriggerIds: string[];
  expandedId: string | null;
  onToggle: (entry: TriggerInfo) => void;
  onExpand: (id: string | null) => void;
  onTrigger: (entry: TriggerEntry) => void;
  onEdit: (entry: TriggerEntry) => void;
  onDelete: (entry: TriggerEntry) => void;
}

export function TriggerList({
  triggers,
  runningTriggerIds,
  expandedId,
  onToggle,
  onExpand,
  onTrigger,
  onEdit,
  onDelete,
}: TriggerListProps) {
  const { t } = useI18n();

  return (
    <div className="h-full flex flex-col gap-3">
      {triggers.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground text-center">{t("agent-trigger.noTriggers")}</p>
        </div>
      )}

      {triggers.map((entry) => {
        const isExpanded = expandedId === entry.id;
        const isRunning = runningTriggerIds.includes(entry.id);
        return (
          <div key={entry.id}>
            <div className="flex items-center gap-2 p-2 rounded-md bg-muted">
              <Switch checked={entry.enabled} onCheckedChange={() => onToggle(entry)} />
              <span className="flex-1 text-sm truncate">{entry.name || (entry.type === "time" ? entry.cron : entry.eventName)}</span>
              {entry.type === "event" && (
                <span className="text-xs text-muted-foreground shrink-0 rounded bg-background px-1.5 py-0.5">
                  {t("agent-trigger.typeEvent")}
                </span>
              )}
              <span className="text-xs text-muted-foreground shrink-0">
                {entry.type === "time" && entry.nextTriggerAt ? new Date(entry.nextTriggerAt).toLocaleString() : ""}
              </span>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => onExpand(isExpanded ? null : entry.id)}>
                <ChevronDownIcon className={cn("size-3.5 transition-transform", isExpanded && "rotate-180")} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title={isRunning ? t("agent-trigger.runningNow") : t("agent-trigger.triggerNow")}
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
                <p>{t("agent-trigger.type")}: {t(entry.type === "time" ? "agent-trigger.typeTime" : "agent-trigger.typeEvent")}</p>
                {entry.type === "time" && <p>cron: {entry.cron}</p>}
                {entry.type === "event" && <p>{t("agent-trigger.eventName")}: {entry.eventName}</p>}
                <p>{t("agent-trigger.message")}: {entry.message}</p>
                <p>{t("agent-trigger.mode")}: {t(entry.mode === "new_session" ? "agent-trigger.modeNewSession" : "agent-trigger.modeExistingSession")}{entry.mode === "existing_session" && entry.targetSessionId ? ` (${entry.targetSessionId})` : ""}</p>
                {entry.notify && entry.notificationMessage && <p>{t("agent-trigger.notify")}: {entry.notificationMessage}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
