export interface ContextBlock {
  readonly kind: string;
  render(): string;
}

export function serializeBlocks(blocks: ReadonlyArray<ContextBlock | null>): string {
  const rendered = blocks
    .filter((b): b is ContextBlock => b !== null)
    .map((b) => b.render())
    .filter((text) => text.trim() !== "");
  if (rendered.length === 0) return "";
  return rendered.join("\n\n");
}
