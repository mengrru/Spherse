import { describe, expect, it } from "vitest";
import {
  buildExportFilename,
  extractMessageText,
  formatExportTimestamp,
  formatSessionAsPlainText,
} from "./export-session";

describe("extractMessageText", () => {
  it("returns string content as-is", () => {
    expect(extractMessageText({ role: "user", content: "hello" })).toBe("hello");
  });

  it("joins only text parts from array content, dropping toolCall parts", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: "Thinking... " },
        { type: "toolCall", id: "1", name: "write_file", arguments: {} },
        { type: "text", text: "Done." },
      ],
    };
    expect(extractMessageText(message)).toBe("Thinking... Done.");
  });

  it("returns empty string for unknown content shapes", () => {
    expect(extractMessageText({ role: "assistant", content: 42 })).toBe("");
    expect(extractMessageText({ role: "assistant" })).toBe("");
    expect(extractMessageText({ role: "assistant", content: null })).toBe("");
  });
});

describe("formatSessionAsPlainText", () => {
  it("keeps only user/assistant text and skips tool results and empty text", () => {
    const messages = [
      { role: "user", content: "Hi there" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          { type: "toolCall", id: "1", name: "read_file", arguments: { path: "a" } },
        ],
      },
      { role: "toolResult", toolCallId: "1", content: [{ type: "text", text: "file body" }] },
      { role: "assistant", content: [{ type: "toolCall", id: "2", name: "noop", arguments: {} }] },
      { role: "assistant", content: "All good." },
    ];

    const output = formatSessionAsPlainText(messages, "My Session", "Aria");
    expect(output).toBe(
      ["# My Session", "", "[User]:", "Hi there", "", "[Aria]:", "Let me check.", "", "[Aria]:", "All good.", ""].join(
        "\n",
      ),
    );
  });

  it("falls back to a default heading when title is blank", () => {
    const output = formatSessionAsPlainText([], "   ");
    expect(output.startsWith("# Session")).toBe(true);
  });

  it("falls back to 'Assistant' label when assistantName is blank", () => {
    const output = formatSessionAsPlainText(
      [{ role: "assistant", content: "hi" }],
      "T",
      "  ",
    );
    expect(output).toContain("[Assistant]:");
  });

  it("falls back to 'Assistant' label when assistantName is omitted", () => {
    const output = formatSessionAsPlainText([{ role: "assistant", content: "hi" }], "T");
    expect(output).toContain("[Assistant]:");
  });

  it("produces only the heading line when there are no user/assistant messages", () => {
    expect(formatSessionAsPlainText([{ role: "toolResult", content: "x" }], "Empty")).toBe("# Empty\n");
  });
});

describe("formatExportTimestamp", () => {
  it("formats a date as YYYYMMDD-HHmm", () => {
    expect(formatExportTimestamp(new Date(2026, 6, 4, 9, 5))).toBe("20260704-0905");
  });

  it("zero-pads single-digit components", () => {
    expect(formatExportTimestamp(new Date(2026, 0, 1, 1, 2))).toBe("20260101-0102");
  });
});

describe("buildExportFilename", () => {
  it("uses the agent slug as prefix and appends a .txt extension", () => {
    expect(buildExportFilename("aria", new Date(2026, 6, 4, 9, 5))).toBe("aria-20260704-0905.txt");
  });

  it("falls back to 'session' when slug is empty", () => {
    expect(buildExportFilename("   ", new Date(2026, 6, 4, 9, 5))).toBe("session-20260704-0905.txt");
    expect(buildExportFilename("", new Date(2026, 6, 4, 9, 5))).toBe("session-20260704-0905.txt");
  });

  it("strips filesystem-invalid characters from the slug", () => {
    expect(buildExportFilename('a:b\\c/d', new Date(2026, 6, 4, 9, 5))).toBe("a_b_c_d-20260704-0905.txt");
  });
});
