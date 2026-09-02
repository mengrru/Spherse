import type { SendableImage } from "../types";

export type PendingIntent = {
  intentId: string;
  content: string;
  attachment?: SendableImage;
  state: "queued" | "sending" | "failed";
  createdAt: number;
  seenDisconnect?: boolean;
};

export interface PendingZone {
  intents: PendingIntent[];
  lastSendingId: string | null;
  withdrawInFlight: boolean;
}

export function initialPending(): PendingZone {
  return { intents: [], lastSendingId: null, withdrawInFlight: false };
}

export function addIntent(pending: PendingZone, intent: PendingIntent): PendingZone {
  return {
    ...pending,
    intents: [...pending.intents.filter((existing) => existing.intentId !== intent.intentId), intent],
    lastSendingId: intent.state === "sending" ? intent.intentId : pending.lastSendingId,
  };
}

export function removeIntent(pending: PendingZone, intentId: string): PendingZone {
  const intents = pending.intents.filter((intent) => intent.intentId !== intentId);
  return {
    ...pending,
    intents,
    lastSendingId: pending.lastSendingId === intentId
      ? (intents.find((intent) => intent.state === "sending")?.intentId ?? null)
      : pending.lastSendingId,
  };
}

export function failIntent(pending: PendingZone, intentId: string): PendingZone {
  return {
    ...pending,
    intents: pending.intents.map((intent) => (
      intent.intentId === intentId && intent.state === "sending"
        ? { ...intent, state: "failed" as const }
        : intent
    )),
    lastSendingId: pending.lastSendingId === intentId ? null : pending.lastSendingId,
  };
}

export function replaceIntent(pending: PendingZone, removedId: string, next: PendingIntent): PendingZone {
  return addIntent(removeIntent(pending, removedId), next);
}

export function markDisconnectSeen(pending: PendingZone): PendingZone {
  let changed = false;
  const intents = pending.intents.map((intent) => {
    if (intent.state !== "sending" || intent.seenDisconnect) return intent;
    changed = true;
    return { ...intent, seenDisconnect: true };
  });
  return changed ? { ...pending, intents } : pending;
}

export function setWithdrawInFlight(pending: PendingZone, inFlight: boolean): PendingZone {
  if (pending.withdrawInFlight === inFlight) return pending;
  return { ...pending, withdrawInFlight: inFlight };
}

export function hasSendingIntent(pending: PendingZone): boolean {
  return pending.intents.some((intent) => intent.state === "sending");
}

export function lastIntent(pending: PendingZone): PendingIntent | undefined {
  return pending.intents[pending.intents.length - 1];
}
