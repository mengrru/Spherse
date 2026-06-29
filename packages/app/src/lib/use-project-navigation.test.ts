import { describe, expect, it } from "vitest";
import { projectBackTarget } from "./use-project-navigation";

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
