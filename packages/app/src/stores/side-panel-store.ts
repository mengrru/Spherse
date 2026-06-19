import { create } from "zustand";

interface SidePanelStore {
  pinned: boolean;
  hovered: boolean;
  setPinned: (pinned: boolean) => void;
  togglePinned: () => void;
  show: () => void;
  hide: () => void;
}

const SIDE_PANEL_PINNED_STORAGE_KEY = "spherse:side-panel:pinned";
const LEGACY_PROJECT_PANEL_PINNED_STORAGE_KEY = "spherse:project-panel:pinned";
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function readPinned(): boolean {
  if (typeof localStorage === "undefined") return true;
  const stored = localStorage.getItem(SIDE_PANEL_PINNED_STORAGE_KEY);
  if (stored !== null) return stored !== "false";
  const legacyStored = localStorage.getItem(LEGACY_PROJECT_PANEL_PINNED_STORAGE_KEY);
  if (legacyStored !== null) {
    localStorage.setItem(SIDE_PANEL_PINNED_STORAGE_KEY, legacyStored);
    localStorage.removeItem(LEGACY_PROJECT_PANEL_PINNED_STORAGE_KEY);
    return legacyStored !== "false";
  }
  return true;
}

function writePinned(pinned: boolean) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SIDE_PANEL_PINNED_STORAGE_KEY, String(pinned));
}

export const useSidePanelStore = create<SidePanelStore>((set, get) => ({
  pinned: readPinned(),
  hovered: false,

  setPinned(pinned) {
    writePinned(pinned);
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    set({
      pinned,
      hovered: pinned ? false : get().hovered,
    });
  },

  togglePinned() {
    if (get().pinned) set({ hovered: true });
    get().setPinned(!get().pinned);
  },

  show() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    set({ hovered: true });
  },

  hide() {
    if (get().pinned) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      set({ hovered: false });
      hideTimer = null;
    }, 120);
  },
}));
