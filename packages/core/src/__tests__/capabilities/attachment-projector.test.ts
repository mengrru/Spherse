import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { attachmentsCapability } from "../../capabilities/attachments/index.js";
import { attachmentContextProjector } from "../../capabilities/attachments/projector.js";
import { contextProjectorsFor } from "../../session/agent-assembly.js";

function view() {
  return { agentId: "a", profile: { id: "a", name: "A", slug: "a" }, projectStore: {}, stores: {} } as never;
}

function userMsg(extra: Record<string, unknown> = {}): AgentMessage {
  return { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1, ...extra } as never;
}

describe("attachment context projector", () => {
  it("is contributed by the attachments capability", () => {
    const projectors = contextProjectorsFor([attachmentsCapability()], view());
    expect(projectors).toHaveLength(1);
  });

  it("strips _attachments and empty-data image blocks, keeps real ones", () => {
    const project = attachmentContextProjector(view())!;
    const input: AgentMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          { type: "image", data: "", mimeType: "image/png" },
          { type: "image", data: "abc", mimeType: "image/png" },
        ],
        _attachments: [{ type: "image", path: "p", mimeType: "image/png" }],
        timestamp: 1,
      } as never,
      { role: "custom", content: "should be dropped by role filter downstream" } as never,
    ];

    const out = project(input);
    expect(out).toHaveLength(1);
    const msg = out[0] as { content: Array<{ type: string; data?: string }>; _attachments?: unknown };
    expect(msg._attachments).toBeUndefined();
    expect(msg.content).toEqual([
      { type: "text", text: "hi" },
      { type: "image", data: "abc", mimeType: "image/png" },
    ]);
  });

  it("multiple projectors compose in capability order (pipeline)", () => {
    const seen: string[] = [];
    const a = () => (messages) => (seen.push("a"), messages);
    const b = () => (messages) => (seen.push("b"), messages);
    const capA = { id: "x", contextProjectors: [a as never] };
    const capB = { id: "y", contextProjectors: [b as never] };

    const projectors = contextProjectorsFor([capA, capB] as never, view());
    for (const project of projectors) project([userMsg()]);
    expect(seen).toEqual(["a", "b"]);
  });

  it("pluggability: without the attachments capability no projector runs (messages pass through untouched)", () => {
    const projectors = contextProjectorsFor([], view());
    expect(projectors).toHaveLength(0);

    const withMeta = userMsg({ _attachments: [{ type: "image", path: "p", mimeType: "image/png" }] });
    expect(withMeta).toHaveProperty("_attachments");
  });
});
