import { describe, expect, it } from "vitest";
import { buildFileSrcDoc, buildInlineSrcDoc, ensureCharset, ensureScrollable, ensureSdk, isImageFile } from "./html-card-src";

describe("isImageFile", () => {
  it("detects supported image extensions (case-insensitive)", () => {
    expect(isImageFile("assets/photo.png")).toBe(true);
    expect(isImageFile("PHOTO.JPG")).toBe(true);
    expect(isImageFile("a/b/c.JPEG")).toBe(true);
    expect(isImageFile("icon.gif")).toBe(true);
    expect(isImageFile("logo.svg")).toBe(true);
    expect(isImageFile("fav.ico")).toBe(true);
    expect(isImageFile("pic.webp")).toBe(true);
  });

  it("rejects non-image files", () => {
    expect(isImageFile("card.html")).toBe(false);
    expect(isImageFile("data.json")).toBe(false);
    expect(isImageFile("noext")).toBe(false);
    expect(isImageFile("script.js")).toBe(false);
  });
});

describe("ensureCharset", () => {
  it("preserves html that already declares a charset", () => {
    const html = '<html><head><meta charset="UTF-8"></head></html>';
    expect(ensureCharset(html)).toBe(html);
  });

  it("injects charset meta after <head> when missing", () => {
    const html = "<html><head><title>x</title></head></html>";
    expect(ensureCharset(html)).toBe('<html><head><meta charset="UTF-8"><title>x</title></head></html>');
  });

  it("injects charset meta after <html> when document has no <head>", () => {
    const html = "<html><body>hi</body></html>";
    expect(ensureCharset(html)).toBe('<html><meta charset="UTF-8"><body>hi</body></html>');
  });

  it("prepends charset meta when document has no <html>/<head> (fragment)", () => {
    const html = "<div>hi</div><script>x()</script>";
    expect(ensureCharset(html)).toBe('<meta charset="UTF-8"><div>hi</div><script>x()</script>');
  });
});

describe("buildFileSrcDoc", () => {
  const previewUrl = "http://localhost:3000/api/projects/p1/preview/sub/card.html";
  const dirUrl = "http://localhost:3000/api/projects/p1/preview/sub";

  it("injects <base> after <head> and preserves existing charset meta", () => {
    const html = '<html><head><meta charset="UTF-8"><title>x</title></head><body>hi</body></html>';
    const result = buildFileSrcDoc(html, previewUrl);
    expect(result).toContain(`<base href="${dirUrl}/">`);
    expect(result.indexOf(`<base href="${dirUrl}/">`)).toBeGreaterThan(result.indexOf("<head"));
    expect(result).toContain('<meta charset="UTF-8">');
  });

  it("injects charset meta when missing and prepends <base> before content", () => {
    const html = "<html><head><title>x</title></head><body>hi</body></html>";
    const result = buildFileSrcDoc(html, previewUrl);
    expect(result).toContain(`<base href="${dirUrl}/">`);
    expect(result).toContain('<meta charset="UTF-8">');
  });

  it("prepends <base> when document has no <head> tag", () => {
    const html = "<html><body>hi</body></html>";
    const result = buildFileSrcDoc(html, previewUrl);
    // No original <head>: ensureSdk synthesizes one, then injectBase inserts <base>
    // as its first child so relative script-src resolves to the preview origin.
    expect(result).toContain(`<base href="${dirUrl}/">`);
    expect(result).toContain("<body>hi");
    expect(result).toContain('<meta charset="UTF-8">');
    const baseIdx = result.indexOf(`<base href="${dirUrl}/">`);
    const headIdx = result.indexOf("<head");
    expect(baseIdx).toBeGreaterThan(headIdx);
    expect(baseIdx).toBeLessThan(result.indexOf("<body"));
  });

  it("handles previewUrl without directory (file at root level)", () => {
    const rootPreviewUrl = "http://localhost:3000/api/projects/p1/preview/card.html";
    const rootDirUrl = "http://localhost:3000/api/projects/p1/preview";
    const html = "<html><head></head><body>hi</body></html>";
    const result = buildFileSrcDoc(html, rootPreviewUrl);
    expect(result).toContain(`<base href="${rootDirUrl}/">`);
  });

  it("also injects the scrollable style override", () => {
    const html = "<html><head></head><body>hi</body></html>";
    const result = buildFileSrcDoc(html, previewUrl);
    expect(result).toContain("data-spherse-card-scroll");
  });
});

describe("ensureScrollable", () => {
  it("injects scrollable style before </body>", () => {
    const html = "<html><head></head><body>hi</body></html>";
    const result = ensureScrollable(html);
    expect(result).toContain("data-spherse-card-scroll");
    expect(result).toContain("overflow-y:auto!important");
    const markerIdx = result.indexOf("data-spherse-card-scroll");
    expect(markerIdx).toBeGreaterThan(result.indexOf("<body"));
    expect(markerIdx).toBeLessThan(result.indexOf("</body>"));
  });

  it("injects before </html> when document has no </body>", () => {
    const html = "<html>hi</html>";
    const result = ensureScrollable(html);
    expect(result).toContain("data-spherse-card-scroll");
    expect(result.indexOf("</style>")).toBeLessThan(result.indexOf("</html>"));
  });

  it("appends style when document has no closing tags", () => {
    const html = "<div>hi</div>";
    const result = ensureScrollable(html);
    expect(result.endsWith("overflow-y:auto!important}</style>")).toBe(true);
    expect(result).toContain("<div>hi</div>");
  });

  it("is idempotent — does not double-inject when marker already present", () => {
    const html = "<html><head><style data-spherse-card-scroll>x</style></head></html>";
    expect(ensureScrollable(html)).toBe(html);
  });

  it("overrides pages that set body overflow hidden via stylesheet", () => {
    const html = '<html><head><style>body{overflow:hidden!important}</style></head><body>hi</body></html>';
    const result = ensureScrollable(html);
    expect(result).toContain("html,body{overflow-y:auto!important}");
    // injected near end so it wins the source-order tie-break against page-level !important
    expect(result.indexOf("overflow-y:auto!important")).toBeGreaterThan(
      result.indexOf("overflow:hidden!important"),
    );
  });

  it("overrides pages that set body overflow hidden inline", () => {
    const html = '<html><head></head><body style="overflow:hidden">hi</body></html>';
    const result = ensureScrollable(html);
    expect(result).toContain("data-spherse-card-scroll");
    expect(result).toContain("html,body{overflow-y:auto!important}");
  });
});

describe("ensureSdk", () => {
  it("inlines the SDK bundle with the idempotency marker into <head>", () => {
    const html = "<html><head><title>x</title></head><body>hi</body></html>";
    const result = ensureSdk(html);
    expect(result).toContain("data-spherse-sdk");
    expect(result).toContain("window.spherse");
    // injected at <head> start, before <title>
    expect(result.indexOf("data-spherse-sdk")).toBeLessThan(result.indexOf("<title>"));
  });

  it("is idempotent — skips when the marker is already present (server-injected)", () => {
    const pre =
      '<html><head><script src="__spherse-sdk.js" data-spherse-sdk></script><title>x</title></head></html>';
    expect(ensureSdk(pre)).toBe(pre);
  });
});

describe("buildFileSrcDoc / buildInlineSrcDoc SDK wiring", () => {
  const previewUrl = "http://localhost:3000/api/projects/p1/preview/sub/card.html";
  const dirUrl = "http://localhost:3000/api/projects/p1/preview/sub";

  it("buildFileSrcDoc injects both the SDK and <base>, with <base> first in <head>", () => {
    const html = "<html><head><title>x</title></head><body>hi</body></html>";
    const result = buildFileSrcDoc(html, previewUrl);
    expect(result).toContain("data-spherse-sdk");
    expect(result).toContain(`<base href="${dirUrl}/">`);
    // <base> must precede the SDK so the relative script-src resolves to preview origin
    expect(result.indexOf(`<base href="${dirUrl}/">`)).toBeLessThan(
      result.indexOf("data-spherse-sdk"),
    );
  });

  it("buildFileSrcDoc is idempotent when the server already injected script-src", () => {
    const pre =
      `<html><head><script src="__spherse-sdk.js" data-spherse-sdk></script><title>x</title></head><body>hi</body></html>`;
    const result = buildFileSrcDoc(pre, previewUrl);
    // exactly one SDK script tag remains
    expect(result.match(/data-spherse-sdk/g)?.length).toBe(1);
    expect(result).toContain(`<base href="${dirUrl}/">`);
  });

  it("buildInlineSrcDoc inlines the SDK bundle for string-mode HTML", () => {
    const html = "<html><head></head><body>hi</body></html>";
    const result = buildInlineSrcDoc(html, previewUrl);
    expect(result).toContain("data-spherse-sdk");
    expect(result).toContain("window.spherse");
    expect(result).toContain(`<base href="${previewUrl}">`);
  });
});
