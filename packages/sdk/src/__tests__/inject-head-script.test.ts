import { describe, expect, it } from "vitest";
import { injectHeadScript } from "../inject-head-script.js";
import { SDK_MARK } from "../meta.js";
import { SDK_SOURCE } from "../../dist/source.js";

const MARK = SDK_MARK;
const TAG = `<script ${MARK}>${SDK_SOURCE}</script>`;
const SRC_TAG = `<script src="/sdk.js" ${MARK}></script>`;

describe("injectHeadScript", () => {
  it("injects the script tag right after <head>", () => {
    const html = "<html><head><title>x</title></head><body>hi</body></html>";
    const result = injectHeadScript(html, TAG, MARK);
    expect(result).toBe(
      `<html><head>${TAG}<title>x</title></head><body>hi</body></html>`,
    );
  });

  it("prepends a <head> when only <html> exists", () => {
    const html = "<html><body>hi</body></html>";
    const result = injectHeadScript(html, TAG, MARK);
    expect(result).toBe(`<html><head>${TAG}</head><body>hi</body></html>`);
  });

  it("prefixes the script for a fragment with no <html>/<head>", () => {
    const html = "<div>hi</div>";
    const result = injectHeadScript(html, TAG, MARK);
    expect(result).toBe(`${TAG}${html}`);
  });

  it("is idempotent when the marker is already present", () => {
    const html = `<html><head>${SRC_TAG}<title>x</title></head></html>`;
    expect(injectHeadScript(html, TAG, MARK)).toBe(html);
  });

  it("preserves <head> attributes", () => {
    const html = '<html><head class="a" data-x="1"><title>x</title></head></html>';
    const result = injectHeadScript(html, TAG, MARK);
    expect(result).toContain('<head class="a" data-x="1">');
    expect(result.indexOf(TAG)).toBeGreaterThan(result.indexOf("<head"));
  });
});

describe("SDK_SOURCE (bundled runtime)", () => {
  it("is a non-empty string", () => {
    expect(typeof SDK_SOURCE).toBe("string");
    expect(SDK_SOURCE.length).toBeGreaterThan(0);
  });

  it("is guarded against double initialization", () => {
    expect(SDK_SOURCE).toContain("__SPHERSE_SDK__");
    expect(SDK_SOURCE).toContain("if (!window.__SPHERSE_SDK__)");
  });

  it("exposes window.spherse and window.Spherse", () => {
    expect(SDK_SOURCE).toContain("window.spherse = spherse");
    expect(SDK_SOURCE).toContain("if (!window.Spherse) window.Spherse = spherse");
  });

  it("speaks the spherse: action/response/runtime protocol", () => {
    expect(SDK_SOURCE).toContain('type: "spherse:action"');
    expect(SDK_SOURCE).toContain("spherse:response");
    expect(SDK_SOURCE).toContain("spherse:runtime");
  });

  it("does not contain template-literal interpolation or backticks", () => {
    expect(SDK_SOURCE).not.toContain("`");
    expect(SDK_SOURCE).not.toContain("${");
  });
});
