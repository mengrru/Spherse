import { useAppStore } from "../stores/app-store";

export function useSidePanelClickAway() {
  const sidePanelPinned = useAppStore((state) => state.sidePanelPinned);
  const sidePanelHovered = useAppStore((state) => state.sidePanelHovered);
  const hideSidePanel = useAppStore((state) => state.hideSidePanel);

  if (sidePanelHovered && !sidePanelPinned) {
    return { onClick: hideSidePanel };
  }
  return {};
}
