import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("MessageItem structure", () => {
  it("renders error messages after the tool call section", () => {
    const source = readFileSync(join(currentDir, "MessageItem.tsx"), "utf8");

    expect(source.indexOf("<ToolCallSection")).toBeGreaterThan(-1);
    expect(source.indexOf("<ErrorMessageSection")).toBeGreaterThan(source.indexOf("<ToolCallSection"));
  });

  it("renders FileViewerCard after ToolCallSection for run changes", () => {
    const source = readFileSync(join(currentDir, "MessageItem.tsx"), "utf8");

    expect(source.indexOf("<FileViewerCard")).toBeGreaterThan(-1);
    expect(source.indexOf("<FileViewerCard")).toBeGreaterThan(source.indexOf("<ToolCallSection"));
  });

  it("opens chat bubble links via the shared link resolver instead of navigating in place", () => {
    const source = readFileSync(join(currentDir, "MessageItem.tsx"), "utf8");

    expect(source).toContain("useOpenExternalLink");
    expect(source).toContain("handleLinkClick");
    expect(source).toContain("openLink(href)");
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain('onLinkClick={handleLinkClick}');
  });

  it("keeps in-page anchor links inside the chat instead of forwarding them to the browser", () => {
    const source = readFileSync(join(currentDir, "MessageItem.tsx"), "utf8");

    expect(source).toContain('href.startsWith("#")');
    expect(source).toContain("scrollIntoView");
  });

  it("makes chat bubble links inherit the bubble text color so themes that repaint bubbles keep them readable", () => {
    const source = readFileSync(join(currentDir, "MessageItem.tsx"), "utf8");

    expect(source).toContain('linkClassName="text-inherit"');
    expect(source).not.toContain("text-primary-foreground\" : undefined");
  });

  it("renders user message image attachments through the preview url", () => {
    const source = readFileSync(join(currentDir, "MessageItem.tsx"), "utf8");

    expect(source).toContain("_attachments");
    expect(source).toContain("MessageAttachments");
  });

  it("renders a withdraw action for user messages when onWithdraw is provided", () => {
    const source = readFileSync(join(currentDir, "MessageItem.tsx"), "utf8");
    const withdrawSource = readFileSync(join(currentDir, "WithdrawButton.tsx"), "utf8");

    expect(source).toContain("onWithdraw");
    expect(source).toContain("<WithdrawButton onWithdraw={onWithdraw} />");
    expect(source).toContain("isUser && onWithdraw");
    expect(withdrawSource).toContain('data-chat-withdraw');
    expect(withdrawSource).toContain('data-chat-withdraw-confirm');
    expect(withdrawSource).toContain('data-chat-withdraw-cancel');
  });
});

describe("MessageAttachments structure", () => {
  it("renders thumbnails from client.getPreviewUrl and portals the fullscreen viewer to document.body", () => {
    const source = readFileSync(join(currentDir, "MessageAttachments.tsx"), "utf8");

    expect(source).toContain("getPreviewUrl");
    expect(source).toContain("createPortal");
    expect(source).toContain("document.body");
    expect(source).toContain("fixed inset-0");
  });
});
