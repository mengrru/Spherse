import { describe, expect, it } from "vitest";
import { buildFileSrcDoc, ensureCharset } from "./html-card-src";

describe("ensureCharset", () => {
  it("preserves html that already declares a charset", () => {
    const html = '<html><head><meta charset="UTF-8"></head></html>';
    expect(ensureCharset(html)).toBe(html);
  });

  it("injects charset meta after <head> when missing", () => {
    const html = "<html><head><title>x</title></head></html>";
    expect(ensureCharset(html)).toBe('<html><head><meta charset="UTF-8"><title>x</title></head></html>');
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
    expect(result.startsWith(`<base href="${dirUrl}/">`)).toBe(true);
    expect(result).toContain("<html><body>hi</body></html>");
  });

  it("handles previewUrl without directory (file at root level)", () => {
    const rootPreviewUrl = "http://localhost:3000/api/projects/p1/preview/card.html";
    const rootDirUrl = "http://localhost:3000/api/projects/p1/preview";
    const html = "<html><head></head><body>hi</body></html>";
    const result = buildFileSrcDoc(html, rootPreviewUrl);
    expect(result).toContain(`<base href="${rootDirUrl}/">`);
  });
});
