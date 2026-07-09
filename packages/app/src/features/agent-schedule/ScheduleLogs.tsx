import type { ScheduleLogEntry } from "../../lib/types";
import { LOG_LIMIT } from "./constants";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "@/lib/utils";

interface ScheduleLogsProps {
  logs: ScheduleLogEntry[];
  agentName: string;
  scheduleNameMap: Record<string, string>;
  logFilePath: string;
}

export function ScheduleLogs({ logs, agentName, scheduleNameMap, logFilePath }: ScheduleLogsProps) {
  const { t } = useI18n();
  const displayLogs = [...logs].reverse();

  function renderLogStatus(status: string) {
    const key = status === "running" ? "logStatusRunning" : status === "success" ? "logStatusSuccess" : "logStatusFailed";
    const color = status === "success" ? "text-green-600" : status === "failed" ? "text-destructive" : "text-muted-foreground";
    return <span className={cn("text-xs font-medium", color)}>{t(`agent-schedule.${key}`)}</span>;
  }

  if (logs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-muted-foreground text-center">{t("agent-schedule.noLogs")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <p className="text-xs text-muted-foreground mb-2 shrink-0">
        {t("agent-schedule.logLimitNotice", { count: String(LOG_LIMIT), path: logFilePath })}
      </p>
      <div className="space-y-1 overflow-y-auto flex-1 min-h-0">
        {displayLogs.map((log, i) => (
          <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted text-xs">
            <span className="shrink-0 text-muted-foreground">
              {new Date(log.completedAt ?? log.triggeredAt).toLocaleString()}
            </span>
            {renderLogStatus(log.status)}
            <span className="font-medium truncate max-w-[120px]">{log.agentName || agentName}</span>
            <span className="truncate max-w-[100px] text-muted-foreground">
              {log.scheduleName || scheduleNameMap[log.scheduleId] || log.scheduleId.slice(0, 8)}
            </span>
            {log.error && (
              <span className="truncate text-destructive/80 max-w-[120px]">{log.error}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
