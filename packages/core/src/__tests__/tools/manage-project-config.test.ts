import YAML from "yaml";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createManageProjectConfigTool } from "../../tools/manage-project-config.js";
import { ProjectStore } from "../../store/project.js";
import { createSilentLogger } from "../../logger.js";
import { createTempProject, cleanupDir, readFile } from "../helpers.js";

describe("createManageProjectConfigTool", () => {
  let projectRoot: string;
  let store: ProjectStore;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    store = new ProjectStore(projectRoot, createSilentLogger());
    await store.create("TestProject");
  });

  afterEach(async () => {
    store.close();
    await cleanupDir(projectRoot);
  });

  function makeTool() {
    return createManageProjectConfigTool(store);
  }

  it("reads settings with a null welcome page by default", async () => {
    const result = await makeTool().execute("tc", { action: "read" }, undefined as any);
    expect(result.details.error).toBeUndefined();
    expect(result.content[0].text).toContain('"welcomePage"');
    expect(result.content[0].text).toContain("null");
    expect(result.details.welcomePagePath).toBeNull();
  });

  it("sets the welcome page to a valid user file path", async () => {
    const result = await makeTool().execute(
      "tc",
      { action: "update_welcome_page", welcome_page_path: "./pages/home.html" },
      undefined as any,
    );
    expect(result.details.error).toBeUndefined();
    expect(result.details.welcomePagePath).toBe("pages/home.html");

    const raw = YAML.parse(await readFile(projectRoot, ".spherse/project.yaml"));
    expect(raw.welcomePage).toEqual({ path: "pages/home.html" });

    const readBack = await makeTool().execute("tc", { action: "read" }, undefined as any);
    expect(readBack.details.welcomePagePath).toBe("pages/home.html");
  });

  it("accepts image extensions", async () => {
    const result = await makeTool().execute(
      "tc",
      { action: "update_welcome_page", welcome_page_path: "assets/cover.png" },
      undefined as any,
    );
    expect(result.details.error).toBeUndefined();
    expect(result.details.welcomePagePath).toBe("assets/cover.png");
  });

  it("clears the welcome page with null", async () => {
    await makeTool().execute(
      "tc",
      { action: "update_welcome_page", welcome_page_path: "index.html" },
      undefined as any,
    );
    const result = await makeTool().execute(
      "tc",
      { action: "update_welcome_page", welcome_page_path: null },
      undefined as any,
    );
    expect(result.details.error).toBeUndefined();
    expect(result.details.welcomePagePath).toBeNull();

    const raw = YAML.parse(await readFile(projectRoot, ".spherse/project.yaml"));
    expect(raw.welcomePage).toBeUndefined();
  });

  it("requires welcome_page_path for update_welcome_page", async () => {
    const result = await makeTool().execute("tc", { action: "update_welcome_page" }, undefined as any);
    expect(result.details.error).toBe(true);
    expect(result.content[0].text).toContain("welcome_page_path");
  });

  it.each([
    [".spherse/project.yaml", "meta files are not user files"],
    ["../outside.html", "escaping the project root"],
    ["/abs/path.html", "absolute paths"],
    ["notes/plan.md", "unsupported extensions"],
    ["", "empty paths"],
  ])("rejects an invalid path (%s — %s)", async (badPath) => {
    const result = await makeTool().execute(
      "tc",
      { action: "update_welcome_page", welcome_page_path: badPath },
      undefined as any,
    );
    expect(result.details.error).toBe(true);
    expect(result.content[0].text).toContain("Invalid welcome page path");
    const settings = await makeTool().execute("tc", { action: "read" }, undefined as any);
    expect(settings.details.welcomePagePath).toBeNull();
  });

  it("keeps the rest of project.yaml intact when updating", async () => {
    await makeTool().execute(
      "tc",
      { action: "update_welcome_page", welcome_page_path: "index.html" },
      undefined as any,
    );
    const raw = YAML.parse(await readFile(projectRoot, ".spherse/project.yaml"));
    expect(raw.id).toBeDefined();
    expect(raw.name).toBe("TestProject");
    expect(raw.created).toBeTypeOf("number");
  });
});
