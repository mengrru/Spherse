const SCROLLABLE_MARKER = "data-spherse-card-scroll";
const SCROLLABLE_STYLE = `<style ${SCROLLABLE_MARKER}>html,body{overflow-y:auto!important}</style>`;

export function ensureCharset(html: string): string {
  return html.includes("charset") ? html : html.replace(/<head([^>]*)>/i, `<head$1><meta charset="UTF-8">`);
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
  const baseTag = `<base href="${dirUrl}/">`;
  if (/<head[^>]*>/i.test(scrollable)) {
    return scrollable.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return `${baseTag}${scrollable}`;
}
