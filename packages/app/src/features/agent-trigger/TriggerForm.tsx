import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { PRESETS } from "./constants";
import { useI18n } from "@spherse/i18n/react";
import { cn } from "@/lib/utils";
import type { TriggerDraft, TriggerSessionMode, TriggerType } from "./trigger-form-helpers";

interface TriggerFormProps {
  draft: TriggerDraft;
  isNew: boolean;
  onChange: (patch: Partial<TriggerDraft>) => void;
  onInsertVariable: (variable: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onResetBinding: () => void;
}

export function TriggerForm({
  draft,
  isNew,
  onChange,
  onInsertVariable,
  onSave,
  onCancel,
  onResetBinding,
}: TriggerFormProps) {
  const { t } = useI18n();

  const timeVariables = ["date", "time", "datetime", "weekday", "agent_name"];
  const eventVariables = ["payload", "date", "time", "datetime", "weekday", "agent_name"];
  const variables = draft.type === "time" ? timeVariables : eventVariables;

  return (
    <div className="space-y-4 rounded-md border border-border p-3">
      <div className="space-y-1.5">
        <Label>{t("agent-trigger.type")}</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {(["time", "event"] as const).map((value) => (
            <Button
              key={value}
              variant={draft.type === value ? "default" : "outline"}
              size="sm"
              onClick={() => onChange({ type: value as TriggerType })}
            >
              {t(value === "time" ? "agent-trigger.typeTime" : "agent-trigger.typeEvent")}
            </Button>
          ))}
        </div>
      </div>

      {draft.type === "time" && (
        <div className="space-y-1.5">
          <Label>{t("agent-trigger.frequency")}</Label>
          <Input
            value={draft.cron}
            onChange={(e) => onChange({ cron: e.target.value })}
            placeholder={t("agent-trigger.cronPlaceholder")}
          />
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {PRESETS.map((p) => (
              <Button
                key={p.id}
                variant="outline"
                size="sm"
                className={cn("h-7 px-2.5 text-xs", draft.cron === p.cron && "border-primary")}
                onClick={() => onChange({ cron: p.cron })}
              >
                {t(p.labelKey)}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("agent-trigger.granularityHint")}</p>
        </div>
      )}

      {draft.type === "event" && (
        <div className="space-y-1.5">
          <Label>{t("agent-trigger.eventName")}</Label>
          <Input
            value={draft.eventName}
            onChange={(e) => onChange({ eventName: e.target.value })}
            placeholder={t("agent-trigger.eventNamePlaceholder")}
          />
          <p className="text-xs text-muted-foreground">{t("agent-trigger.eventHint")}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>{t("agent-trigger.name")}</Label>
        <Input
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t("agent-trigger.namePlaceholder")}
        />
      </div>

      <div className="space-y-1.5">
        <Label>{t("agent-trigger.message")}</Label>
        <Textarea
          value={draft.message}
          onChange={(e) => onChange({ message: e.target.value })}
          placeholder={t("agent-trigger.messagePlaceholder")}
          rows={8}
          className="field-sizing-fixed"
        />
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {variables.map((v) => (
            <Button
              key={v}
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => onInsertVariable(v)}
            >
              {`{{${v}}}`}
            </Button>
          ))}
        </div>
        {draft.type === "event" && (
          <p className="text-xs text-muted-foreground">{t("agent-trigger.payloadVarHint")}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>{t("agent-trigger.mode")}</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              { value: "reusable_session", key: "agent-trigger.modeReusableSession" },
              { value: "new_session", key: "agent-trigger.modeNewSession" },
              { value: "existing_session", key: "agent-trigger.modeExistingSession" },
            ] as const
          ).map(({ value, key }) => (
            <Button
              key={value}
              variant={draft.sessionMode === value ? "default" : "outline"}
              size="sm"
              onClick={() => onChange({ sessionMode: value as TriggerSessionMode })}
            >
              {t(key)}
            </Button>
          ))}
        </div>
        {draft.sessionMode === "existing_session" && (
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs text-muted-foreground">{t("agent-trigger.targetSessionId")}</Label>
            <Input
              value={draft.targetSessionId}
              onChange={(e) => onChange({ targetSessionId: e.target.value })}
              placeholder={t("agent-trigger.targetSessionIdPlaceholder")}
            />
          </div>
        )}
        {draft.sessionMode === "reusable_session" && (
          <div className="pt-1">
            {draft.boundSessionId ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs text-muted-foreground">{t("agent-trigger.boundSession")}</span>
                  <span className="truncate font-mono text-xs">{draft.boundSessionId}</span>
                </div>
                <Button variant="outline" size="sm" onClick={onResetBinding}>
                  {t("agent-trigger.clearBinding")}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t("agent-trigger.boundSessionNone")}</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <Label>{t("agent-trigger.notify")}</Label>
          <Switch
            checked={draft.notify}
            onCheckedChange={(v) => onChange({ notify: v === true })}
          />
        </div>
        {draft.notify && (
          <Input
            value={draft.notificationMessage}
            onChange={(e) => onChange({ notificationMessage: e.target.value })}
            placeholder={t("agent-trigger.notificationMessagePlaceholder")}
            maxLength={30}
          />
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="button" size="sm" onClick={onSave}>
          {isNew ? t("common.add") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}
