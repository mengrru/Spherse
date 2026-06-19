import { beforeEach, describe, expect, it } from "vitest";
import { useFloatingChatStore } from "./store";

describe("useFloatingChatStore", () => {
  beforeEach(() => {
    useFloatingChatStore.setState({ byProject: {} });
  });

  it("sets and reads floating chat per project", () => {
    useFloatingChatStore.getState().setFloatingChat("project-1", {
      sessionId: "session-1",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
    });

    expect(useFloatingChatStore.getState().byProject["project-1"]?.sessionId).toBe("session-1");
  });

  it("clears one project while keeping others", () => {
    useFloatingChatStore.getState().setFloatingChat("project-2", {
      sessionId: "session-1",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
    });
    useFloatingChatStore.getState().clearProject("project-1");

    expect(useFloatingChatStore.getState().byProject["project-1"]).toBeUndefined();
    expect(useFloatingChatStore.getState().byProject["project-2"]).toBeDefined();
  });

  it("removes floating chat when set to null", () => {
    useFloatingChatStore.getState().setFloatingChat("project-1", {
      sessionId: "session-1",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
    });
    useFloatingChatStore.getState().setFloatingChat("project-1", null);

    expect(useFloatingChatStore.getState().byProject["project-1"]).toBeUndefined();
  });
});
