import { describe, expect, it } from "vitest";
import { extractDroppedFiles, hasFileDrag } from "./dnd";

function makeEntry(isDirectory: boolean): FileSystemEntry {
  return { isDirectory } as unknown as FileSystemEntry;
}

function makeItem(overrides: Partial<DataTransferItem>): DataTransferItem {
  return {
    kind: "file",
    getAsFile: () => null,
    webkitGetAsEntry: () => null,
    ...overrides,
  } as unknown as DataTransferItem;
}

function makeFile(name: string): File {
  return new File(["content"], name, { type: "text/plain" });
}

describe("hasFileDrag", () => {
  it("is true only when the drag carries Files", () => {
    expect(hasFileDrag({ types: ["Files"] } as unknown as DataTransfer)).toBe(true);
    expect(hasFileDrag({ types: ["text/plain"] } as unknown as DataTransfer)).toBe(false);
    expect(hasFileDrag(null)).toBe(false);
  });
});

describe("extractDroppedFiles", () => {
  it("returns plain files and skips directory entries", () => {
    const a = makeFile("a.txt");
    const b = makeFile("b.md");
    const dt = {
      items: [
        makeItem({ getAsFile: () => a }),
        makeItem({ webkitGetAsEntry: () => makeEntry(true) }),
        makeItem({ getAsFile: () => b }),
      ],
      files: [a, makeFile("shadowed.txt")],
    } as unknown as DataTransfer;
    expect(extractDroppedFiles(dt)).toEqual([a, b]);
  });

  it("drops entries whose file representation is unavailable", () => {
    const dt = {
      items: [makeItem({ getAsFile: () => null })],
      files: [],
    } as unknown as DataTransfer;
    expect(extractDroppedFiles(dt)).toEqual([]);
  });

  it("falls back to dataTransfer.files when the entries API is unavailable", () => {
    const a = makeFile("a.txt");
    const dt = {
      items: [makeItem({ webkitGetAsEntry: undefined })],
      files: [a],
    } as unknown as DataTransfer;
    expect(extractDroppedFiles(dt)).toEqual([a]);
  });
});
