import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { PRESETS } from "./constants";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "@/lib/utils";

interface ScheduleFormProps {
  editingId: string;
  name: string;
  cron: string;
  message: string;
  sessionMode: "new_session" | "existing_session";
  targetSessionId: string;
  notify: boolean;
  notificationMessage: string;
  onNameChange: (value: string) => void;
  onCronChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSessionModeChange: (value: "new_session" | "existing_session") => void;
  onTargetSessionIdChange: (value: string) => void;
  onNotifyChange: (value: boolean) => void;
  onNotificationMessageChange: (value: string) => void;
  onInsertVariable: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function ScheduleForm({
  editingId,
  name,
  cron,
  message,
  sessionMode,
  targetSessionId,
  notify,
  notificationMessage,
  onNameChange,
  onCronChange,
  onMessageChange,
  onSessionModeChange,
  onTargetSessionIdChange,
  onNotifyChange,
  onNotificationMessageChange,
  onInsertVariable,
  onSave,
  onCancel,
}: ScheduleFormProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{t("agent-schedule.name")}</Label>
        <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder={t("agent-schedule.namePlaceholder")} />
      </div>

      <div className="space-y-1.5">
        <Label>{t("agent-schedule.message")}</Label>
        <Textarea value={message} onChange={(e) => onMessageChange(e.target.value)} placeholder={t("agent-schedule.messagePlaceholder")} rows={8} className="field-sizing-fixed" />
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {["date", "time", "datetime", "weekday", "agent_name"].map((v) => (
            <Button key={v} variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onInsertVariable(v)}>
              {`{{${v}}}`}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{t("agent-schedule.frequency")}</Label>
        <Input value={cron} onChange={(e) => onCronChange(e.target.value)} placeholder={t("agent-schedule.cronPlaceholder")} />
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              variant="outline"
              size="sm"
              className={cn("h-7 px-2.5 text-xs", cron === p.cron && "border-primary")}
              onClick={() => onCronChange(p.cron)}
            >
              {t(p.labelKey)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("agent-schedule.granularityHint")}</p>
      </div>

      <div className="space-y-1.5">
        <Label>{t("agent-schedule.mode")}</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {(["new_session", "existing_session"] as const).map((value) => (
            <Button
              key={value}
              variant={sessionMode === value ? "default" : "outline"}
              size="sm"
              onClick={() => onSessionModeChange(value)}
            >
              {t(value === "new_session" ? "agent-schedule.modeNewSession" : "agent-schedule.modeExistingSession")}
            </Button>
          ))}
        </div>
        {sessionMode === "existing_session" && (
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs text-muted-foreground">{t("agent-schedule.targetSessionId")}</Label>
            <Input
              value={targetSessionId}
              onChange={(e) => onTargetSessionIdChange(e.target.value)}
              placeholder={t("agent-schedule.targetSessionIdPlaceholder")}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <Label>{t("agent-schedule.notify")}</Label>
          <Switch checked={notify} onCheckedChange={onNotifyChange} />
        </div>
        {notify && (
          <Input
            value={notificationMessage}
            onChange={(e) => onNotificationMessageChange(e.target.value)}
            placeholder={t("agent-schedule.notificationMessagePlaceholder")}
            maxLength={30}
          />
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Button onClick={onSave} className="flex-1">
          {editingId === "__new__" ? t("common.add") : t("common.save")}
        </Button>
        <Button variant="outline" onClick={onCancel}>{t("common.cancel")}</Button>
      </div>
    </div>
  );
}
