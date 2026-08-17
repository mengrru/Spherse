import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "UpdateChecker.tsx"), "utf8");

describe("UpdateChecker structure", () => {
  it("uses the useUpdateChecker hook", () => {
    expect(source).toContain("useUpdateChecker()");
  });

  it("uses the useI18n hook", () => {
    expect(source).toContain("useI18n()");
  });

  it("loads app version on mount via the host bridge updater", () => {
    expect(source).toContain("getAppVersion");
    expect(source).toContain("useEffect");
  });

  it("does not reference window.electronAPI directly", () => {
    expect(source).not.toContain("window.electronAPI");
  });

  it("renders status-based buttons (idle/checking/upToDate/error/downloading)", () => {
    expect(source).toContain('"idle"');
    expect(source).toContain('"checking"');
    expect(source).toContain('"upToDate"');
    expect(source).toContain('"error"');
    expect(source).toContain('"downloading"');
  });

  it("wires the check button to check()", () => {
    expect(source).toContain("void check()");
  });

  it("renders a progress bar for the downloading state", () => {
    expect(source).toContain("bg-muted");
    expect(source).toContain("bg-primary");
    expect(source).toContain("width");
  });

  it("wires cancelDownload on the cancel button", () => {
    expect(source).toContain("onClick={cancelDownload}");
  });

  it("renders an update-available dialog bound to status === available", () => {
    expect(source).toContain('"available"');
    expect(source).toContain("dismissUpdate");
    expect(source).toContain("MarkdownContent");
  });

  it("supports both manual download (openExternal) and auto download (acceptDownload)", () => {
    expect(source).toContain("downloadUrl");
    expect(source).toContain("openExternal");
    expect(source).toContain("acceptDownload");
  });

  it("error fallback opens the landing page (not GitHub releases)", () => {
    // 检测失败兜底跳 landing page（含平台/架构选包，国内可达），不再指向 GitHub
    expect(source).toContain("https://spherse.mengru.work/");
    expect(source).not.toContain("github.com/mengrru/Spherse/releases");
  });

  it("renders a downloaded dialog with restart actions", () => {
    expect(source).toContain('"downloaded"');
    expect(source).toContain("acceptRestart");
    expect(source).toContain("dismissRestart");
  });

  it("uses the about/update i18n keys", () => {
    expect(source).toContain('t("settings.about.version")');
    expect(source).toContain('t("settings.about.checkUpdate")');
    expect(source).toContain('t("settings.about.checking")');
    expect(source).toContain('t("settings.about.upToDate")');
    expect(source).toContain('t("settings.about.checkFailed")');
    expect(source).toContain('t("settings.about.retry")');
    expect(source).toContain('t("settings.update.downloading"');
    expect(source).toContain('t("settings.update.cancel")');
    expect(source).toContain('t("settings.update.newVersion"');
    expect(source).toContain('t("settings.update.releaseNotes")');
    expect(source).toContain('t("settings.update.later")');
    expect(source).toContain('t("settings.update.download")');
    expect(source).toContain('t("settings.update.gotoDownload")');
    expect(source).toContain('t("settings.update.downloaded")');
    expect(source).toContain('t("settings.update.restartNow")');
    expect(source).toContain('t("settings.update.restartLater")');
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
