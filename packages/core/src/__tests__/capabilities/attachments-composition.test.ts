import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { attachmentsCapability } from "../../capabilities/attachments/index.js";
import { prepareAttachmentUserMessage, type Attachment } from "../../attachments/index.js";
import { createEventPipeline } from "../../kernel/event-pipeline.js";
import { logEventMiddleware } from "../../session/event-middlewares.js";
import { createAttachmentSanitizer } from "../../attachments/sanitizer.js";
import { createSilentLogger } from "../../logger.js";

function imageAttachment(rel: string): Attachment {
  return { type: "image", path: rel, mimeType: "image/png" };
}

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-attcap-"));
  fs.mkdirSync(path.join(tmpDir, ".spherse", "attachments"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, ".spherse", "attachments", "a.png"), Buffer.from([0x89, 0x50]));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("attachment processors via capability", () => {
  it("processors come from the attachments capability, not a global registry", async () => {
    const processors = attachmentsCapability().attachmentProcessors ?? [];
    expect(processors.map((p) => p.type)).toContain("image");

    const msg = await prepareAttachmentUserMessage(
      "look",
      [imageAttachment(".spherse/attachments/a.png")],
      tmpDir,
      processors,
    );
    expect(processors).toHaveLength(1);
    expect(msg.content).toHaveLength(2);
    expect(msg.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
  });

  it("prepareAttachmentUserMessage rejects types no capability provides", async () => {
    await expect(
      prepareAttachmentUserMessage("x", [{ type: "pdf", path: "a.pdf", mimeType: "application/pdf" }], "/tmp/x", [
        ...([] as never[]),
      ]),
    ).rejects.toThrow(/Unsupported attachment type: pdf/);
  });

  it("a capability can extend supported types without touching core", async () => {
    const pdfCapability = {
      id: "pdf-attachments",
      attachmentProcessors: [
        {
          type: "pdf",
          async preprocess() {
            return [{ type: "text", text: "<pdf excerpt>" }];
          },
        },
      ],
    } as const;

    const processors = [...(attachmentsCapability().attachmentProcessors ?? []), ...pdfCapability.attachmentProcessors];
    const msg = await prepareAttachmentUserMessage(
      "read this",
      [{ type: "pdf", path: "doc.pdf", mimeType: "application/pdf" }],
      "/tmp/x",
      processors,
    );
    expect(msg.content).toEqual([
      { type: "text", text: "read this" },
      { type: "text", text: "<pdf excerpt>" },
    ]);
  });
});

describe("capability event middlewares compose into the turn pipeline", () => {
  function messageEndEvent(): AgentEvent {
    return { type: "message_end", message: { role: "assistant", content: [], timestamp: 1 } as never };
  }

  it("capability middlewares run after log and before persist", () => {
    const order: string[] = [];
    const seen: AgentEvent[] = [];

    const capabilityMiddleware = (event: AgentEvent, next: (e: AgentEvent) => void) => {
      order.push("capability");
      seen.push(event);
      next(event);
    };
    const persist = vi.fn((event: AgentEvent, next: (e: AgentEvent) => void) => {
      order.push("persist");
      next(event);
    });

    const dispatch = createEventPipeline(
      [
        logEventMiddleware(createSilentLogger()),
        capabilityMiddleware,
        persist as never,
      ],
      () => order.push("sink"),
    );

    dispatch(messageEndEvent());
    expect(order).toEqual(["capability", "persist", "sink"]);
    expect(seen).toHaveLength(1);
  });

  it("attachment sanitizer stays composable as a middleware", () => {
    const sanitizer = createAttachmentSanitizer([imageAttachment("a.png")]);
    const passthrough = vi.fn((e: unknown) => e);
    const dispatch = createEventPipeline([sanitizer.middleware], () => undefined);
    const event = messageEndEvent();
    dispatch(event);
    expect(passthrough).not.toHaveBeenCalled();
    const result = sanitizer.finalize([event.message as never]);
    expect(result.pair).toBeNull();
    expect(result.messages).toHaveLength(1);
  });
});
