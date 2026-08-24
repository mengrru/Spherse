import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { ChevronDownIcon, LoaderCircleIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "@/lib/utils";
import type { TriggerEntry, TriggerInfo } from "../../lib/types";

const SESSION_MODE_LABEL_KEYS = {
  new_session: "agent-trigger.modeNewSession",
  existing_session: "agent-trigger.modeExistingSession",
  reusable_session: "agent-trigger.modeReusableSession",
} as const;

interface TriggerListProps {
  triggers: TriggerInfo[];
  runningTriggerIds: string[];
  expandedId: string | null;
  editingId: string | null;
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
  editingId,
  onToggle,
  onExpand,
  onTrigger,
  onEdit,
  onDelete,
}: TriggerListProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-3">
      {triggers.map((entry) => {
        const isExpanded = expandedId === entry.id;
        const isRunning = runningTriggerIds.includes(entry.id);
        return (
          <div key={entry.id} className="rounded-md border border-border">
            <div className="flex items-center gap-2 p-2.5">
              <Switch checked={entry.enabled} onCheckedChange={() => onToggle(entry)} className="me-1" />
              <span className="flex-1 text-sm font-medium truncate">{entry.name || (entry.type === "time" ? entry.cron : entry.eventName)}</span>
              {entry.type === "event" && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
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
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => onEdit(entry)}
                disabled={editingId === entry.id}
                aria-label={t("common.edit")}
              >
                <PencilIcon className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-6 text-destructive" onClick={() => onDelete(entry)}>
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
            {isExpanded && (
              <div className="space-y-1 border-t border-border p-2.5 ps-9 text-xs text-muted-foreground">
                <p>{t("agent-trigger.type")}: {t(entry.type === "time" ? "agent-trigger.typeTime" : "agent-trigger.typeEvent")}</p>
                {entry.type === "time" && <p>cron: {entry.cron}</p>}
                {entry.type === "event" && <p>{t("agent-trigger.eventName")}: {entry.eventName}</p>}
                <p>{t("agent-trigger.message")}: {entry.message}</p>
                <p>
                  {t("agent-trigger.mode")}: {t(SESSION_MODE_LABEL_KEYS[entry.mode])}
                  {entry.mode === "existing_session" && entry.targetSessionId ? ` (${entry.targetSessionId})` : ""}
                  {entry.mode === "reusable_session" && entry.boundSessionId ? ` (${entry.boundSessionId})` : ""}
                </p>
                {entry.notify && entry.notificationMessage && <p>{t("agent-trigger.notify")}: {entry.notificationMessage}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
