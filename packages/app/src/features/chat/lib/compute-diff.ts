import { diffLines } from "diff"

export interface DiffLine {
  type: "removed" | "added" | "unchanged"
  text: string
}

export interface LineDiffResult {
  left: DiffLine[]
  right: DiffLine[]
}

function splitLines(value: string): string[] {
  const parts = value.split("\n")
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop()
  }
  return parts
}

export function computeLineDiff(
  oldString: string,
  newString: string,
): LineDiffResult {
  const changes = diffLines(oldString, newString)
  const left: DiffLine[] = []
  const right: DiffLine[] = []

  for (const change of changes) {
    const lines = splitLines(change.value)
    if (change.added) {
      for (const text of lines) {
        right.push({ type: "added", text })
      }
    } else if (change.removed) {
      for (const text of lines) {
        left.push({ type: "removed", text })
      }
    } else {
      for (const text of lines) {
        left.push({ type: "unchanged", text })
        right.push({ type: "unchanged", text })
      }
    }
  }

  return { left, right }
}
