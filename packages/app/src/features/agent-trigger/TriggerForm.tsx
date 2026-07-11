import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { PRESETS } from "./constants";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "@/lib/utils";

interface TriggerFormProps {
  editingId: string;
  type: "time" | "event";
  name: string;
  cron: string;
  eventName: string;
  message: string;
  sessionMode: "new_session" | "existing_session";
  targetSessionId: string;
  notify: boolean;
  notificationMessage: string;
  onTypeChange: (value: "time" | "event") => void;
  onNameChange: (value: string) => void;
  onCronChange: (value: string) => void;
  onEventNameChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSessionModeChange: (value: "new_session" | "existing_session") => void;
  onTargetSessionIdChange: (value: string) => void;
  onNotifyChange: (value: boolean) => void;
  onNotificationMessageChange: (value: string) => void;
  onInsertVariable: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function TriggerForm({
  editingId,
  type,
  name,
  cron,
  eventName,
  message,
  sessionMode,
  targetSessionId,
  notify,
  notificationMessage,
  onTypeChange,
  onNameChange,
  onCronChange,
  onEventNameChange,
  onMessageChange,
  onSessionModeChange,
  onTargetSessionIdChange,
  onNotifyChange,
  onNotificationMessageChange,
  onInsertVariable,
  onSave,
  onCancel,
}: TriggerFormProps) {
  const { t } = useI18n();

  const timeVariables = ["date", "time", "datetime", "weekday", "agent_name"];
  const eventVariables = ["payload", "date", "time", "datetime", "weekday", "agent_name"];
  const variables = type === "time" ? timeVariables : eventVariables;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{t("agent-trigger.type")}</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {(["time", "event"] as const).map((value) => (
            <Button
              key={value}
              variant={type === value ? "default" : "outline"}
              size="sm"
              onClick={() => onTypeChange(value)}
            >
              {t(value === "time" ? "agent-trigger.typeTime" : "agent-trigger.typeEvent")}
            </Button>
          ))}
        </div>
      </div>

      {type === "time" && (
        <div className="space-y-1.5">
          <Label>{t("agent-trigger.frequency")}</Label>
          <Input value={cron} onChange={(e) => onCronChange(e.target.value)} placeholder={t("agent-trigger.cronPlaceholder")} />
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
          <p className="text-xs text-muted-foreground">{t("agent-trigger.granularityHint")}</p>
        </div>
      )}

      {type === "event" && (
        <div className="space-y-1.5">
          <Label>{t("agent-trigger.eventName")}</Label>
          <Input value={eventName} onChange={(e) => onEventNameChange(e.target.value)} placeholder={t("agent-trigger.eventNamePlaceholder")} />
          <p className="text-xs text-muted-foreground">{t("agent-trigger.eventHint")}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>{t("agent-trigger.name")}</Label>
        <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder={t("agent-trigger.namePlaceholder")} />
      </div>

      <div className="space-y-1.5">
        <Label>{t("agent-trigger.message")}</Label>
        <Textarea value={message} onChange={(e) => onMessageChange(e.target.value)} placeholder={t("agent-trigger.messagePlaceholder")} rows={8} className="field-sizing-fixed" />
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {variables.map((v) => (
            <Button key={v} variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onInsertVariable(v)}>
              {`{{${v}}}`}
            </Button>
          ))}
        </div>
        {type === "event" && (
          <p className="text-xs text-muted-foreground">{t("agent-trigger.payloadVarHint")}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>{t("agent-trigger.mode")}</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {(["new_session", "existing_session"] as const).map((value) => (
            <Button
              key={value}
              variant={sessionMode === value ? "default" : "outline"}
              size="sm"
              onClick={() => onSessionModeChange(value)}
            >
              {t(value === "new_session" ? "agent-trigger.modeNewSession" : "agent-trigger.modeExistingSession")}
            </Button>
          ))}
        </div>
        {sessionMode === "existing_session" && (
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs text-muted-foreground">{t("agent-trigger.targetSessionId")}</Label>
            <Input
              value={targetSessionId}
              onChange={(e) => onTargetSessionIdChange(e.target.value)}
              placeholder={t("agent-trigger.targetSessionIdPlaceholder")}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <Label>{t("agent-trigger.notify")}</Label>
          <Switch checked={notify} onCheckedChange={onNotifyChange} />
        </div>
        {notify && (
          <Input
            value={notificationMessage}
            onChange={(e) => onNotificationMessageChange(e.target.value)}
            placeholder={t("agent-trigger.notificationMessagePlaceholder")}
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
