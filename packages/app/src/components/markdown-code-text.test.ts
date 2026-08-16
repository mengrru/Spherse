import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { extractCodeText } from "./markdown-code-text";

describe("extractCodeText", () => {
  it("returns empty string for nullish and boolean nodes", () => {
    expect(extractCodeText(null)).toBe("");
    expect(extractCodeText(undefined)).toBe("");
    expect(extractCodeText(false)).toBe("");
    expect(extractCodeText(true)).toBe("");
  });

  it("returns plain string and number nodes as-is", () => {
    expect(extractCodeText("const x = 1;")).toBe("const x = 1;");
    expect(extractCodeText(42)).toBe("42");
  });

  it("extracts text from a single code element (react-markdown block code)", () => {
    const code = createElement("code", { className: "language-js" }, "const x = 1;\n");
    expect(extractCodeText(code)).toBe("const x = 1;\n");
  });

  it("extracts text from a nested pre > code structure", () => {
    const code = createElement("code", { className: "language-js" }, "console.log(1);\n");
    const pre = createElement("pre", null, code);
    expect(extractCodeText(pre)).toBe("console.log(1);\n");
  });

  it("concatenates text across an array of nodes", () => {
    const children = ["a", createElement("span", null, "b"), "c"];
    expect(extractCodeText(children)).toBe("abc");
  });

  it("joins deeply nested element children", () => {
    const deep = createElement(
      "span",
      null,
      createElement("em", null, "hello "),
      "world",
    );
    expect(extractCodeText(deep)).toBe("hello world");
  });
});
