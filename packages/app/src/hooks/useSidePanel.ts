import { useAppStore } from "../stores/app-store";

export function useSidePanel() {
  const pinned = useAppStore((s) => s.sidePanelPinned);
  const hovered = useAppStore((s) => s.sidePanelHovered);
  const show = useAppStore((s) => s.showSidePanel);
  const hide = useAppStore((s) => s.hideSidePanel);
  const togglePin = useAppStore((s) => s.toggleSidePanelPinned);

  const visible = pinned || hovered;
  const clickAwayActive = hovered && !pinned;
  const clickAwayProps = clickAwayActive ? { onClick: hide } : {};

  return { pinned, visible, show, hide, togglePin, clickAwayActive, clickAwayProps };
}
