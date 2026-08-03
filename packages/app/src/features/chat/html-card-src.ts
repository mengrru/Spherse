import { SDK_MARK, injectHeadScript } from "@spherse/sdk";
import { SDK_SOURCE } from "@spherse/sdk/source";

const SCROLLABLE_MARKER = "data-spherse-card-scroll";
const SCROLLABLE_STYLE = `<style ${SCROLLABLE_MARKER}>html,body{overflow-y:auto!important}</style>`;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "ico", "webp"]);

export function isImageFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function ensureCharset(html: string): string {
  if (html.includes("charset")) return html;
  const meta = `<meta charset="UTF-8">`;
  if (/<head([^>]*)>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  }
  if (/<html([^>]*)>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1>${meta}`);
  }
  return `${meta}${html}`;
}

export function ensureScrollable(html: string): string {
  if (html.includes(SCROLLABLE_MARKER)) return html;
  // Inject near the end so the rule wins source-order tie-breaks against page-level
  // `overflow:hidden!important` declarations (equal specificity, later wins).
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${SCROLLABLE_STYLE}</body>`);
  }
  if (/<\/html>/i.test(html)) {
    return html.replace(/<\/html>/i, `${SCROLLABLE_STYLE}</html>`);
  }
  return `${html}${SCROLLABLE_STYLE}`;
}

export function ensureSdk(html: string): string {
  const tag = `<script ${SDK_MARK}>${SDK_SOURCE}</script>`;
  return injectHeadScript(html, tag, SDK_MARK);
}

export function buildFileSrcDoc(html: string, previewUrl: string): string {
  const withCharset = ensureCharset(html);
  const scrollable = ensureScrollable(withCharset);
  // SDK before <base>: file mode fetches HTML from the preview server, which has
  // already injected `<script src="__spherse-sdk.js" data-spherse-sdk>` (same
  // marker) — ensureSdk is idempotent and skips. For string-mode HTML passed
  // through this path, it inlines the bundle. <base> is applied last so it sits
  // first in <head> and the relative script-src resolves to the preview origin.
  const withSdk = ensureSdk(scrollable);
  const lastSlash = previewUrl.lastIndexOf("/");
  const dirUrl = lastSlash >= 0 ? previewUrl.slice(0, lastSlash) : previewUrl;
  return injectBase(withSdk, `${dirUrl}/`);
}

export function buildInlineSrcDoc(html: string, previewBaseUrl: string): string {
  const withCharset = ensureCharset(html);
  const scrollable = ensureScrollable(withCharset);
  const withSdk = ensureSdk(scrollable);
  return injectBase(withSdk, previewBaseUrl);
}

function injectBase(html: string, baseUrl: string): string {
  const baseTag = `<base href="${baseUrl}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return `${baseTag}${html}`;
}
