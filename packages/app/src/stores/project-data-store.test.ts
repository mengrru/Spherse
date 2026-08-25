import { beforeEach, describe, expect, it } from "vitest";
import { useProjectDataStore } from "./project-data-store";

describe("useProjectDataStore", () => {
  beforeEach(() => {
    useProjectDataStore.setState({ projects: {} });
  });

  it("stores and consumes an initial message", () => {
    const store = useProjectDataStore.getState();
    store.setInitialMessage("project-1", "session-1", "hello");

    expect(useProjectDataStore.getState().projects["project-1"]?.initialMessageBySessionId).toEqual({
      "session-1": "hello",
    });
    expect(useProjectDataStore.getState().consumeInitialMessage("project-1", "session-1")).toBe("hello");
    expect(useProjectDataStore.getState().projects["project-1"]?.initialMessageBySessionId).toEqual({});
  });

  it("tracks streaming sessions per project", () => {
    const store = useProjectDataStore.getState();
    store.setStreaming("project-1", "session-1", true);

    expect(useProjectDataStore.getState().projects["project-1"]?.streamingSessionIds).toEqual(
      new Set(["session-1"]),
    );
  });

  it("clears all runtime state for a project", () => {
    useProjectDataStore.getState().setStreaming("project-1", "session-1", true);
    useProjectDataStore.getState().clearProjectData("project-1");

    expect(useProjectDataStore.getState().projects["project-1"]).toBeUndefined();
  });
});
