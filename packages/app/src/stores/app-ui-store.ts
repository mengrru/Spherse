import { create } from "zustand";

interface AppUiStore {
  settingsModalOpen: boolean;
  setSettingsModalOpen: (open: boolean) => void;
}

export const useAppUiStore = create<AppUiStore>((set) => ({
  settingsModalOpen: false,
  setSettingsModalOpen: (open) => set({ settingsModalOpen: open }),
}));
