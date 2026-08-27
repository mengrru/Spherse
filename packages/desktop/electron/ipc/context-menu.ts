import { Menu } from "electron";
import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import { normalizeLocale, translate, type Locale } from "@spherse/i18n";
import { getLocale } from "../settings.js";

export type EditFlags = {
  canUndo?: boolean;
  canRedo?: boolean;
  canCut?: boolean;
  canCopy?: boolean;
  canPaste?: boolean;
  canSelectAll?: boolean;
};

export function buildEditMenuTemplate(
  locale: Locale,
  editFlags: EditFlags,
): MenuItemConstructorOptions[] {
  return [
    { role: "undo", label: translate(locale, "contextMenu.undo"), enabled: !!editFlags.canUndo },
    { role: "redo", label: translate(locale, "contextMenu.redo"), enabled: !!editFlags.canRedo },
    { type: "separator" },
    { role: "cut", label: translate(locale, "contextMenu.cut"), enabled: !!editFlags.canCut },
    { role: "copy", label: translate(locale, "contextMenu.copy"), enabled: !!editFlags.canCopy },
    { role: "paste", label: translate(locale, "contextMenu.paste"), enabled: !!editFlags.canPaste },
    { type: "separator" },
    {
      role: "selectAll",
      label: translate(locale, "contextMenu.selectAll"),
      enabled: !!editFlags.canSelectAll,
    },
  ];
}

export function setupContextMenu(win: BrowserWindow): void {
  win.webContents.on("context-menu", (_event, props) => {
    if (!props.isEditable) return;
    const locale = normalizeLocale(getLocale());
    const menu = Menu.buildFromTemplate(buildEditMenuTemplate(locale, props.editFlags));
    menu.popup({ window: win });
  });
}
