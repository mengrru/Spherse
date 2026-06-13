import type { ScheduleInfo } from "../../lib/types";

export const EMPTY_SCHEDULES: ScheduleInfo[] = [];

export const EMPTY_RUNNING_SCHEDULE_IDS: string[] = [];

export const LOG_LIMIT = 100;

export const PRESETS = [
  { id: "every-30-minutes", labelKey: "agent-schedule.presetEvery30Minutes", cron: "*/30 * * * *" },
  { id: "hourly", labelKey: "agent-schedule.presetHourly", cron: "0 * * * *" },
  { id: "daily-0900", labelKey: "agent-schedule.presetDaily0900", cron: "0 9 * * *" },
  { id: "weekly-monday-0900", labelKey: "agent-schedule.presetWeeklyMonday0900", cron: "0 9 * * 1" },
  { id: "custom", labelKey: "agent-schedule.presetCustom", cron: "" },
] as const;
