import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("returns null frontmatter when there is no front matter block", () => {
    const raw = "# Title\n\nbody text";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(raw);
  });

  it("parses a valid front matter block and strips it from the body", () => {
    const raw = "---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body\n";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({ title: "Hello", tags: ["a", "b"] });
    expect(result.body).toBe("# Body\n");
  });

  it("handles CRLF line endings", () => {
    const raw = "---\r\ntitle: Hello\r\n---\r\n\r\n# Body\r\n";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({ title: "Hello" });
    expect(result.body).toBe("# Body\r\n");
  });

  it("treats malformed YAML as no front matter (keeps raw content)", () => {
    const raw = "---\ntitle: : bad\n  : x\n---\n\n# Body\n";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(raw);
  });

  it("ignores a front matter fence that is not at the start of the file", () => {
    const raw = "# Title\n\n---\nkey: val\n---\n\nbody";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(raw);
  });

  it("returns the whole body when front matter is the only content", () => {
    const raw = "---\ntitle: Solo\n---\n";
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({ title: "Solo" });
    expect(result.body).toBe("");
  });

  it("handles empty string input", () => {
    const result = parseFrontmatter("");
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe("");
  });
});
