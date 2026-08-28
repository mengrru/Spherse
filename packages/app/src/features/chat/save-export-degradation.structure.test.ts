import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const chatDir = dirname(fileURLToPath(import.meta.url));

describe("web save/export degradation wiring", () => {
  it("HtmlCard falls back to saveBlob when showSaveDialog is unavailable", () => {
    const source = readFileSync(join(chatDir, "HtmlCard.tsx"), "utf-8");

    expect(source).toContain("if (!bridge.showSaveDialog) {");
    expect(source).toContain("await bridge.saveBlob?.(suggestedName, blob);");
    expect(source.indexOf("if (!bridge.showSaveDialog) {")).toBeLessThan(
      source.indexOf("await bridge.showSaveDialog({"),
    );
  });

  it("ImageCard falls back to fetching the preview url and saving a blob", () => {
    const source = readFileSync(join(chatDir, "ImageCard.tsx"), "utf-8");

    expect(source).toContain("if (!bridge.showSaveDialog) {");
    expect(source).toContain("await fetch(client.getPreviewUrl(card.path))");
    expect(source).toContain("await bridge.saveBlob?.(suggestedName, await res.blob());");
    expect(source).toContain('toast.error(t("chat.imageExportFailed"');
  });

  it("BrowserPage redirects to the project home when the browser feature is disabled", () => {
    const source = readFileSync(join(chatDir, "../../pages/BrowserPage.tsx"), "utf-8");

    expect(source).toContain('useFeature("browser")');
    expect(source).toContain("!browserEnabled ||");
  });
});
