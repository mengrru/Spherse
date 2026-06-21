import { describe, expect, it } from "vitest"
import { computeLineDiff } from "./compute-diff"

describe("computeLineDiff", () => {
  it("marks all lines as unchanged when strings are identical", () => {
    const { left, right } = computeLineDiff("a\nb", "a\nb")

    expect(left.every((l) => l.type === "unchanged")).toBe(true)
    expect(right.every((l) => l.type === "unchanged")).toBe(true)
    expect(left.map((l) => l.text)).toEqual(["a", "b"])
    expect(right.map((l) => l.text)).toEqual(["a", "b"])
  })

  it("returns equal-length left/right arrays for identical strings", () => {
    const { left, right } = computeLineDiff("a\nb\nc", "a\nb\nc")

    expect(left).toHaveLength(3)
    expect(right).toHaveLength(3)
    expect(left.length).toBe(right.length)
  })

  it("marks newly added lines as added on the right column only", () => {
    const { left, right } = computeLineDiff("a\nc", "a\nb\nc")

    const added = right.filter((l) => l.type === "added")
    expect(added.map((l) => l.text)).toEqual(["b"])
    expect(left.every((l) => l.type !== "added")).toBe(true)
    expect(left.every((l) => l.type !== "removed")).toBe(true)
    expect(right.every((l) => l.type !== "removed")).toBe(true)
  })

  it("marks removed lines as removed on the left column only", () => {
    const { left, right } = computeLineDiff("a\nb\nc", "a\nc")

    const removed = left.filter((l) => l.type === "removed")
    expect(removed.map((l) => l.text)).toEqual(["b"])
    expect(right.every((l) => l.type !== "removed")).toBe(true)
    expect(right.every((l) => l.type !== "added")).toBe(true)
    expect(left.every((l) => l.type !== "added")).toBe(true)
  })

  it("handles mixed additions and removals in the correct columns", () => {
    const { left, right } = computeLineDiff("a\nb\nc", "a\nx\nc")

    expect(left.map((l) => ({ t: l.type, x: l.text }))).toEqual([
      { t: "unchanged", x: "a" },
      { t: "removed", x: "b" },
      { t: "unchanged", x: "c" },
    ])
    expect(right.map((l) => ({ t: l.type, x: l.text }))).toEqual([
      { t: "unchanged", x: "a" },
      { t: "added", x: "x" },
      { t: "unchanged", x: "c" },
    ])
  })

  it("splits multi-line change values by newline", () => {
    const { left, right } = computeLineDiff("a\nb\nc", "a\nx\ny\nc")

    expect(right.map((l) => l.text)).toEqual(["a", "x", "y", "c"])
    expect(
      right.filter((l) => l.type === "added").map((l) => l.text),
    ).toEqual(["x", "y"])
    expect(left.map((l) => l.text)).toEqual(["a", "b", "c"])
    expect(
      left.filter((l) => l.type === "removed").map((l) => l.text),
    ).toEqual(["b"])
  })

  it("produces no removed or added lines when old === new", () => {
    const { left, right } = computeLineDiff("same\ncontent", "same\ncontent")

    expect(left.filter((l) => l.type !== "unchanged")).toEqual([])
    expect(right.filter((l) => l.type !== "unchanged")).toEqual([])
  })

  it("handles empty strings as input", () => {
    const { left, right } = computeLineDiff("", "")

    expect(left).toEqual([])
    expect(right).toEqual([])
  })

  it("treats empty old string as all-added", () => {
    const { left, right } = computeLineDiff("", "a\nb")

    expect(left).toEqual([])
    expect(right).toEqual([
      { type: "added", text: "a" },
      { type: "added", text: "b" },
    ])
  })

  it("treats empty new string as all-removed", () => {
    const { left, right } = computeLineDiff("a\nb", "")

    expect(right).toEqual([])
    expect(left).toEqual([
      { type: "removed", text: "a" },
      { type: "removed", text: "b" },
    ])
  })

  it("does not produce trailing empty lines from trailing newlines", () => {
    const { left, right } = computeLineDiff("a\n", "b\n")

    expect(left.map((l) => l.text)).toEqual(["a"])
    expect(right.map((l) => l.text)).toEqual(["b"])
  })
})
