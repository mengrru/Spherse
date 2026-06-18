import { beforeEach, describe, expect, it } from "vitest";
import { useProjectUiStore } from "./project-ui-store";

describe("useProjectUiStore", () => {
  beforeEach(() => {
    useProjectUiStore.setState({ projects: {} });
  });

  it("clears one project while keeping others", () => {
    useProjectUiStore.getState().setFloatingChat("project-2", {
      sessionId: "session-1",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
    });
    useProjectUiStore.getState().clearProjectUi("project-1");

    expect(useProjectUiStore.getState().projects["project-1"]).toBeUndefined();
    expect(useProjectUiStore.getState().projects["project-2"]?.floatingChat).toBeDefined();
  });
});
