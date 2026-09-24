import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ProjectProvider } from "../context/project-context";
import {
  clearProjectNavHistory,
  dropFromProjectNavHistory,
  getProjectNavStack,
  projectBackTarget,
  recordProjectNavLocation,
  useProjectNavigation,
} from "./use-project-navigation";

describe("projectBackTarget", () => {
  it("returns the previous in-project page when navigating within the project", () => {
    const stack = [`/project/p1`, `/project/p1/content?path=a.md`];
    expect(projectBackTarget(stack, "p1")).toBe(`/project/p1`);
  });

  it("returns project home when the stack has only the current entry (deep-linked)", () => {
    const stack = [`/project/p1/content?path=a.md`];
    expect(projectBackTarget(stack, "p1")).toBe(`/project/p1`);
  });

  it("returns project home when the stack is empty", () => {
    expect(projectBackTarget([], "p1")).toBe(`/project/p1`);
  });

  it("falls back to project home when the previous entry belongs to another project", () => {
    const stack = [`/project/p2/chat/x`, `/project/p1/content?path=a.md`];
    expect(projectBackTarget(stack, "p1")).toBe(`/project/p1`);
  });

  it("navigates back through multiple in-project entries", () => {
    const stack = [
      `/project/p1`,
      `/project/p1/chat/a`,
      `/project/p1/content?path=f.md`,
    ];
    expect(projectBackTarget(stack, "p1")).toBe(`/project/p1/chat/a`);
  });
});

describe("project nav history", () => {
  it("records locations without consecutive duplicates", () => {
    clearProjectNavHistory("h1");
    recordProjectNavLocation("h1", "/project/h1");
    recordProjectNavLocation("h1", "/project/h1/chat/a");
    recordProjectNavLocation("h1", "/project/h1/chat/a");
    expect(getProjectNavStack("h1")).toEqual(["/project/h1", "/project/h1/chat/a"]);
  });

  it("drops a closed location and collapses resulting duplicates", () => {
    clearProjectNavHistory("h2");
    for (const key of ["/project/h2", "/project/h2/chat/a", "/project/h2", "/project/h2/chat/b"]) {
      recordProjectNavLocation("h2", key);
    }
    dropFromProjectNavHistory("h2", "/project/h2/chat/a");
    expect(getProjectNavStack("h2")).toEqual(["/project/h2", "/project/h2/chat/b"]);
  });

  it("pops the left entry only once the back navigation actually lands", () => {
    clearProjectNavHistory("p1");
    recordProjectNavLocation("p1", "/project/p1/chat/a");
    recordProjectNavLocation("p1", "/project/p1/content?path=f.md");
    const { result } = renderHook(() => useProjectNavigation(), {
      wrapper: ({ children }) => (
        <MemoryRouter>
          <ProjectProvider projectId="p1" projectRoot="/tmp/p1">{children}</ProjectProvider>
        </MemoryRouter>
      ),
    });
    act(() => result.current.back());
    expect(getProjectNavStack("p1")).toEqual(["/project/p1/chat/a", "/project/p1/content?path=f.md"]);

    recordProjectNavLocation("p1", "/project/p1/chat/a");
    expect(getProjectNavStack("p1")).toEqual(["/project/p1/chat/a"]);
  });

  it("keeps the stack intact when a blocked back is cancelled and the user goes elsewhere", () => {
    clearProjectNavHistory("p1");
    recordProjectNavLocation("p1", "/project/p1/chat/a");
    recordProjectNavLocation("p1", "/project/p1/content?path=f.md");
    const { result } = renderHook(() => useProjectNavigation(), {
      wrapper: ({ children }) => (
        <MemoryRouter>
          <ProjectProvider projectId="p1" projectRoot="/tmp/p1">{children}</ProjectProvider>
        </MemoryRouter>
      ),
    });
    act(() => result.current.back());
    recordProjectNavLocation("p1", "/project/p1/chat/b");
    expect(getProjectNavStack("p1")).toEqual([
      "/project/p1/chat/a",
      "/project/p1/content?path=f.md",
      "/project/p1/chat/b",
    ]);
  });
});
