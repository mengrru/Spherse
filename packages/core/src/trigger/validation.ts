import { CronExpressionParser } from "cron-parser";

export const RESERVED_EVENT_PREFIX = "sp:";

export function isValidCron(cron: string): boolean {
  try {
    CronExpressionParser.parse(cron);
    return true;
  } catch {
    return false;
  }
}

export function isReservedEventName(eventName: string): boolean {
  return eventName.startsWith(RESERVED_EVENT_PREFIX);
}

export function requiresTargetSession(
  mode: string,
  targetSessionId: string | undefined,
): boolean {
  return mode === "existing_session" && !targetSessionId;
}
