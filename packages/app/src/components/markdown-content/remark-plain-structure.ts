import type { List, Nodes, Paragraph, PhrasingContent, Root, Table } from "mdast";

type Line = PhrasingContent[];

const INDENT = "\u00a0\u00a0";

function text(value: string): PhrasingContent {
  return { type: "text", value };
}

function blockLines(node: Nodes, indent: string): Line[] {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return [[text(indent), ...node.children]];
    case "code":
      return [[text(indent + node.value.replace(/\n$/, ""))]];
    case "html":
      return [[text(indent + node.value)]];
    case "thematicBreak":
      return [[text(indent + "---")]];
    case "blockquote":
      return node.children.flatMap((child) => blockLines(child, indent));
    case "list":
      return listLines(node, indent);
    case "table":
      return tableLines(node);
    default:
      return [];
  }
}

function listLines(list: List, indent: string): Line[] {
  const lines: Line[] = [];
  let number = list.start ?? 1;
  for (const item of list.children) {
    const checkbox = item.checked === true ? "[x] " : item.checked === false ? "[ ] " : "";
    const marker = `${indent}${list.ordered ? `${number}. ` : "- "}${checkbox}`;
    if (item.children.length === 0) {
      lines.push([text(marker)]);
    }
    let firstLineOfItem = true;
    for (const block of item.children) {
      let groups: Line[];
      if (block.type === "list") {
        groups = listLines(block, `${indent}${INDENT}`);
      } else if (block.type === "table") {
        groups = tableLines(block);
      } else {
        groups = blockLines(block, firstLineOfItem ? "" : `${indent}${INDENT}`);
      }
      for (const line of groups) {
        lines.push(firstLineOfItem ? [text(marker), ...line] : line);
        firstLineOfItem = false;
      }
    }
    number += 1;
  }
  return lines;
}

function tableLines(table: Table): Line[] {
  const lines: Line[] = [];
  table.children.forEach((row, rowIndex) => {
    const line: PhrasingContent[] = [];
    row.children.forEach((cell, cellIndex) => {
      if (cellIndex > 0) line.push(text(" | "));
      line.push(...cell.children);
    });
    lines.push(line);
    if (rowIndex === 0) {
      const separator: PhrasingContent[] = [];
      row.children.forEach((_, cellIndex) => {
        if (cellIndex > 0) separator.push(text(" | "));
        separator.push(text("---"));
      });
      lines.push(separator);
    }
  });
  return lines;
}

function toParagraph(lines: Line[]): Paragraph {
  const children: PhrasingContent[] = [];
  lines.forEach((line, index) => {
    if (index > 0) children.push(text("\n"));
    children.push(...line);
  });
  return { type: "paragraph", children };
}

function rewriteStructuralNodes(node: Nodes): void {
  if (!("children" in node) || !Array.isArray(node.children)) return;
  const rewritten: Nodes[] = [];
  for (const child of node.children as Nodes[]) {
    if (child.type === "list") {
      rewritten.push(toParagraph(listLines(child, "")));
    } else if (child.type === "table") {
      rewritten.push(toParagraph(tableLines(child)));
    } else if (child.type === "thematicBreak") {
      rewritten.push(toParagraph([[text("---")]]));
    } else {
      rewriteStructuralNodes(child);
      rewritten.push(child);
    }
  }
  (node as { children: Nodes[] }).children = rewritten;
}

export function remarkPlainStructure() {
  return (tree: Root) => {
    rewriteStructuralNodes(tree);
  };
}
