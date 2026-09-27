import { act, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { createMockHostBridge } from "../../test/host-bridge";
import { ThoughtBlock } from "./ThoughtBlock";
import type { ToolItem } from "./model/tool-item";

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({
    getPreviewUrl: (path: string) => `http://localhost:5173/api/projects/p1/preview/${path}`,
  }),
  useConnection: () => ({ baseUrl: "http://localhost:5173", accessToken: null }),
}));

function tool(overrides: Partial<ToolItem> = {}): ToolItem {
  return { toolCallId: "tc1", toolName: "read_file", args: { path: "a.ts" }, status: "completed", ...overrides };
}

type SectionProps = Partial<Parameters<typeof ThoughtBlock>[0]>;

function renderBlock(props: SectionProps) {
  const view = renderWithProviders(<ThoughtBlock tools={[]} {...props} />, {
    bridge: createMockHostBridge(),
  });
  return {
    ...view,
    rerenderWith: (next: SectionProps) => view.rerender(<ThoughtBlock tools={[]} {...props} {...next} />),
  };
}

describe("ThoughtBlock", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays collapsed when the turn has settled", () => {
    renderBlock({ tools: [tool()], active: false });
    expect(screen.getByText("思考过程")).toBeInTheDocument();
    expect(screen.getByText("1 次调用")).toBeInTheDocument();
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("renders nothing without tools or awaiting", () => {
    const { container } = renderBlock({ tools: [], active: true });
    expect(container.querySelector("[data-chat-thought]")).toBeNull();
  });

  it("shows the thinking title while awaiting the first token", () => {
    renderBlock({ tools: [], awaiting: true, active: true });
    expect(screen.getByText("正在思考…")).toBeInTheDocument();
    expect(screen.queryByText(/次调用/)).not.toBeInTheDocument();
  });

  it("does not auto-expand the empty waiting state", async () => {
    renderBlock({ tools: [], awaiting: true, active: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText("正在思考…")).toBeInTheDocument();
  });

  it("auto-expands only after a running tool persists beyond the delay", async () => {
    renderBlock({ tools: [tool({ status: "running" })], active: true });
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(251);
    });
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("stays expanded across tool batch gaps while the turn is active", async () => {
    const { rerenderWith } = renderBlock({ tools: [tool({ status: "running" })], active: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText("read_file")).toBeInTheDocument();

    rerenderWith({ tools: [tool({ status: "completed" })], active: true });
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("collapses once when the turn ends, even without user interaction", async () => {
    const { rerenderWith } = renderBlock({ tools: [tool({ status: "running" })], active: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    rerenderWith({ tools: [tool({ status: "completed" })], active: false });
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("keeps a user-opened block open after the turn settles", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerenderWith } = renderBlock({ tools: [tool({ status: "running" })], active: true });
    await user.click(screen.getByRole("button", { name: /正在思考…/ }));
    expect(screen.getByText("read_file")).toBeInTheDocument();

    rerenderWith({ tools: [tool({ status: "completed" })], active: false });
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("keeps a user-collapsed block collapsed even when new tools start running", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerenderWith } = renderBlock({ tools: [tool({ status: "running" })], active: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await user.click(screen.getByRole("button", { name: /正在思考…/ }));
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();

    rerenderWith({ tools: [tool({ status: "completed" }), tool({ toolCallId: "tc2", toolName: "search_content", args: {}, status: "running" })], active: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("preserves user intent across an empty-tools gap", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerenderWith } = renderBlock({ tools: [tool({ status: "running" })], active: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await user.click(screen.getByRole("button", { name: /正在思考…/ }));
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();

    rerenderWith({ tools: [], awaiting: true, active: true });
    rerenderWith({ tools: [tool({ status: "running" })], active: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("shows the error count badge without changing the default state", () => {
    renderBlock({ tools: [tool({ status: "error" }), tool({ toolCallId: "tc2", status: "error" })], active: false });
    expect(screen.getByText("2 个失败")).toBeInTheDocument();
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("renders run change cards", () => {
    renderBlock({
      tools: [tool()],
      active: false,
      runChanges: [{ path: "a.ts", ops: [{ toolCallId: "tc1", toolName: "write_file", args: { path: "a.ts" } }] }],
    });
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });

  it("shows the timestamp on a settled block when it is the last bubble", () => {
    renderBlock({ tools: [tool()], active: false, timestamp: 1_000, showTime: true });
    expect(screen.getByText(/:/)).toBeInTheDocument();
  });

  it("exposes the data-chat-thought theme hook", () => {
    renderBlock({ tools: [tool()], active: false });
    expect(document.querySelector("[data-chat-thought]")).not.toBeNull();
  });
});
