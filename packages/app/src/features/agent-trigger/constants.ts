import type { TriggerInfo } from "../../lib/types";

export const EMPTY_TRIGGERS: TriggerInfo[] = [];

export const EMPTY_RUNNING_TRIGGER_IDS: string[] = [];

export const LOG_LIMIT = 100;

export const PRESETS = [
  { id: "every-30-minutes", labelKey: "agent-trigger.presetEvery30Minutes", cron: "*/30 * * * *" },
  { id: "hourly", labelKey: "agent-trigger.presetHourly", cron: "0 * * * *" },
  { id: "daily-0900", labelKey: "agent-trigger.presetDaily0900", cron: "0 9 * * *" },
  { id: "weekly-monday-0900", labelKey: "agent-trigger.presetWeeklyMonday0900", cron: "0 9 * * 1" },
] as const;
