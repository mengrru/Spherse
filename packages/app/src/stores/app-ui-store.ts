import { create } from "zustand";

interface AppUiStore {
  settingsModalOpen: boolean;
  settingsModalTab: string | null;
  setSettingsModalOpen: (open: boolean) => void;
  openSettings: (tab?: string) => void;
}

export const useAppUiStore = create<AppUiStore>((set) => ({
  settingsModalOpen: false,
  settingsModalTab: null,
  setSettingsModalOpen: (open) =>
    set(open ? { settingsModalOpen: true } : { settingsModalOpen: false, settingsModalTab: null }),
  openSettings: (tab = "models") => set({ settingsModalOpen: true, settingsModalTab: tab }),
}));
