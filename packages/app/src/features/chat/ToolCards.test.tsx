import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { createMockHostBridge } from "../../test/host-bridge";
import { ToolCards } from "./ToolCards";
import type { ToolItem } from "./model/tool-item";

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({
    getPreviewUrl: (path: string) => `http://localhost:5173/api/projects/p1/preview/${path}`,
  }),
  useConnection: () => ({ baseUrl: "http://localhost:5173", accessToken: null }),
}));

function cardTool(overrides: Partial<ToolItem> = {}): ToolItem {
  return {
    toolCallId: "tc-img",
    toolName: "generate_image",
    args: { prompt: "一只猫" },
    status: "completed",
    card: { type: "image", status: "done", path: "uploads/cat.png", prompt: "一只猫", mimeType: "image/png" },
    ...overrides,
  };
}

function renderCards(tools: ToolItem[], props: Partial<Parameters<typeof ToolCards>[0]> = {}) {
  return renderWithProviders(<ToolCards tools={tools} {...props} />, {
    bridge: createMockHostBridge(),
  });
}

describe("ToolCards", () => {
  it("renders card tools and ignores plain tools", () => {
    renderCards([
      cardTool(),
      { toolCallId: "tc-plain", toolName: "read_file", args: {}, status: "completed" },
    ]);
    expect(screen.getByAltText("一只猫")).toBeInTheDocument();
    expect(document.querySelector("[data-chat-cards]")).not.toBeNull();
  });

  it("collapses superseded html cards by their tool call id", () => {
    renderCards([
      cardTool({
        toolCallId: "tc-old",
        toolName: "render_card",
        args: {},
        card: { type: "html", html: "<p>old</p>" },
      }),
      cardTool({
        toolCallId: "tc-new",
        toolName: "render_card",
        args: {},
        card: { type: "html", html: "<p>new</p>" },
      }),
    ], { supersededToolCallIds: new Set(["tc-old"]) });
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("forwards approval callbacks to command cards", async () => {
    const onRespondApproval = vi.fn();
    const user = userEvent.setup();
    renderCards([
      cardTool({
        toolCallId: "tc-cmd",
        toolName: "run_command",
        args: { command: "ls" },
        card: {
          type: "command",
          status: "pending_approval",
          command: "ls",
          stdout: "",
          stderr: "",
          requestId: "req-1",
        },
      }),
    ], { onRespondApproval });
    await user.click(screen.getByRole("button", { name: /批准|Approve/ }));
    expect(onRespondApproval).toHaveBeenCalledWith("req-1", true);
  });

  it("forwards answer callbacks to question cards", async () => {
    const onRespondQuestion = vi.fn();
    const user = userEvent.setup();
    renderCards([
      cardTool({
        toolCallId: "tc-q",
        toolName: "ask_user",
        args: {},
        card: { type: "question", status: "pending", question: "继续吗？", options: ["继续", "停止"], requestId: "req-2" },
      }),
    ], { onRespondQuestion });
    await user.click(screen.getByRole("button", { name: "继续" }));
    expect(onRespondQuestion).toHaveBeenCalledWith("req-2", "继续");
  });
});
