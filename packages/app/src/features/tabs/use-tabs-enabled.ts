import { useSettingsStore } from "../../stores/settings-store";

export function useTabsEnabled(): boolean {
  return useSettingsStore((s) => s.loaded && s.tabsEnabled);
}
