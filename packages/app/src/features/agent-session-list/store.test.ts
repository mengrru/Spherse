import { beforeEach, describe, expect, it } from "vitest";
import { useAgentSessionListUiStore } from "./store";

describe("useAgentSessionListUiStore", () => {
  beforeEach(() => {
    useAgentSessionListUiStore.setState({ collapsedAgentIdsByProject: {} });
  });

  it("tracks collapsed agents per project", () => {
    useAgentSessionListUiStore.getState().toggleAgentCollapsed("project-1", "agent-1");
    useAgentSessionListUiStore.getState().toggleAgentCollapsed("project-2", "agent-2");

    expect(useAgentSessionListUiStore.getState().collapsedAgentIdsByProject["project-1"]).toEqual(
      new Set(["agent-1"]),
    );
    expect(useAgentSessionListUiStore.getState().collapsedAgentIdsByProject["project-2"]).toEqual(
      new Set(["agent-2"]),
    );
  });

  it("can replace collapsed agents and clear one project", () => {
    useAgentSessionListUiStore.getState().setCollapsedAgentIds("project-1", ["agent-1", "agent-2"]);
    useAgentSessionListUiStore.getState().setCollapsedAgentIds("project-2", ["agent-3"]);
    useAgentSessionListUiStore.getState().clearProject("project-1");

    expect(useAgentSessionListUiStore.getState().collapsedAgentIdsByProject["project-1"]).toBeUndefined();
    expect(useAgentSessionListUiStore.getState().collapsedAgentIdsByProject["project-2"]).toEqual(
      new Set(["agent-3"]),
    );
  });

  it("toggles off an already-collapsed agent", () => {
    useAgentSessionListUiStore.getState().setCollapsedAgentIds("project-1", ["agent-1", "agent-2"]);
    useAgentSessionListUiStore.getState().toggleAgentCollapsed("project-1", "agent-1");

    expect(useAgentSessionListUiStore.getState().collapsedAgentIdsByProject["project-1"]).toEqual(
      new Set(["agent-2"]),
    );
  });
});
