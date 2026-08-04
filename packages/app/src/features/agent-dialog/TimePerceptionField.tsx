import { useI18n } from "@spherse/i18n/react";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { HintLabel } from "./HintLabel";
import type { TimePerceptionFormData } from "./agent-markdown";
import { useState, useEffect, useRef } from "react";

const COMMON_TIME_ZONES = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Paris",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

interface TimePerceptionFieldProps {
  value?: TimePerceptionFormData;
  onChange: (value: TimePerceptionFormData) => void;
}

function toDateTimeLocal(ms: number | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(ms - offset).toISOString().slice(0, 16);
}

function fromDateTimeLocal(str: string): number | undefined {
  if (!str) return undefined;
  const ms = new Date(str).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

export function TimePerceptionField({ value, onChange }: TimePerceptionFieldProps) {
  const { t } = useI18n();
  const enabled = value?.enabled ?? false;
  const epochMs = value?.epochMs;
  const startMs = value?.startMs;
  const flowRate = value?.flowRate;
  const timeZone = value?.timeZone ?? "";

  const [epochInput, setEpochInput] = useState(toDateTimeLocal(epochMs));
  const [startInput, setStartInput] = useState(toDateTimeLocal(startMs));
  const [flowRateInput, setFlowRateInput] = useState(
    flowRate != null ? String(flowRate) : "",
  );

  const update = (patch: Partial<TimePerceptionFormData>) => {
    onChange({
      enabled: patch.enabled ?? enabled,
      epochMs: patch.epochMs ?? epochMs,
      startMs: patch.startMs ?? startMs,
      flowRate: patch.flowRate ?? flowRate,
      timeZone: patch.timeZone ?? timeZone,
    });
  };

  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !epochMs || !startMs || !flowRate || flowRate <= 0) {
      setPreview(null);
      return;
    }

    const compute = () => {
      const realNow = Date.now();
      const perceived = startMs + (realNow - epochMs) * flowRate;
      const dt = new Intl.DateTimeFormat("en-US", {
        timeZone: timeZone || undefined,
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      setPreview(dt.format(new Date(perceived)));
    };

    compute();
    intervalRef.current = setInterval(compute, 1000);
    return () => clearInterval(intervalRef.current);
  }, [enabled, epochMs, startMs, flowRate, timeZone]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <Label>{t("agent-dialog.timePerceptionLabel")}</Label>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => {
            if (v && epochMs === undefined && startMs === undefined) {
              const now = Date.now();
              setEpochInput(toDateTimeLocal(now));
              setStartInput(toDateTimeLocal(now));
              setFlowRateInput("1");
              update({ enabled: true, epochMs: now, startMs: now, flowRate: 1 });
            } else {
              update({ enabled: v === true });
            }
          }}
        />
      </div>

      {enabled && (
        <div className="space-y-3 ps-3 pe-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <HintLabel hint={t("agent-dialog.epochHint")}>
                {t("agent-dialog.epochLabel")}
              </HintLabel>
              <Input
                type="datetime-local"
                value={epochInput}
                onChange={(e) => {
                  setEpochInput(e.target.value);
                  const ms = fromDateTimeLocal(e.target.value);
                  if (ms !== undefined) update({ epochMs: ms });
                }}
               
              />
            </div>
            <div className="space-y-1.5">
              <HintLabel hint={t("agent-dialog.startHint")}>
                {t("agent-dialog.startLabel")}
              </HintLabel>
              <Input
                type="datetime-local"
                value={startInput}
                onChange={(e) => {
                  setStartInput(e.target.value);
                  const ms = fromDateTimeLocal(e.target.value);
                  if (ms !== undefined) update({ startMs: ms });
                }}
               
              />
            </div>
            <div className="space-y-1.5">
              <HintLabel hint={t("agent-dialog.flowRateHint")}>
                {t("agent-dialog.flowRateLabel")}
              </HintLabel>
              <Input
                type="number"
                min="0"
                step="0.1"
                value={flowRateInput}
                onChange={(e) => {
                  setFlowRateInput(e.target.value);
                  const n = Number(e.target.value);
                  if (!Number.isNaN(n)) update({ flowRate: n });
                }}
                placeholder="1"
               
              />
            </div>
            <div className="space-y-1.5">
              <HintLabel hint={t("agent-dialog.timeZoneHint")}>
                {t("agent-dialog.timeZoneLabel")}
              </HintLabel>
              <Select
                value={timeZone ?? ""}
                onValueChange={(v) =>
                  update({ timeZone: (v as string) || undefined })
                }
                items={[
                  { value: "", label: t("agent-dialog.timeZoneSystem") },
                  ...COMMON_TIME_ZONES.map((tz) => ({ value: tz, label: tz })),
                ]}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">
                    {t("agent-dialog.timeZoneSystem")}
                  </SelectItem>
                  {COMMON_TIME_ZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {preview && (
            <p className="text-xs text-muted-foreground">
              {t("agent-dialog.timePerceptionPreview")}: {preview}
            </p>
          )}
          <p className="text-xs text-muted-foreground/70">
            {t("agent-dialog.timePerceptionExample")}
          </p>
        </div>
      )}
    </div>
  );
}
