import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "ModelProviderItem.tsx"), "utf8");

describe("ModelProviderItem structure", () => {
  it("extends props with optional onEdit/onDelete (backward compatible)", () => {
    expect(source).toContain("onEdit?: () => void");
    expect(source).toContain("onDelete?: () => void");
  });

  it("reads custom/keyless flags off config", () => {
    expect(source).toContain("config.custom === true");
    expect(source).toContain("config.keyless === true");
  });

  it("custom row renders the Custom badge + baseUrl subtitle", () => {
    expect(source).toContain('t("settings.provider.customBadge")');
    expect(source).toContain("config.baseUrl");
    expect(source).toContain("text-xs text-muted-foreground");
  });

  it("custom row renders edit/delete icon buttons wired to onEdit/onDelete", () => {
    expect(source).toContain("PencilIcon");
    expect(source).toContain("Trash2Icon");
    expect(source).toContain('variant="ghost"');
    expect(source).toContain('size="icon-sm"');
    expect(source).toContain("onClick={onEdit}");
    expect(source).toContain("onClick={onDelete}");
  });

  it("hides edit/delete buttons when their callbacks are undefined", () => {
    expect(source).toContain("isCustom && onEdit");
    expect(source).toContain("isCustom && onDelete");
  });

  it("keyless row renders the keyless badge and omits the api-key input + connect/disconnect", () => {
    expect(source).toContain('t("settings.provider.keylessBadge")');
    expect(source).toMatch(/isKeyless\s*\?\s*null\s*:/);
  });

  it("keeps the built-in api-key input + connect/disconnect behavior for keyed rows", () => {
    expect(source).toContain('t("settings.provider.apiKeyPlaceholder")');
    expect(source).toContain("onClick={onConnect}");
    expect(source).toContain("onClick={onDisconnect}");
    expect(source).toContain('t("settings.provider.connect")');
    expect(source).toContain('t("settings.provider.disconnect")');
  });

  it("persists the api key on blur via onApiKeyCommit", () => {
    expect(source).toContain("onApiKeyCommit: (value: string) => void");
    expect(source).toContain("onBlur={() => onApiKeyCommit(apiKey)}");
  });

  it("uses lucide-react Icon-suffix imports (matches feature convention)", () => {
    expect(source).toContain('from "lucide-react"');
  });

  it("uses semantic color tokens (no hardcoded colors)", () => {
    expect(source).toContain("text-muted-foreground");
    expect(source).toContain("border-border");
    expect(source).not.toMatch(/text-\[#[0-9a-fA-F]+\]/);
    expect(source).not.toMatch(/bg-\[#[0-9a-fA-F]+\]/);
  });

  it("does not use dark: modifiers", () => {
    expect(source).not.toMatch(/dark:/);
  });
});
