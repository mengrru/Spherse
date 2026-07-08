export function ensureCharset(html: string): string {
  return html.includes("charset") ? html : html.replace(/<head([^>]*)>/i, `<head$1><meta charset="UTF-8">`);
}

export function buildFileSrcDoc(html: string, previewUrl: string): string {
  const withCharset = ensureCharset(html);
  const lastSlash = previewUrl.lastIndexOf("/");
  const dirUrl = lastSlash >= 0 ? previewUrl.slice(0, lastSlash) : previewUrl;
  const baseTag = `<base href="${dirUrl}/">`;
  if (/<head[^>]*>/i.test(withCharset)) {
    return withCharset.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return `${baseTag}${withCharset}`;
}
