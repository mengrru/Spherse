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
      vi.fn().mockResolvedValue({ sessionId, capturedAt: "t", systemPrompt: "p", messages: [], tools: [] }),
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
    });
    const createObjectURL = vi.fn(() => "blob:mock");
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
});
