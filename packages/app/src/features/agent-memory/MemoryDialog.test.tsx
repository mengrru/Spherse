import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { I18nProvider } from "@spherse/i18n/react";
import { renderWithProviders } from "../../test/render";
import { MemoryDialog } from "./MemoryDialog";
import type { AgentMemoryEntry } from "../../lib/types";

const entries: AgentMemoryEntry[] = [
  { id: "e1", content: "用户喜欢绿茶", tags: ["偏好"], createdAt: 1, updatedAt: 1 },
  { id: "e2", content: "The project is called Spherse", createdAt: 2, updatedAt: 2 },
];

const client = {
  listAgents: vi.fn(async () => [{ id: "a1", name: "Mem Agent", slug: "mem-agent" }]),
  getAgentMemory: vi.fn(async () => ({ enabled: false, core: "", coreLimit: 4000 })),
  updateAgentMemory: vi.fn(async () => ({ enabled: true, core: "core", coreLimit: 4000 })),
  listAgentMemoryEntries: vi.fn(async () => entries),
  updateAgentMemoryEntry: vi.fn(async (id: string, patch: { content?: string }) => ({
    ...entries[0],
    ...patch,
  })),
  deleteAgentMemoryEntry: vi.fn(async () => ({ ok: true })),
};

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => client,
}));

function setup() {
  return renderWithProviders(
    <I18nProvider locale="zh-CN">
      <MemoryDialog open={true} onOpenChange={() => {}} agentId="a1" projectId="p1" />
    </I18nProvider>,
    { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
  );
}

describe("MemoryDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.getAgentMemory.mockResolvedValue({ enabled: false, core: "", coreLimit: 4000 });
    client.listAgentMemoryEntries.mockResolvedValue(entries);
  });

  it("loads config and entries, renders switch off by default", async () => {
    setup();

    expect(await screen.findByText("用户喜欢绿茶")).toBeInTheDocument();
    expect(screen.getByText("The project is called Spherse")).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(client.getAgentMemory).toHaveBeenCalledWith("a1");
  });

  it("saves enabled state and core together", async () => {
    const user = userEvent.setup();
    setup();

    await screen.findByText("用户喜欢绿茶");
    await user.click(screen.getByRole("switch"));
    await user.type(screen.getByLabelText("核心记忆"), "用户偏好简洁回复");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(client.updateAgentMemory).toHaveBeenCalledWith("a1", {
        enabled: true,
        core: "用户偏好简洁回复",
      }),
    );
  });

  it("blocks save when core exceeds the limit", async () => {
    client.getAgentMemory.mockResolvedValue({ enabled: true, core: "", coreLimit: 10 });
    const user = userEvent.setup();
    setup();

    await screen.findByText("用户喜欢绿茶");
    await user.type(screen.getByLabelText("核心记忆"), "这一段内容明显超过十个字符的上限");
    expect(screen.getByText(/核心记忆超过长度上限/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(client.updateAgentMemory).not.toHaveBeenCalled();
  });

  it("edits an entry inline and saves immediately", async () => {
    const user = userEvent.setup();
    setup();

    await screen.findByText("用户喜欢绿茶");
    await user.click(screen.getAllByRole("button", { name: "编辑" })[0]);
    const textbox = screen.getByLabelText("记忆内容");
    await user.clear(textbox);
    await user.type(textbox, "用户改喝红茶");
    await user.click(within(textbox.closest("li")!).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(client.updateAgentMemoryEntry).toHaveBeenCalledWith(
        "a1",
        "e1",
        expect.objectContaining({ content: "用户改喝红茶" }),
      ),
    );
  });

  it("deletes an entry after confirmation", async () => {
    const user = userEvent.setup();
    setup();

    await screen.findByText("用户喜欢绿茶");
    await user.click(screen.getAllByRole("button", { name: "删除" })[0]);
    const confirmDialog = await screen.findByRole("alertdialog");
    await user.click(within(confirmDialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(client.deleteAgentMemoryEntry).toHaveBeenCalledWith("a1", "e1"));
  });
});
