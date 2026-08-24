import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "MarketplaceDialog.tsx"), "utf8");

describe("MarketplaceDialog structure", () => {
  it("exposes the expected prop interface (open/onOpenChange/client)", () => {
    expect(source).toContain("open: boolean");
    expect(source).toContain("onOpenChange: (open: boolean) => void");
    expect(source).toContain("client: ApiClient");
  });

  it("is driven by the base-ui Dialog open/onOpenChange pattern", () => {
    expect(source).toContain("DialogContent");
    expect(source).toContain("DialogHeader");
    expect(source).toContain("DialogTitle");
    expect(source).toMatch(/open=\{open\}/);
    expect(source).toMatch(/onOpenChange=\{onOpenChange\}/);
  });

  it("loads local and marketplace skills through query hooks", () => {
    expect(source).toContain("useProjectSkills(projectId, client)");
    expect(source).toContain("useMarketplaceSkills(projectId, client, open)");
  });

  it("invalidates marketplace and local skill queries each time the dialog opens", () => {
    expect(source).toContain("if (open) {");
    expect(source).toContain("void invalidateMarketplaceQueries(projectId)");
    expect(source).toContain("void invalidateProjectSkillQueries(projectId)");
    expect(source).toMatch(/\}, \[open, projectId\]\);/);
  });

  it("derives per-card state via the pure helper", () => {
    expect(source).toContain("deriveSkillCardState(localByName.get(entry.name), entry.version)");
  });

  it("installs via the marketplace install client method and invalidates skill queries", () => {
    expect(source).toContain("client.installMarketplaceSkill(name, version)");
    expect(source).toContain("handleInstall(entry.name, entry.version");
    expect(source).toContain("invalidateProjectSkillQueries(projectId)");
  });

  it("invalidates open content views under the installed skill directory", () => {
    expect(source).toContain("invalidateProjectFileQueries(projectId, `.spherse/skills/${name}`)");
  });

  it("handles 409 manifest drift by toasting and invalidating marketplace queries", () => {
    expect(source).toContain("err instanceof ApiError && err.status === 409");
    expect(source).toContain('t("skill-panel.marketplace.manifestChanged")');
    expect(source).toContain("invalidateMarketplaceQueries(projectId)");
  });

  it("renders loading, error with retry, and empty states", () => {
    expect(source).toContain("marketQuery.isPending");
    expect(source).toContain("marketQuery.isError");
    expect(source).toContain("marketQuery.refetch()");
    expect(source).toContain('t("skill-panel.marketplace.loading")');
    expect(source).toContain('t("skill-panel.marketplace.loadFailed")');
    expect(source).toContain('t("skill-panel.marketplace.retry")');
    expect(source).toContain('t("skill-panel.marketplace.empty")');
  });

  it("renders install/update/installed card actions from derived state", () => {
    expect(source).toContain('state === "installed"');
    expect(source).toContain('state === "update"');
    expect(source).toContain('t("skill-panel.marketplace.install")');
    expect(source).toContain('t("skill-panel.marketplace.update")');
    expect(source).toContain('t("skill-panel.marketplace.installed")');
  });
});
