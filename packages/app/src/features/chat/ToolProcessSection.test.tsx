import { act, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { ToolProcessSection } from "./ToolProcessSection";
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

function renderSection(tools: ToolItem[]) {
  const view = renderWithProviders(<ToolProcessSection tools={tools} />);
  return {
    ...view,
    rerenderWith: (next: ToolItem[]) => view.rerender(<ToolProcessSection tools={next} />),
  };
}

describe("ToolProcessSection", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays collapsed when all tools are completed", () => {
    renderSection([tool()]);
    expect(screen.getByText("执行过程")).toBeInTheDocument();
    expect(screen.getByText("1 次调用")).toBeInTheDocument();
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("renders nothing when tools are empty", () => {
    const { container } = renderSection([]);
    expect(container.querySelector("[data-chat-tool-process]")).toBeNull();
  });

  it("auto-expands only after running persists beyond the delay", async () => {
    renderSection([tool({ status: "running" })]);
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(251); });
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("never expands when a tool finishes within the delay window", async () => {
    const { rerenderWith } = renderSection([tool({ toolCallId: "tc-fast", status: "running" })]);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    rerenderWith([tool({ toolCallId: "tc-fast", status: "completed" })]);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("collapses immediately once all running tools settle", async () => {
    const { rerenderWith } = renderSection([tool({ status: "running" })]);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByText("read_file")).toBeInTheDocument();

    rerenderWith([tool({ status: "completed" })]);
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("keeps a user-opened section open after tools settle", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerenderWith } = renderSection([tool({ status: "running" })]);
    await user.click(screen.getByRole("button", { name: /执行过程/ }));
    expect(screen.getByText("read_file")).toBeInTheDocument();

    rerenderWith([tool({ status: "completed" })]);
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("keeps a user-collapsed section collapsed even when new tools start running", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerenderWith } = renderSection([tool({ status: "running" })]);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByText("read_file")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /执行过程/ }));
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();

    rerenderWith([tool({ status: "completed" }), tool({ toolCallId: "tc2", toolName: "search_content", args: {}, status: "running" })]);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("shows the error count badge without changing the default state", () => {
    renderSection([tool({ status: "error" }), tool({ toolCallId: "tc2", status: "error" })]);
    expect(screen.getByText("2 个失败")).toBeInTheDocument();
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("preserves user intent across an empty-tools gap", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerenderWith } = renderSection([tool({ status: "running" })]);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await user.click(screen.getByRole("button", { name: /执行过程/ }));
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();

    rerenderWith([]);
    expect(document.querySelector("[data-chat-tool-process]")).toBeNull();

    rerenderWith([tool({ status: "running" })]);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("exposes the data-chat-tool-process theme hook", () => {
    renderSection([tool()]);
    expect(document.querySelector("[data-chat-tool-process]")).not.toBeNull();
  });
});
