import { beforeEach, describe, expect, it } from "vitest";
import { useProjectUiStore } from "./project-ui-store";

describe("useProjectUiStore", () => {
  beforeEach(() => {
    useProjectUiStore.setState({ projects: {} });
  });

  it("tracks collapsed agents per project", () => {
    useProjectUiStore.getState().toggleAgentCollapsed("project-1", "agent-1");
    useProjectUiStore.getState().toggleAgentCollapsed("project-2", "agent-2");

    expect(useProjectUiStore.getState().projects["project-1"]?.collapsedAgentIds).toEqual(
      new Set(["agent-1"]),
    );
    expect(useProjectUiStore.getState().projects["project-2"]?.collapsedAgentIds).toEqual(
      new Set(["agent-2"]),
    );
  });

  it("can replace collapsed agents and clear one project", () => {
    useProjectUiStore.getState().setCollapsedAgentIds("project-1", ["agent-1", "agent-2"]);
    useProjectUiStore.getState().setCollapsedAgentIds("project-2", ["agent-3"]);
    useProjectUiStore.getState().clearProjectUi("project-1");

    expect(useProjectUiStore.getState().projects["project-1"]).toBeUndefined();
    expect(useProjectUiStore.getState().projects["project-2"]?.collapsedAgentIds).toEqual(
      new Set(["agent-3"]),
    );
  });

});
