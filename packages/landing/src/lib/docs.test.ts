import { describe, expect, it } from "vitest";
import { docIds, docTitle, getDoc } from "./docs";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type Locale } from "@spherse/i18n";

const LANDING_DOC_ID = "tailscale";

describe("docs content", () => {
  it("has at least one article", () => {
    expect(docIds().length).toBeGreaterThan(0);
  });

  it("includes every article referenced by the docs page", () => {
    expect(docIds()).toContain(LANDING_DOC_ID);
    expect(getDoc(LANDING_DOC_ID, DEFAULT_LOCALE)).not.toBeNull();
  });

  it("every article ships all supported locales and starts with a title heading", () => {
    for (const id of docIds()) {
      for (const locale of SUPPORTED_LOCALES as readonly Locale[]) {
        const content = getDoc(id, locale);
        expect(content, `${id}.${locale}.md missing`).not.toBeNull();
        expect(content!.trim().startsWith("# "), `${id}.${locale}.md must start with "# "`).toBe(
          true,
        );
        expect(docTitle(content!), `${id}.${locale}.md has empty title`).not.toBe("");
      }
    }
  });
});
