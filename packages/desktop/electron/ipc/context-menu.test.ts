import { describe, expect, it, vi } from "vitest";

vi.mock("../settings.js", () => ({
  getLocale: () => "zh-CN",
}));

import { buildEditMenuTemplate } from "./context-menu.js";

describe("buildEditMenuTemplate", () => {
  it("builds localized undo/redo/cut/copy/paste/selectAll with separators", () => {
    const template = buildEditMenuTemplate("en", {
      canUndo: true,
      canRedo: true,
      canCut: true,
      canCopy: true,
      canPaste: true,
      canSelectAll: true,
    });

    const roles = template
      .filter((item) => "role" in item && item.role)
      .map((item) => (item as { role: string }).role);

    expect(roles).toEqual([
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "selectAll",
    ]);
    expect(template.filter((i) => "type" in i && i.type === "separator"))
      .toHaveLength(2);
  });

  it("disables items whose editFlag is false/absent", () => {
    const template = buildEditMenuTemplate("en", {});
    const labeled = template.filter(
      (i) => "role" in i && "label" in i,
    ) as Array<{ role: string; label: string; enabled?: boolean }>;
    expect(labeled.every((i) => i.enabled === false)).toBe(true);
  });

  it("uses zh-CN labels and enables only flagged items", () => {
    const template = buildEditMenuTemplate("zh-CN", {
      canCopy: true,
      canPaste: true,
    });
    const find = (role: string) =>
      template.find(
        (i) => "role" in i && (i as { role: string }).role === role,
      ) as { role: string; label: string; enabled?: boolean } | undefined;

    expect(find("copy")?.label).toBe("复制");
    expect(find("paste")?.label).toBe("粘贴");
    expect(find("copy")?.enabled).toBe(true);
    expect(find("paste")?.enabled).toBe(true);
    // items without a flag stay disabled, proving per-item enable independence
    expect(find("undo")?.enabled).toBe(false);
    expect(find("redo")?.enabled).toBe(false);
    expect(find("cut")?.enabled).toBe(false);
    expect(find("selectAll")?.enabled).toBe(false);
  });
});
