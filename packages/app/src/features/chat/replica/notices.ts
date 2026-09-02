import type { ErrorEventCode } from "@spherse/contracts";

export interface ChatNotice {
  id: string;
  kind: "error" | "withdrawFailed";
  bornAtSeq: number | null;
  message: string;
  code?: ErrorEventCode;
  turnError: boolean;
}

export interface NoticesZone {
  items: ChatNotice[];
}

export function initialNotices(): NoticesZone {
  return { items: [] };
}

export function appendNotice(notices: NoticesZone, notice: ChatNotice): NoticesZone {
  return { items: [...notices.items, notice] };
}

export function clearRunErrorNotices(notices: NoticesZone): NoticesZone {
  const kept = notices.items.filter((notice) => notice.kind !== "error");
  if (kept.length === notices.items.length) return notices;
  return { items: kept };
}

export function clearWithdrawFailedNotices(notices: NoticesZone): NoticesZone {
  const kept = notices.items.filter((notice) => notice.kind !== "withdrawFailed");
  if (kept.length === notices.items.length) return notices;
  return { items: kept };
}

export function clearNoticesOnDurableError(notices: NoticesZone, seq: number): NoticesZone {
  const kept = notices.items.filter((notice) => !(notice.kind === "error" && (notice.bornAtSeq ?? -1) < seq));
  if (kept.length === notices.items.length) return notices;
  return { items: kept };
}

export function clearNoticesCoveredByDeletion(notices: NoticesZone, seq: number, upTo: number): NoticesZone {
  const kept = notices.items.filter((notice) => {
    if (notice.kind !== "error" && notice.kind !== "withdrawFailed") return true;
    const born = notice.bornAtSeq;
    if (born === null) return true;
    return !(born >= seq && born < upTo);
  });
  if (kept.length === notices.items.length) return notices;
  return { items: kept };
}
