import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRenderCardTool } from "../../tools/render-card.js";
import { createTempProject, cleanupDir, writeFile } from "../helpers.js";

describe("createRenderCardTool", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("sends card data via onUpdate for inline HTML content", async () => {
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();
    const html = "<h1>Hello World</h1>";

    const result = await tool.execute(
      "tc1",
      { type: "html", content: html },
      undefined as any,
      onUpdate,
    );

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const partialResult = onUpdate.mock.calls[0][0];
    expect(partialResult.details).toEqual({
      type: "html",
      html,
      title: undefined,
      width: undefined,
      height: 400,
      max_width: 800,
      max_height: 600,
    });
    expect(result.content[0].text).toBe("HTML card rendered successfully");
  });

  it("sends card data with custom dimensions", async () => {
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();

    await tool.execute(
      "tc1",
      { type: "html", content: "<p>test</p>", width: 500, height: 300, max_width: 600, max_height: 500 },
      undefined as any,
      onUpdate,
    );

    const details = onUpdate.mock.calls[0][0].details;
    expect(details.width).toBe(500);
    expect(details.height).toBe(300);
    expect(details.max_width).toBe(600);
    expect(details.max_height).toBe(500);
  });

  it("sends card data with title", async () => {
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();

    await tool.execute(
      "tc1",
      { type: "html", content: "<p>test</p>", title: "My Card" },
      undefined as any,
      onUpdate,
    );

    const details = onUpdate.mock.calls[0][0].details;
    expect(details.title).toBe("My Card");
  });

  it("reads HTML from file_path", async () => {
    await writeFile(projectRoot, "output/report.html", "<h2>Report</h2>");
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();

    const result = await tool.execute(
      "tc1",
      { type: "html", file_path: "output/report.html" },
      undefined as any,
      onUpdate,
    );

    const details = onUpdate.mock.calls[0][0].details;
    expect(details.html).toBe("<h2>Report</h2>");
    expect(result.content[0].text).toBe("HTML card rendered successfully");
  });

  it("returns error when neither content nor file_path is provided", async () => {
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();

    const result = await tool.execute(
      "tc1",
      { type: "html" },
      undefined as any,
      onUpdate,
    );

    expect(result.content[0].text).toContain("must provide");
    expect(result.details?.error).toBe(true);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("returns error when file_path does not exist", async () => {
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();

    const result = await tool.execute(
      "tc1",
      { type: "html", file_path: "nonexistent.html" },
      undefined as any,
      onUpdate,
    );

    expect(result.content[0].text).toContain("Error");
    expect(result.details?.error).toBe(true);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("rejects path traversal in file_path", async () => {
    const tool = createRenderCardTool(projectRoot);

    await expect(
      tool.execute(
        "tc1",
        { type: "html", file_path: "../../../etc/passwd" },
        undefined as any,
        undefined as any,
      ),
    ).rejects.toThrow("Path traversal denied");
  });

  it("prefers file_path over content when both provided", async () => {
    await writeFile(projectRoot, "chart.html", "<canvas></canvas>");
    const tool = createRenderCardTool(projectRoot);
    const onUpdate = vi.fn();

    await tool.execute(
      "tc1",
      { type: "html", content: "<p>inline</p>", file_path: "chart.html" },
      undefined as any,
      onUpdate,
    );

    const details = onUpdate.mock.calls[0][0].details;
    expect(details.html).toBe("<canvas></canvas>");
  });

  it("includes full card data in return details for history recovery", async () => {
    const tool = createRenderCardTool(projectRoot);
    const html = "<h1>Card</h1>";

    const result = await tool.execute(
      "tc1",
      { type: "html", content: html, title: "Test", width: 500, height: 300 },
      undefined as any,
      undefined as any,
    );

    expect(result.details.cardType).toBe("html");
    expect(result.details.html).toBe(html);
    expect(result.details.title).toBe("Test");
    expect(result.details.width).toBe(500);
    expect(result.details.height).toBe(300);
    expect(result.details.max_width).toBe(800);
    expect(result.details.max_height).toBe(600);
  });
});
