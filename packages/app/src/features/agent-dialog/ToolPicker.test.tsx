import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@spherse/i18n/react";
import { ToolPicker } from "./ToolPicker";

let host: HTMLDivElement;
let root: Root | null = null;

function renderPicker(selectedTools: string[], onToggleGroup: (ids: string[]) => void) {
  const Probe = () => (
    <I18nProvider locale="zh-CN">
      <ToolPicker selectedTools={selectedTools} onToggleGroup={onToggleGroup} />
    </I18nProvider>
  );
  act(() => {
    root = createRoot(host);
    root.render(<Probe />);
  });
}

function buttons(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll("button"));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host.remove();
  root = null;
});

describe("ToolPicker manage tools merge", () => {
  it("toggles the three manage tools as one option", () => {
    const onToggleGroup = vi.fn();
    renderPicker(
      ["read_file", "manage_agent", "manage_trigger", "manage_project_config"],
      onToggleGroup,
    );
    const manageButton = buttons().find((b) => b.textContent === "管理项目");
    expect(manageButton).toBeDefined();
    act(() => {
      manageButton?.click();
    });
    expect(onToggleGroup).toHaveBeenCalledTimes(1);
    expect(onToggleGroup).toHaveBeenCalledWith([
      "manage_agent",
      "manage_trigger",
      "manage_project_config",
    ]);
  });

  it("does not render separate buttons for individual manage tools", () => {
    renderPicker(["manage_agent", "manage_trigger", "manage_project_config"], vi.fn());
    const labels = buttons().map((b) => b.textContent);
    expect(labels).not.toContain("管理智能体");
    expect(labels).not.toContain("管理触发器");
    expect(labels).not.toContain("管理项目配置");
  });
});
