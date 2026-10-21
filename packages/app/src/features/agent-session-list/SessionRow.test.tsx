import { fireEvent, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { createMockHostBridge } from "../../test/host-bridge";
import type { AgentSessionActions } from "./actions-context";
import { AgentSessionActionsProvider } from "./actions-context";
import type { SessionInfo } from "../../lib/types";
import { SessionRow } from "./SessionRow";

const session: SessionInfo = {
  id: "s1",
  agentId: "a1",
  title: "My session",
  createdAt: 1,
  updatedAt: 2,
  status: "active",
};

function makeActions(): AgentSessionActions {
  return {
    toggleAgentCollapsed: vi.fn(),
    newSession: vi.fn(),
    triggerAgent: vi.fn(),
    mcpAgent: vi.fn(),
    memoryAgent: vi.fn(),
    editAgent: vi.fn(),
    deleteAgent: vi.fn(),
    selectSession: vi.fn(),
    deleteSession: vi.fn(),
    renameSession: vi.fn(async () => true),
    floatSession: vi.fn(),
    cancelFloat: vi.fn(),
    exportSession: vi.fn(),
    showSessionStatus: vi.fn(),
  };
}

function open(overrides: { floating?: boolean; webBridge?: boolean } = {}) {
  const actions = makeActions();
  renderWithProviders(
    <AgentSessionActionsProvider actions={actions}>
      <SessionRow session={session} active={false} floating={overrides.floating ?? false} />
    </AgentSessionActionsProvider>,
    {
      locale: "en",
      bridge: createMockHostBridge(overrides.webBridge ? { kind: "web" } : {}),
    },
  );
  fireEvent.contextMenu(screen.getByText("My session"));
  return { actions };
}

describe("SessionRow context menu order", () => {
  it("places Rename before Float when floating chat is available", async () => {
    open();
    const names = (await screen.findAllByRole("menuitem")).map((el) => el.textContent);
    expect(names).toEqual([
      "Rename",
      "Float",
      "Copy session ID",
      "Export chat log",
      "Session status",
      "Delete",
    ]);
  });

  it("shows Cancel Float second when the session is already floated", async () => {
    open({ floating: true });
    const names = (await screen.findAllByRole("menuitem")).map((el) => el.textContent);
    expect(names[0]).toBe("Rename");
    expect(names[1]).toBe("Cancel Float");
  });

  it("keeps Rename available when the float item is feature-gated off (web host)", async () => {
    open({ webBridge: true });
    const names = (await screen.findAllByRole("menuitem")).map((el) => el.textContent);
    expect(names).toEqual([
      "Rename",
      "Copy session ID",
      "Export chat log",
      "Session status",
      "Delete",
    ]);
  });

  it("Rename enters inline editing and Float calls the action", async () => {
    const { actions } = open();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    expect(await screen.findByDisplayValue("My session")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    fireEvent.contextMenu(screen.getByText("My session"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Float" }));
    expect(actions.floatSession).toHaveBeenCalledWith(session);
  });
});
