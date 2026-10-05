import { describe, expect, it } from "vitest";
import { docIds, docTitle, docExcerpt, getDoc } from "./docs";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type Locale } from "@spherse/i18n";

const PUBLISHED_DOC_IDS = ["tailscale"];

describe("docs content", () => {
  it("has at least one article", () => {
    expect(docIds().length).toBeGreaterThan(0);
  });

  it("keeps every published /docs/:id URL resolvable", () => {
    for (const id of PUBLISHED_DOC_IDS) {
      expect(docIds()).toContain(id);
      expect(getDoc(id, DEFAULT_LOCALE)).not.toBeNull();
    }
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

  it("every article yields a plain-text excerpt for the list page", () => {
    for (const id of docIds()) {
      const content = getDoc(id, DEFAULT_LOCALE)!;
      const excerpt = docExcerpt(content);
      expect(excerpt, `${id} excerpt empty`).not.toBe("");
      expect(excerpt).not.toMatch(/\[.*\]\(/);
      expect(excerpt).not.toContain("```");
    }
  });
});
