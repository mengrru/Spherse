import { describe, it, expect, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import { withApproval, type ApprovalGate, type ApprovalDecision } from "../../tools/with-approval.js";

const Params = Type.Object({ value: Type.String() });

function makeTool() {
  const execute = vi.fn(async () => ({
    content: [{ type: "text" as const, text: "ran" }],
    details: { ok: true },
  }));
  return {
    tool: { name: "dummy", label: "Dummy", description: "d", parameters: Params, execute },
    execute,
  };
}

function gate(decision: ApprovalDecision): ApprovalGate {
  return { request: vi.fn(async () => decision) };
}

describe("withApproval", () => {
  it("delegates to original execute when approved", async () => {
    const { tool, execute } = makeTool();
    const wrapped = withApproval(tool, gate({ approved: true }));
    const res = await wrapped.execute("tc1", { value: "x" }, undefined, undefined);
    expect(execute).toHaveBeenCalledWith("tc1", { value: "x" }, undefined, undefined);
    expect(res.details).toEqual({ ok: true });
  });

  it("returns rejected result without calling original when denied", async () => {
    const { tool, execute } = makeTool();
    const wrapped = withApproval(tool, gate({ approved: false, reason: "user said no" }));
    const res = await wrapped.execute("tc1", { value: "x" }, undefined, undefined);
    expect(execute).not.toHaveBeenCalled();
    expect((res.content[0] as { text: string }).text).toContain("rejected by user");
    expect((res.content[0] as { text: string }).text).toContain("user said no");
    expect(res.details).toMatchObject({ rejected: true, reason: "user said no" });
  });

  it("passes the tool through unchanged when gate is undefined", async () => {
    const { tool, execute } = makeTool();
    const wrapped = withApproval(tool, undefined);
    expect(wrapped).toBe(tool);
    await wrapped.execute("tc1", { value: "x" }, undefined, undefined);
    expect(execute).toHaveBeenCalled();
  });

  it("skips the gate when shouldApprove returns false", async () => {
    const { tool, execute } = makeTool();
    const approvalGate = gate({ approved: false });
    const wrapped = withApproval(tool, approvalGate, (params) => (params as { value: string }).value === "write");
    const res = await wrapped.execute("tc1", { value: "read" }, undefined, undefined);
    expect(approvalGate.request).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
    expect(res.details).toEqual({ ok: true });
  });

  it("still asks the gate when shouldApprove returns true", async () => {
    const { tool, execute } = makeTool();
    const approvalGate = gate({ approved: false });
    const wrapped = withApproval(tool, approvalGate, (params) => (params as { value: string }).value === "write");
    await wrapped.execute("tc1", { value: "write" }, undefined, undefined);
    expect(approvalGate.request).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
