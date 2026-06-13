import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { PRESETS } from "./constants";
import { useI18n } from "@spherse/i18n/react";

interface ScheduleFormProps {
  editingId: string;
  name: string;
  cron: string;
  preset: string;
  message: string;
  notify: boolean;
  notificationMessage: string;
  onNameChange: (value: string) => void;
  onCronChange: (value: string) => void;
  onPresetChange: (value: string) => void;
  onMessageChange: (value: string) => void;
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
  preset,
  message,
  notify,
  notificationMessage,
  onNameChange,
  onCronChange,
  onPresetChange,
  onMessageChange,
  onNotifyChange,
  onNotificationMessageChange,
  onInsertVariable,
  onSave,
  onCancel,
}: ScheduleFormProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{t("agent-schedule.name")}</Label>
        <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder={t("agent-schedule.namePlaceholder")} />
      </div>

      <div className="space-y-1">
        <Label>{t("agent-schedule.message")}</Label>
        <Textarea value={message} onChange={(e) => onMessageChange(e.target.value)} placeholder={t("agent-schedule.messagePlaceholder")} rows={10} />
        <div className="flex flex-wrap gap-1 mt-1">
          {["date", "time", "datetime", "weekday", "agent_name"].map((v) => (
            <Button key={v} variant="outline" size="sm" className="text-xs h-6 px-2" onClick={() => onInsertVariable(v)}>
              {`{{${v}}}`}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label>{t("agent-schedule.frequency")}</Label>
        <Select value={preset} onValueChange={onPresetChange}>
          <SelectTrigger><SelectValue placeholder={t("agent-schedule.selectPreset")} /></SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>{t(p.labelKey)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preset === "custom" && (
          <Input value={cron} onChange={(e) => onCronChange(e.target.value)} placeholder="0 9 * * *" className="mt-1" />
        )}
        <p className="text-xs text-muted-foreground">{t("agent-schedule.granularityHint")}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-md border border-border p-2">
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

      <div className="flex gap-2">
        <Button onClick={onSave} className="flex-1">
          {editingId === "__new__" ? t("common.add") : t("common.save")}
        </Button>
        <Button variant="outline" onClick={onCancel}>{t("common.cancel")}</Button>
      </div>
    </div>
  );
}
