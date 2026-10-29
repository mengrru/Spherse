import type { SessionEvent } from "./events.js";
import type { CompactionSnapshotMeta } from "./types.js";

export interface CompactionSummary {
  compaction: CompactionSnapshotMeta | null;
  compactionCount: number;
}

export function compactionSummaryFromEvents(events: readonly SessionEvent[]): CompactionSummary {
  let compaction: CompactionSnapshotMeta | null = null;
  let compactionCount = 0;
  for (const event of events) {
    if (event.type !== "compaction/applied") continue;
    compactionCount += 1;
    const data = event.data as Partial<{
      anchorSeq: number;
      digestContent: string;
      excludedSeqs: number[];
      digestSource: "llm" | "mechanical";
    }>;
    compaction = {
      seq: event.seq,
      anchorSeq: typeof data.anchorSeq === "number" ? data.anchorSeq : 0,
      digestSource: data.digestSource === "llm" || data.digestSource === "mechanical" ? data.digestSource : null,
      excludedCount: Array.isArray(data.excludedSeqs) ? data.excludedSeqs.length : 0,
      digestLength: typeof data.digestContent === "string" ? data.digestContent.length : 0,
      appliedAtMs: event.time,
    };
  }
  return { compaction, compactionCount };
}
