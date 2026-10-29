import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ApiClient } from "../../lib/api";
import { renderWithProviders } from "../../test/render";
import { TurnContextDialog } from "./TurnContextDialog";

const sessionId = "s1";

const events = [
  {
    seq: 0,
    type: "user/message",
    time: 1700000000000,
    data: { message: { role: "user", content: "hello world" } },
  },
  { seq: 1, type: "turn/start", time: 1700000000000, data: {} },
  {
    seq: 2,
    type: "assistant/message",
    time: 1700000000001,
    data: { message: { role: "assistant", content: [{ type: "text", text: "hi there" }] } },
  },
  { seq: 3, type: "turn/end", time: 1700000000002, data: { reason: "completed" } },
];

function createClient(overrides?: Partial<Record<"getSessionEvents" | "getTurnContext", ReturnType<typeof vi.fn>>>) {
  return {
    getSession: vi.fn().mockResolvedValue({ id: sessionId, agentId: "a1", status: "active" }),
    listProjectSessions: vi.fn().mockResolvedValue({
      sessions: [{ id: sessionId, agentId: "a1", status: "active" }],
      byAgent: {},
    }),
    getSessionEvents: overrides?.getSessionEvents ?? vi.fn().mockResolvedValue({ sessionId, events }),
    getTurnContext:
      overrides?.getTurnContext ??
      vi.fn().mockResolvedValue({
        sessionId,
        capturedAt: "t",
        systemPrompt: "p",
        messages: [],
        tools: [],
        compaction: null,
        compactionCount: 0,
      }),
  } as unknown as ApiClient;
}

describe("TurnContextDialog", () => {
  let user: ReturnType<typeof userEvent.setup>;
  let clipboardWriteText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    user = userEvent.setup();
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the event log with type badges and count", async () => {
    renderWithProviders(
      <TurnContextDialog projectId="p1" client={createClient()} sessionId={sessionId} onClose={vi.fn()} />,
    );
    expect(await screen.findByText("user/message")).toBeInTheDocument();
    expect(screen.getByText("assistant/message")).toBeInTheDocument();
    expect(screen.getByText("turn/start")).toBeInTheDocument();
    expect(screen.getByText("turn/end")).toBeInTheDocument();
    expect(screen.getByText("4 events")).toBeInTheDocument();
    expect(screen.getByText("未压缩")).toBeInTheDocument();
  });

  it("renders a compaction status line derived from the latest compaction event", async () => {
    const compactionEvents = [
      ...events,
      {
        seq: 4,
        type: "compaction/applied",
        time: 1700000000003,
        data: {
          anchorSeq: 2,
          digestContent: "summary of earlier turns",
          excludedSeqs: [3],
          digestSource: "llm",
        },
      },
      {
        seq: 6,
        type: "compaction/applied",
        time: 1700000000005,
        data: {
          anchorSeq: 4,
          digestContent: "second summary",
          excludedSeqs: [],
          digestSource: "mechanical",
        },
      },
    ];
    renderWithProviders(
      <TurnContextDialog
        projectId="p1"
        client={createClient({ getSessionEvents: vi.fn().mockResolvedValue({ sessionId, events: compactionEvents }) })}
        sessionId={sessionId}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText(/最近一次压缩：seq 6 · 锚点 4 · 来源 mechanical · 排除 0 条/)).toBeInTheDocument();
    expect(screen.getByText(/摘要 14 字符 · 累计 2 次/)).toBeInTheDocument();
    expect(screen.queryByText("未压缩")).not.toBeInTheDocument();
  });

  it("renders a compaction/applied event row with badge and preview", async () => {
    const compactionEvents = [
      ...events,
      {
        seq: 4,
        type: "compaction/applied",
        time: 1700000000003,
        data: {
          anchorSeq: 2,
          digestContent: "summary of earlier turns",
          excludedSeqs: [3],
          digestSource: "llm",
        },
      },
    ];
    renderWithProviders(
      <TurnContextDialog
        projectId="p1"
        client={createClient({ getSessionEvents: vi.fn().mockResolvedValue({ sessionId, events: compactionEvents }) })}
        sessionId={sessionId}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText("compaction/applied")).toBeInTheDocument();
    expect(screen.getByText("anchorSeq: 2 · summary of earlier turns")).toBeInTheDocument();
    expect(screen.getByText("5 events")).toBeInTheDocument();
  });

  it("filters events by type via the search box", async () => {
    renderWithProviders(
      <TurnContextDialog projectId="p1" client={createClient()} sessionId={sessionId} onClose={vi.fn()} />,
    );
    await screen.findByText("user/message");
    await user.type(screen.getByPlaceholderText("Filter by event type…"), "assistant");
    expect(screen.getByText("1 events")).toBeInTheDocument();
    expect(screen.queryByText("user/message")).not.toBeInTheDocument();
    expect(screen.getByText("assistant/message")).toBeInTheDocument();
  });

  it("expands a row on click and copies its full JSON", async () => {
    renderWithProviders(
      <TurnContextDialog projectId="p1" client={createClient()} sessionId={sessionId} onClose={vi.fn()} />,
    );
    await screen.findByText("user/message");
    await user.click(screen.getByRole("button", { name: /user\/message/ }));
    expect(screen.getByText(/"seq": 0/)).toBeInTheDocument();
    await user.click(screen.getAllByTitle("Copy")[0]);
    expect(clipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('"type": "user/message"'));
  });

  it("downloads the folded turn context via the header button", async () => {
    const getTurnContext = vi.fn().mockResolvedValue({
      sessionId,
      capturedAt: "t",
      systemPrompt: "p",
      messages: [],
      tools: [],
      compaction: {
        seq: 6,
        anchorSeq: 4,
        digestSource: "llm",
        excludedCount: 0,
        digestLength: 14,
        appliedAtMs: 1700000000005,
      },
      compactionCount: 1,
    });
    const createObjectURL = vi.fn((_: Blob) => "blob:mock");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true, writable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderWithProviders(
      <TurnContextDialog
        projectId="p1"
        client={createClient({ getTurnContext })}
        sessionId={sessionId}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText("user/message");
    await user.click(screen.getByRole("button", { name: "Download Turn Context" }));
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(getTurnContext).toHaveBeenCalledWith(sessionId);
    expect(createObjectURL).toHaveBeenCalled();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    await expect(blob.text()).resolves.toContain('"compactionCount": 1');
    await expect(blob.text()).resolves.toContain('"anchorSeq": 4');
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("shows the load-failure state with a retry button", async () => {
    const getSessionEvents = vi.fn().mockRejectedValue(new Error("boom"));
    renderWithProviders(
      <TurnContextDialog
        projectId="p1"
        client={createClient({ getSessionEvents })}
        sessionId={sessionId}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText("Failed to load event log")).toBeInTheDocument();
    const refreshButtons = screen.getAllByRole("button", { name: "Refresh" });
    expect(refreshButtons).toHaveLength(2);
    await user.click(refreshButtons[1]);
    await vi.waitFor(() => expect(getSessionEvents).toHaveBeenCalledTimes(2));
  });

  it("keeps the loaded log when a refresh fails", async () => {
    const getSessionEvents = vi
      .fn()
      .mockResolvedValueOnce({ sessionId, events })
      .mockRejectedValueOnce(new Error("boom"));
    renderWithProviders(
      <TurnContextDialog
        projectId="p1"
        client={createClient({ getSessionEvents })}
        sessionId={sessionId}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText("user/message")).toBeInTheDocument();
    await user.click(screen.getByTitle("Refresh"));
    await vi.waitFor(() => expect(getSessionEvents).toHaveBeenCalledTimes(2));
    expect(screen.getByText("user/message")).toBeInTheDocument();
    expect(screen.getByText("4 events")).toBeInTheDocument();
    expect(screen.queryByText("Failed to load event log")).not.toBeInTheDocument();
  });
});
