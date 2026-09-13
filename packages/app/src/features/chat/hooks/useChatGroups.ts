import { useMemo } from "react";
import type { ChatEntry } from "../model/entry";
import { assembleGroups, type MessageGroup } from "../model/message-group";
import {
  computeSupersededToolCallIds,
  lastWithdrawableUserEntry,
  runningTriggerGroupId,
  shouldShowThinking,
} from "../model/group-derivations";
import { useChatSessionStore } from "../runtime/session-store";

const EMPTY_ENTRIES: ChatEntry[] = [];

export interface ChatTimeline {
  entries: ChatEntry[];
  groups: MessageGroup[];
  supersededToolCallIds: Set<string>;
  thinking: boolean;
  runningGroupId: string | null;
  withdrawableUserId: string | null;
}

export function useChatGroups(sessionId: string): ChatTimeline {
  const entries = useChatSessionStore(
    (state) => state.sessions[sessionId]?.entries ?? EMPTY_ENTRIES,
  );
  const streaming = useChatSessionStore(
    (state) => state.sessions[sessionId]?.streaming ?? false,
  );
  return useMemo(() => {
    const groups = assembleGroups(entries);
    return {
      entries,
      groups,
      supersededToolCallIds: computeSupersededToolCallIds(groups),
      thinking: shouldShowThinking(entries, streaming),
      runningGroupId: runningTriggerGroupId(groups, streaming),
      withdrawableUserId: streaming ? null : lastWithdrawableUserEntry(entries)?.id ?? null,
    };
  }, [entries, streaming]);
}
