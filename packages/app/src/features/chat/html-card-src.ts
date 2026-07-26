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

export function buildFileSrcDoc(html: string, previewUrl: string): string {
  const withCharset = ensureCharset(html);
  const scrollable = ensureScrollable(withCharset);
  const lastSlash = previewUrl.lastIndexOf("/");
  const dirUrl = lastSlash >= 0 ? previewUrl.slice(0, lastSlash) : previewUrl;
  return injectBase(scrollable, `${dirUrl}/`);
}

export function buildInlineSrcDoc(html: string, previewBaseUrl: string): string {
  const withCharset = ensureCharset(html);
  const scrollable = ensureScrollable(withCharset);
  return injectBase(scrollable, previewBaseUrl);
}

function injectBase(html: string, baseUrl: string): string {
  const baseTag = `<base href="${baseUrl}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return `${baseTag}${html}`;
}
