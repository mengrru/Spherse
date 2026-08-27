import { describe, expect, it } from "vitest";
import {
  computeInitialCollapsedAgentIds,
  expandActiveAgent,
  pruneCollapsedAgentIds,
} from "./use-collapsed-agents-helpers";

const agents = [{ id: "agent-1" }, { id: "agent-2" }, { id: "agent-3" }];

describe("computeInitialCollapsedAgentIds", () => {
  it("collapses all agents when no active agent", () => {
    expect(computeInitialCollapsedAgentIds(agents, null)).toEqual(new Set(["agent-1", "agent-2", "agent-3"]));
  });

  it("excludes the active agent so its sessions stay visible on first load", () => {
    expect(computeInitialCollapsedAgentIds(agents, "agent-2")).toEqual(new Set(["agent-1", "agent-3"]));
  });

  it("returns an empty set when only the active agent exists", () => {
    expect(computeInitialCollapsedAgentIds([{ id: "agent-1" }], "agent-1")).toEqual(new Set());
  });

  it("is unaffected by an active agent id not present in agents", () => {
    expect(computeInitialCollapsedAgentIds(agents, "missing")).toEqual(
      new Set(["agent-1", "agent-2", "agent-3"]),
    );
  });
});

describe("pruneCollapsedAgentIds", () => {
  it("removes ids of agents no longer present", () => {
    expect(pruneCollapsedAgentIds(new Set(["agent-1", "agent-2"]), [{ id: "agent-1" }])).toEqual(
      new Set(["agent-1"]),
    );
  });

  it("returns null when nothing to prune", () => {
    expect(pruneCollapsedAgentIds(new Set(["agent-1"]), agents)).toBeNull();
  });

  it("treats an empty agents snapshot as data-not-ready and keeps the collapsed set", () => {
    expect(pruneCollapsedAgentIds(new Set(["agent-1", "agent-2"]), [])).toBeNull();
  });

  it("returns null when the collapsed set is empty", () => {
    expect(pruneCollapsedAgentIds(new Set(), agents)).toBeNull();
  });

  it("does not mutate the input set", () => {
    const input = new Set(["agent-1", "agent-2"]);
    pruneCollapsedAgentIds(input, [{ id: "agent-1" }]);
    expect(input).toEqual(new Set(["agent-1", "agent-2"]));
  });
});

describe("expandActiveAgent", () => {
  it("removes the active agent when it is collapsed", () => {
    expect(expandActiveAgent(new Set(["agent-1", "agent-2"]), "agent-1")).toEqual(new Set(["agent-2"]));
  });

  it("returns null when there is no active agent", () => {
    expect(expandActiveAgent(new Set(["agent-1"]), null)).toBeNull();
  });

  it("returns null when the active agent is not collapsed", () => {
    expect(expandActiveAgent(new Set(["agent-2"]), "agent-1")).toBeNull();
  });

  it("does not mutate the input set", () => {
    const input = new Set(["agent-1", "agent-2"]);
    expandActiveAgent(input, "agent-1");
    expect(input).toEqual(new Set(["agent-1", "agent-2"]));
  });
});
