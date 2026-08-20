import { CronExpressionParser } from "cron-parser";
import type { TriggerEntry } from "../types.js";

export interface TriggerRef {
  agentId: string;
  agentName: string;
  entry: TriggerEntry;
}

export function getNextCronDate(cron: string, now = Date.now()): Date | null {
  try {
    const expression = CronExpressionParser.parse(cron, { currentDate: new Date(now) });
    return expression.next().toDate();
  } catch {
    return null;
  }
}

export interface TriggerSchedulerDeps {
  readAll(): TriggerRef[];
  onDue(ref: TriggerRef): void;
  isRunning(triggerId: string): boolean;
}

interface TriggerStateItem {
  cron: string;
  nextFire: number;
}

export class TriggerScheduler {
  private readonly state = new Map<string, TriggerStateItem>();

  constructor(private readonly deps: TriggerSchedulerDeps) {}

  onTimeTick(now = Date.now()): void {
    const refs = this.deps.readAll();
    this.gc(refs);

    for (const ref of refs) {
      const { entry } = ref;
      if (entry.type !== "time" || !entry.enabled || !entry.cron) continue;
      if (this.deps.isRunning(entry.id)) continue;

      const item = this.ensure(entry.id, entry.cron, now);
      if (item.nextFire > 0 && item.nextFire <= now) {
        this.markFired(entry.id, entry.cron, now);
        this.deps.onDue(ref);
      }
    }
  }

  markFired(triggerId: string, cron: string, now = Date.now()): void {
    const nextDate = getNextCronDate(cron, now);
    this.state.set(triggerId, { cron, nextFire: nextDate ? nextDate.getTime() : 0 });
  }

  invalidate(triggerId: string): void {
    this.state.delete(triggerId);
  }

  private ensure(triggerId: string, cron: string, now: number): TriggerStateItem {
    let item = this.state.get(triggerId);
    if (!item || item.cron !== cron) {
      const nextDate = getNextCronDate(cron, now);
      item = { cron, nextFire: nextDate ? nextDate.getTime() : 0 };
      this.state.set(triggerId, item);
    }
    return item;
  }

  private gc(refs: ReadonlyArray<TriggerRef>): void {
    const diskIds = new Set(refs.map((r) => r.entry.id));
    for (const id of this.state.keys()) {
      if (!diskIds.has(id)) this.state.delete(id);
    }
  }
}
