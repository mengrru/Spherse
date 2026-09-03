import type { RenderItem } from "../types";

/**
 * 计算被「同 file_path 较新卡片」覆盖、应折叠的 html card toolCallId 集合。
 *
 * 同一 file_path 仅保留最近（按消息流顺序最后出现）一张展开，其余返回为 superseded。
 * inline（无 file_path）卡片不参与去重。返回的集合在无重复时为空。
 */
export function computeSupersededToolCallIds(items: RenderItem[]): Set<string> {
  const latestByPath = new Map<string, string>();
  for (const item of items) {
    const toolCalls = item.message._toolCalls;
    if (!toolCalls) continue;
    for (const tc of toolCalls) {
      const card = tc._card;
      if (card?.type === "html" && card.file_path) {
        latestByPath.set(card.file_path, tc.toolCallId);
      }
    }
  }
  const superseded = new Set<string>();
  if (latestByPath.size === 0) return superseded;
  for (const item of items) {
    const toolCalls = item.message._toolCalls;
    if (!toolCalls) continue;
    for (const tc of toolCalls) {
      const card = tc._card;
      if (
        card?.type === "html" &&
        card.file_path &&
        latestByPath.get(card.file_path) !== tc.toolCallId
      ) {
        superseded.add(tc.toolCallId);
      }
    }
  }
  return superseded;
}
