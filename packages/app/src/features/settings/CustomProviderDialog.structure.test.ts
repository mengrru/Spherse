import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "CustomProviderDialog.tsx"), "utf8");

describe("CustomProviderDialog structure", () => {
  it("exposes the expected prop interface (open/onClose/onSubmit/optional initial)", () => {
    expect(source).toContain("open: boolean");
    expect(source).toContain("onClose: () => void");
    expect(source).toContain("onSubmit: (def: CustomProviderDef) => void");
    expect(source).toContain("initial?: CustomProviderDef");
  });

  it("imports CustomProviderDef from @spherse/core", () => {
    expect(source).toContain('from "@spherse/core"');
    expect(source).toContain("CustomProviderDef");
  });

  it("is driven by the base-ui Dialog open/onOpenChange pattern", () => {
    expect(source).toContain("Dialog");
    expect(source).toContain("DialogContent");
    expect(source).toContain("DialogHeader");
    expect(source).toContain("DialogTitle");
    expect(source).toContain("DialogFooter");
    expect(source).toMatch(/open=\{open\}/);
    expect(source).toMatch(/onOpenChange=\{/);
    expect(source).toContain("if (!openValue) onClose()");
  });

  it("reinitializes form fields when the dialog opens (effect keyed on open)", () => {
    expect(source).toContain("useEffect");
    expect(source).toContain("if (!open) return");
    expect(source).toContain("}, [open, initial]);");
  });

  it("renders all four fields with their i18n labels/placeholders", () => {
    expect(source).toContain('t("settings.provider.dialog.name")');
    expect(source).toContain('t("settings.provider.dialog.namePlaceholder")');
    expect(source).toContain('t("settings.provider.dialog.baseUrl")');
    expect(source).toContain('t("settings.provider.dialog.baseUrlPlaceholder")');
    expect(source).toContain('t("settings.provider.dialog.models")');
    expect(source).toContain('t("settings.provider.dialog.modelsPlaceholder")');
    expect(source).toContain('t("settings.provider.dialog.modelsHint")');
    expect(source).toContain('t("settings.provider.dialog.keyless")');
    expect(source).toContain('t("settings.provider.dialog.keylessDesc")');
  });

  it("switches title between add/edit based on initial", () => {
    expect(source).toContain('t("settings.provider.dialog.titleAdd")');
    expect(source).toContain('t("settings.provider.dialog.titleEdit")');
    expect(source).toMatch(/initial\s*\?/);
  });

  it("uses Input for name/baseUrl, Textarea for model ids, Switch for keyless", () => {
    expect(source).toContain("Input");
    expect(source).toContain("Textarea");
    expect(source).toContain("Switch");
    expect(source).toContain("onCheckedChange={setKeyless}");
  });

  it("parses model ids by splitting on comma and newline, trimming, dropping empties, deduping", () => {
    expect(source).toContain("parseModelIds");
    expect(source).toContain("split(/[,\\n]/)");
    expect(source).toContain(".trim()");
    expect(source).toContain(".length > 0");
    expect(source).toContain("new Set(");
    expect(source).toContain("[...new Set(parts)]");
  });

  it("validates baseUrl via new URL and http(s) protocol check", () => {
    expect(source).toContain("isHttpUrl");
    expect(source).toContain("new URL(value)");
    expect(source).toContain('protocol === "http:"');
    expect(source).toContain('protocol === "https:"');
  });

  it("computes all four error messages from derived state", () => {
    expect(source).toContain('t("settings.provider.dialog.errNameRequired")');
    expect(source).toContain('t("settings.provider.dialog.errBaseUrlRequired")');
    expect(source).toContain('t("settings.provider.dialog.errBaseUrlInvalid")');
    expect(source).toContain('t("settings.provider.dialog.errModelsRequired")');
    expect(source).toContain("hasErrors");
    expect(source).toContain("aria-invalid");
    expect(source).toContain("FieldError");
  });

  it("disables Save while validation fails and renders Cancel outline", () => {
    expect(source).toContain('variant="outline"');
    expect(source).toContain("onClick={onClose}");
    expect(source).toContain("disabled={hasErrors}");
    expect(source).toContain("handleSubmit");
  });

  it("assembles the def preserving initial.id in edit mode / empty id in add mode", () => {
    expect(source).toContain("id: initial?.id ?? \"\"");
    expect(source).toContain("name: trimmedName");
    expect(source).toContain("baseUrl: trimmedBaseUrl");
    expect(source).toContain("models: parsedModels");
    expect(source).toContain("keyless,");
    expect(source).toContain("onSubmit(");
    expect(source).toContain("onClose()");
  });

  it("footer buttons use the i18n save/cancel labels", () => {
    expect(source).toContain('t("settings.provider.dialog.save")');
    expect(source).toContain('t("settings.provider.dialog.cancel")');
  });

  it("uses semantic color tokens (no hardcoded colors)", () => {
    expect(source).toContain("text-muted-foreground");
    expect(source).not.toMatch(/text-\[#[0-9a-fA-F]+\]/);
    expect(source).not.toMatch(/bg-\[#[0-9a-fA-F]+\]/);
  });

  it("does not use dark: modifiers", () => {
    expect(source).not.toMatch(/dark:/);
  });
});
