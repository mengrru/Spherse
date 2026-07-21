import { useSidePanelStore } from "../stores/side-panel-store";

export function useSidePanel() {
  const pinned = useSidePanelStore((s) => s.pinned);
  const hovered = useSidePanelStore((s) => s.hovered);
  const mobileOpen = useSidePanelStore((s) => s.mobileOpen);
  const show = useSidePanelStore((s) => s.show);
  const hide = useSidePanelStore((s) => s.hide);
  const togglePin = useSidePanelStore((s) => s.togglePinned);
  const showMobile = useSidePanelStore((s) => s.showMobile);
  const hideMobile = useSidePanelStore((s) => s.hideMobile);

  const visible = pinned || hovered;
  const clickAwayActive = hovered && !pinned;
  const clickAwayProps = clickAwayActive ? { onClick: hide } : {};

  return {
    pinned,
    visible,
    mobileOpen,
    show,
    hide,
    togglePin,
    showMobile,
    hideMobile,
    clickAwayActive,
    clickAwayProps,
  };
}
