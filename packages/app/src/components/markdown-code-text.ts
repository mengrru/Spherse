import { isValidElement, type ReactNode } from "react";

function isIterableNode(value: unknown): value is Iterable<ReactNode> {
  if (typeof value !== "object" || value === null) return false;
  return Symbol.iterator in value;
}

export function extractCodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(extractCodeText).join("");
  if (isValidElement(node)) {
    return extractCodeText((node.props as { children?: ReactNode }).children);
  }
  if (isIterableNode(node)) return Array.from(node).map(extractCodeText).join("");
  return "";
}
