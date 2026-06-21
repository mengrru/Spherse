import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../types"
import { aggregateFileChanges, attachRunChanges } from "./aggregate-file-changes"

function tc(
  toolCallId: string,
  toolName: string,
  path: string,
  status: "running" | "completed" | "error" = "completed",
  extra: Record<string, unknown> = {},
): ChatMessage[] {
  return [
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: "",
      _toolCalls: [
        {
          toolCallId,
          toolName,
          args: { path, ...extra },
          status,
        },
      ],
    },
  ]
}

describe("aggregateFileChanges", () => {
  it("groups a single write_file into one card with one op", () => {
    const messages = tc("tc1", "write_file", "a.txt", "completed", {
      content: "hello",
    })

    const cards = aggregateFileChanges(messages, messages.length - 1)

    expect(cards).toEqual([
      {
        path: "a.txt",
        ops: [
          {
            toolCallId: "tc1",
            toolName: "write_file",
            args: { path: "a.txt", content: "hello" },
          },
        ],
      },
    ])
  })

  it("aggregates multiple operations on the same file into one card, preserving order", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        _toolCalls: [
          {
            toolCallId: "tc1",
            toolName: "write_file",
            args: { path: "a.txt", content: "hello" },
            status: "completed",
          },
          {
            toolCallId: "tc2",
            toolName: "edit_file",
            args: { path: "a.txt", oldText: "hello", newText: "hi" },
            status: "completed",
          },
          {
            toolCallId: "tc3",
            toolName: "edit_file",
            args: { path: "a.txt", oldText: "hi", newText: "hey" },
            status: "completed",
          },
        ],
      },
    ]

    const cards = aggregateFileChanges(messages, messages.length - 1)

    expect(cards).toHaveLength(1)
    expect(cards[0].path).toBe("a.txt")
    expect(cards[0].ops.map((o) => o.toolCallId)).toEqual([
      "tc1",
      "tc2",
      "tc3",
    ])
  })

  it("groups interleaved operations across multiple files by first-appearance order", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        _toolCalls: [
          {
            toolCallId: "tc1",
            toolName: "write_file",
            args: { path: "b.txt", content: "b" },
            status: "completed",
          },
          {
            toolCallId: "tc2",
            toolName: "write_file",
            args: { path: "a.txt", content: "a" },
            status: "completed",
          },
          {
            toolCallId: "tc3",
            toolName: "edit_file",
            args: { path: "b.txt", oldText: "b", newText: "bb" },
            status: "completed",
          },
        ],
      },
    ]

    const cards = aggregateFileChanges(messages, messages.length - 1)

    expect(cards.map((c) => c.path)).toEqual(["b.txt", "a.txt"])
    expect(cards[0].ops.map((o) => o.toolCallId)).toEqual(["tc1", "tc3"])
    expect(cards[1].ops.map((o) => o.toolCallId)).toEqual(["tc2"])
  })

  it("aggregates across multiple assistant messages within the same run", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        _toolCalls: [
          {
            toolCallId: "tc1",
            toolName: "write_file",
            args: { path: "a.txt", content: "a" },
            status: "completed",
          },
        ],
      },
      {
        role: "assistant",
        content: "",
        _toolCalls: [
          {
            toolCallId: "tc2",
            toolName: "edit_file",
            args: { path: "a.txt", oldText: "a", newText: "aa" },
            status: "completed",
          },
        ],
      },
    ]

    const cards = aggregateFileChanges(messages, messages.length - 1)

    expect(cards).toHaveLength(1)
    expect(cards[0].ops.map((o) => o.toolCallId)).toEqual(["tc1", "tc2"])
  })

  it("only aggregates the current run when multiple runs are separated by user messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "first" },
      {
        role: "assistant",
        content: "",
        _toolCalls: [
          {
            toolCallId: "old1",
            toolName: "write_file",
            args: { path: "old.txt", content: "old" },
            status: "completed",
          },
        ],
      },
      { role: "user", content: "second" },
      {
        role: "assistant",
        content: "",
        _toolCalls: [
          {
            toolCallId: "new1",
            toolName: "write_file",
            args: { path: "new.txt", content: "new" },
            status: "completed",
          },
        ],
      },
    ]

    const cards = aggregateFileChanges(messages, messages.length - 1)

    expect(cards.map((c) => c.path)).toEqual(["new.txt"])
    expect(cards[0].ops.map((o) => o.toolCallId)).toEqual(["new1"])
  })

  it("excludes tool calls with status running", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        _toolCalls: [
          {
            toolCallId: "tc1",
            toolName: "write_file",
            args: { path: "a.txt", content: "a" },
            status: "running",
          },
        ],
      },
    ]

    expect(aggregateFileChanges(messages, messages.length - 1)).toEqual([])
  })

  it("excludes tool calls with status error", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        _toolCalls: [
          {
            toolCallId: "tc1",
            toolName: "write_file",
            args: { path: "a.txt", content: "a" },
            status: "error",
          },
        ],
      },
    ]

    expect(aggregateFileChanges(messages, messages.length - 1)).toEqual([])
  })

  it("returns an empty array when the run has no write/edit tool calls", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        _toolCalls: [
          {
            toolCallId: "tc1",
            toolName: "read_file",
            args: { path: "a.txt" },
            status: "completed",
          },
        ],
      },
    ]

    expect(aggregateFileChanges(messages, messages.length - 1)).toEqual([])
  })

  it("skips tool calls whose args.path is not a string", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        _toolCalls: [
          {
            toolCallId: "tc1",
            toolName: "write_file",
            args: { content: "no path" },
            status: "completed",
          },
          {
            toolCallId: "tc2",
            toolName: "write_file",
            args: { path: 42, content: "wrong type" },
            status: "completed",
          },
          {
            toolCallId: "tc3",
            toolName: "write_file",
            args: { path: "a.txt", content: "ok" },
            status: "completed",
          },
        ],
      },
    ]

    const cards = aggregateFileChanges(messages, messages.length - 1)

    expect(cards.map((c) => c.path)).toEqual(["a.txt"])
    expect(cards[0].ops.map((o) => o.toolCallId)).toEqual(["tc3"])
  })

  it("returns an empty array for an empty message list", () => {
    expect(aggregateFileChanges([], 0)).toEqual([])
  })
})

describe("attachRunChanges", () => {
  it("attaches changes to the last assistant message in the run", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "first" },
      { role: "assistant", content: "last" },
    ]
    const changes = [{ path: "a.txt", ops: [] }]

    const next = attachRunChanges(messages, messages.length - 1, changes)

    expect(next).not.toBe(messages)
    expect(next[2]._runChanges).toBe(changes)
    expect(next[0]).toBe(messages[0])
    expect(next[1]).toBe(messages[1])
  })

  it("returns messages unchanged when there is no assistant message in the run", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
    ]
    const changes = [{ path: "a.txt", ops: [] }]

    const next = attachRunChanges(messages, messages.length - 1, changes)

    expect(next).toBe(messages)
  })

  it("does not attach to assistant messages from a previous run", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "prev run" },
      { role: "user", content: "second" },
    ]
    const changes = [{ path: "a.txt", ops: [] }]

    const next = attachRunChanges(messages, messages.length - 1, changes)

    expect(next).toBe(messages)
  })

  it("overwrites existing _runChanges on the target message", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "last", _runChanges: [] },
    ]
    const changes = [{ path: "a.txt", ops: [] }]

    const next = attachRunChanges(messages, messages.length - 1, changes)

    expect(next[1]._runChanges).toBe(changes)
  })
})
