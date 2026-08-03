/**
 * Inject a `<script>` tag into the `<head>` of an HTML document, idempotently.
 *
 * Shared by the renderer (inline SDK for HtmlCard srcDoc) and the server
 * (`<script src>` rewrite for preview iframes). Pure string manipulation — no DOM
 * parsing — to stay dependency-free and match the existing charset/base helpers.
 */
export function injectHeadScript(html: string, scriptTag: string, marker: string): string {
  if (html.includes(marker)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${scriptTag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${scriptTag}</head>`);
  }
  return `${scriptTag}${html}`;
}
